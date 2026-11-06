// Give one local file a public https address through a Cloudflare quick
// tunnel. Every path on that address returns the file, so nothing else on
// this computer can be reached. Needs cloudflared on your PATH.
//
// From the command line (Ctrl-C to stop):
//   deno run --allow-net --allow-read --allow-run=cloudflared tunnelFile.js \
//       ~/Dropbox/Repos/Agentscript/views2gui/schelling.html
//
// From code:
//   import { tunnelFile } from './tunnelFile.js'
//   const { url, close } = await tunnelFile('page.html')
//   ...
//   await close()

const types = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    txt: 'text/plain; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
}

export async function tunnelFile(path, timeoutSecs = 60) {
    const file = await Deno.realPath(path) // fails here if it's missing
    const ext = file.split('.').pop().toLowerCase()
    const type = types[ext] ?? 'application/octet-stream'

    // Port 0 picks any free port. 127.0.0.1 keeps it off the local network:
    // only the tunnel reaches it. The file is read on every request, so
    // saving it and reloading the browser shows the change.
    const server = Deno.serve(
        { hostname: '127.0.0.1', port: 0, onListen() {} },
        async () =>
            new Response(await Deno.readFile(file), {
                headers: { 'content-type': type },
            })
    )

    let child
    try {
        // http2 rather than the default QUIC, which our home network drops
        // (see MCP/docs/remote.md).
        child = new Deno.Command('cloudflared', {
            args: [
                'tunnel',
                '--protocol',
                'http2',
                '--url',
                `http://127.0.0.1:${server.addr.port}`,
            ],
            stdout: 'null',
            stderr: 'piped',
        }).spawn()
    } catch (e) {
        await server.shutdown()
        throw e instanceof Deno.errors.NotFound
            ? new Error('cloudflared is not on your PATH')
            : e
    }

    let closing
    const close = () =>
        (closing ??= (async () => {
            try {
                child.kill()
            } catch {
                // already exited
            }
            await server.shutdown()
        })())

    const log = readLog(child.stderr)
    const deadline = Date.now() + timeoutSecs * 1000
    // If cloudflared hangs, kill it; its log then ends and waitFor fails.
    const timer = setTimeout(close, timeoutSecs * 1000)
    try {
        const url = await log.waitFor(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
        // Printed once cloudflared is connected to Cloudflare.
        await log.waitFor(/Registered tunnel connection/)
        clearTimeout(timer)
        await waitUntilLive(url, deadline, log.text)
        return { url, close }
    } catch (e) {
        clearTimeout(timer)
        await close()
        throw e
    }
}

// cloudflared writes its log to stderr. Keep reading it, or cloudflared
// stalls once the pipe fills, and keep the end of it for error messages.
function readLog(stderr) {
    let text = ''
    let ended = false
    let wake = () => {}
    ;(async () => {
        for await (const chunk of stderr.pipeThrough(new TextDecoderStream())) {
            text = (text + chunk).slice(-8000)
            wake()
        }
    })()
        .catch(() => {})
        .finally(() => {
            ended = true
            wake()
        })

    // Resolves with the first match of pattern in the log.
    const waitFor = async pattern => {
        while (!pattern.test(text)) {
            if (ended) {
                throw new Error(
                    `cloudflared exited, or took too long. Its log:\n${text}`
                )
            }
            await new Promise(r => (wake = r))
        }
        return text.match(pattern)[0]
    }
    return { waitFor, text: () => text }
}

// The address can take a few seconds to exist in DNS. Ask 1.1.1.1 first:
// asking this Mac's resolver too early makes it cache "no such name" for up
// to a minute, for browsers too.
async function waitUntilLive(
    url,
    deadline,
    log
) {
    const host = new URL(url).hostname
    let last = ''
    while (Date.now() < deadline) {
        try {
            await Deno.resolveDns(host, 'A', {
                nameServer: { ipAddr: '1.1.1.1', port: 53 },
            })
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
            await res.body?.cancel()
            if (res.ok) return
            last = `HTTP ${res.status}`
        } catch (e) {
            last = e.message
        }
        await new Promise(r => setTimeout(r, 1000))
    }
    throw new Error(
        `${url} never answered (last try: ${last}). cloudflared's log:\n${log()}`
    )
}

if (import.meta.main) {
    const path = Deno.args[0]
    if (!path) {
        console.error('usage: tunnel <file>')
        Deno.exit(1)
    }
    const { url, close } = await tunnelFile(path).catch(e => {
        console.error(e.message)
        Deno.exit(1)
    })
    console.log(url)
    Deno.addSignalListener('SIGINT', async () => {
        await close()
        Deno.exit()
    })
}

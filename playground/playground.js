// Give an html page a permanent https address: each playground is its own
// Worker with only static assets, at https://pg-<name>.<subdomain>.workers.dev.
// Every name gets the pg- prefix, so a playground can't replace a real Worker
// and list/delete only ever see playgrounds.
//
//   deno run ... playground.js deploy [name] <file.html | folder>
//   deno run ... playground.js list
//   deno run ... playground.js delete <name>
//
// A file is served as index.html. A folder is served as it is (minus dotfiles
// and node_modules), so it should have its own index.html. Without a name,
// it comes from the path: views2gui/schelling.html is schelling. Deploying
// the same name again replaces it. Uses wrangler's own login (wrangler login).

const wrangler = ['run', '-A', 'npm:wrangler@4.151.3']
const prefix = 'pg-'

function workerName(name) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) || name.length > 60)
        throw new Error(
            `bad name "${name}": use lowercase letters, digits and dashes`
        )
    return prefix + name
}

// The file's name without .html, or the folder's name. An index.html is
// named after its folder. My_Model.html becomes my-model.
export function nameFromPath(path) {
    const parts = path.replace(/\/+$/, '').split('/')
    let base = parts.pop().replace(/\.html?$/i, '')
    if (base.toLowerCase() === 'index') base = parts.pop() ?? base
    return base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
}

// Wrangler runs in an empty temp folder so it never picks up a
// wrangler.jsonc from wherever this was started.
async function runWrangler(args, cwd) {
    const { code } = await new Deno.Command('deno', {
        args: [...wrangler, ...args],
        cwd,
    }).spawn().status
    if (code !== 0) throw new Error(`wrangler ${args[0]} failed`)
}

async function wranglerJson(args) {
    const { code, stdout } = await new Deno.Command('deno', {
        args: [...wrangler, ...args, '--json'],
        stderr: 'null',
    }).output()
    if (code !== 0) throw new Error('not logged in: run wrangler login')
    return JSON.parse(new TextDecoder().decode(stdout))
}

async function copyFolder(from, to) {
    await Deno.mkdir(to, { recursive: true })
    for await (const entry of Deno.readDir(from)) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue
        const src = `${from}/${entry.name}`
        const dest = `${to}/${entry.name}`
        if (entry.isDirectory) await copyFolder(src, dest)
        else if (entry.isFile) await Deno.copyFile(src, dest)
    }
}

export async function deploy(name, path) {
    const worker = workerName(name)
    const source = await Deno.realPath(path) // fails here if it's missing
    const tmp = await Deno.makeTempDir({ prefix: 'playground-' })
    try {
        const site = `${tmp}/site`
        if ((await Deno.stat(source)).isDirectory) {
            await copyFolder(source, site)
        } else {
            await Deno.mkdir(site)
            await Deno.copyFile(source, `${site}/index.html`)
        }
        await runWrangler(
            [
                'deploy',
                '--name', worker,
                '--assets', site,
                '--compatibility-date', '2026-10-01',
            ],
            tmp
        )
    } finally {
        await Deno.remove(tmp, { recursive: true })
    }
}

export async function remove(name) {
    const tmp = await Deno.makeTempDir({ prefix: 'playground-' })
    try {
        await runWrangler(['delete', workerName(name)], tmp)
    } finally {
        await Deno.remove(tmp, { recursive: true })
    }
}

// Wrangler can't list Workers, so this asks Cloudflare's API directly,
// with wrangler's token. CLOUDFLARE_ACCOUNT_ID picks an account if the
// login has more than one.
export async function list() {
    const { accounts } = await wranglerJson(['whoami'])
    const account =
        Deno.env.get('CLOUDFLARE_ACCOUNT_ID') ??
        (accounts.length === 1 ? accounts[0].id : undefined)
    if (!account)
        throw new Error('several accounts: set CLOUDFLARE_ACCOUNT_ID')
    const { token } = await wranglerJson(['auth', 'token'])

    const api = async path => {
        const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${account}${path}`,
            { headers: { authorization: `Bearer ${token}` } }
        )
        const body = await res.json()
        if (!body.success)
            throw new Error(`${path}: ${JSON.stringify(body.errors)}`)
        return body.result
    }
    const { subdomain } = await api('/workers/subdomain')
    const scripts = await api(
        '/workers/scripts'
    )
    return scripts
        .filter(s => s.id.startsWith(prefix))
        .map(s => ({
            name: s.id.slice(prefix.length),
            url: `https://${s.id}.${subdomain}.workers.dev`,
            modified: s.modified_on.slice(0, 10),
        }))
}

if (import.meta.main) {
    const [command, name, path] = Deno.args
    try {
        if (command === 'deploy' && name && path) await deploy(name, path)
        else if (command === 'deploy' && name)
            await deploy(nameFromPath(await Deno.realPath(name)), name)
        else if (command === 'delete' && name) await remove(name)
        else if (command === 'list') {
            const playgrounds = await list()
            for (const p of playgrounds)
                console.log(`${p.name.padEnd(20)} ${p.modified}  ${p.url}`)
            if (playgrounds.length === 0) console.log('no playgrounds yet')
        } else {
            console.log(
                'usage: playground deploy [name] <file.html | folder>\n' +
                    '       playground list\n' +
                    '       playground delete <name>'
            )
            Deno.exit(1)
        }
    } catch (e) {
        console.error(e.message)
        Deno.exit(1)
    }
}

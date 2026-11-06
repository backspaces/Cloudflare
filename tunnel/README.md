# tunnel

[tunnelFile.js](tunnelFile.js) gives one local file a public https address
through a Cloudflare quick tunnel. [run](run) runs it with the permissions
it needs, from any folder:

    ./run ~/Dropbox/Repos/Agentscript/views2gui/schelling.html
    ./run page.html          # relative paths work too

It prints a `https://….trycloudflare.com` address and keeps running until
Ctrl-C. From code it's `const { url, close } = await tunnelFile(path)`.

`~/bin/Bashrc` has a one-line `tunnel` function that calls `run`, so
`tunnel page.html` works from anywhere.

```
browser ──https──▶ Cloudflare ◀══tunnel══ cloudflared ──http──▶ tunnelFile's server
```

- **Only that file is exposed.** The server returns the same file for every
  path, and listens only on `127.0.0.1`, so the tunnel is the only way in.
- **Edits show live.** The file is read on every request, so save it and
  reload the browser.
- **No account needed.** A quick tunnel is anonymous, and the address changes
  every run.
- **It waits until the address works.** cloudflared prints the address a few
  seconds before it answers, so `tunnelFile` only returns once it does. It
  waits for cloudflared's `Registered tunnel connection`, then for the name to
  appear at 1.1.1.1, then for a fetch to succeed. Asking this Mac's own DNS
  too early makes it remember "no such name" for up to a minute.
- **It uses `--protocol http2`.** cloudflared's default, QUIC, runs over UDP,
  which our home network drops.
- **When it fails, the error includes cloudflared's log**, after 60 seconds
  at most (`tunnelFile(path, timeoutSecs)` changes that).

A page's own imports aren't tunneled. `views2gui/schelling.html` loads its
modules from `https://agentscript.org/...`, so local changes to AgentScript's
`src/` won't show through the tunnel.

# Cloudflare

Experiments with Cloudflare's features, one folder each, to see how they
compare with Deno and Deno Deploy. (Deno joined Cloudflare, and Deno Deploy
is due to shut down around April 2027, so this is also scouting where our
apps and servers move next.)

Apps that just happen to be hosted on Cloudflare live in their own repos.
This repo is for trying the platform itself.

## Tried

| What | Where | Notes |
| --- | --- | --- |
| Quick tunnel for one file | [tunnel/](tunnel/) | `tunnelFile(path)` gives the file a public `trycloudflare.com` address |
| Playgrounds | [playground/](playground/) | any html file or folder as its own static Worker, at a permanent `pg-<name>.…workers.dev` address |

## Still to try

- **An AgentScript model in a Worker** (next): run the model itself on
  Cloudflare, not just serve the page that runs it in the browser.
- **Durable Objects**: one long-lived instance with its own state that every
  visitor connects to, over WebSockets. The natural home for a model that
  every viewer watches, and changes, together.
- **Storage**: KV (key-value, read-mostly), D1 (SQLite), R2 (files, like S3).
- **Cron Triggers**: run a Worker on a schedule.
- **Queues**: hand work from one Worker to another.
- **Workers AI**: run models on Cloudflare's GPUs from a Worker.
- **Named tunnel**: a fixed address for a server on this Mac, which needs a
  domain managed in Cloudflare.
- **Custom domain**: an app at our own address instead of `workers.dev`.

## Tools

Wrangler, Cloudflare's command-line tool, runs through Deno, so no Node
install is needed:

    deno run -A npm:wrangler@4.151.3 <command>    # dev, deploy, whoami, tail …

`deno run -A npm:wrangler@4.151.3 login` signs in once, through the browser.

`cloudflared`, for tunnels, is in `~/.local/bin`.

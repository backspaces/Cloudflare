// The smallest Worker with all of a big Worker's parts: static assets,
// routing, settings and secrets, KV, a Durable Object and a Cron Trigger.
//
//   GET  /hello    settings and secrets, from env
//   GET  /note     read a note from KV
//   POST /note     save the request's body as the note
//   GET  /count    an exact count, kept by a Durable Object
//
// README.md here has the whole story.
//
// A Worker is a module exporting handlers, and Cloudflare calls them: there's
// no server loop. Any request may land in any data center, in a fresh or a
// reused isolate, so nothing kept in a variable is safe between requests.
// What has to last goes in storage.
import { DurableObject } from 'cloudflare:workers'

export default {
    // Every request that isn't a file in public/.
    //   request: a standard web Request, as in the browser
    //   env:     the bindings in wrangler.jsonc: env.GREETING, env.SECRET_TOKEN,
    //            env.NOTES (KV), env.COUNTER (the Durable Object)
    //   ctx:     ctx.waitUntil(promise) keeps work going after the response
    async fetch(request, env, _ctx) {
        const url = new URL(request.url)

        switch (url.pathname) {
            case '/hello':
                return Response.json({
                    greeting: env.GREETING,
                    hasSecret: Boolean(env.SECRET_TOKEN), // never echo a secret
                    servedFrom: request.cf?.colo ?? 'local', // the data center
                })

            // KV: fast reads everywhere, but a write can take up to a minute
            // to reach the other data centers.
            case '/note':
                if (request.method === 'POST') {
                    await env.NOTES.put('note', await request.text())
                }
                return Response.json({
                    note: await env.NOTES.get('note'),
                    lastCron: await env.NOTES.get('lastCron'),
                })

            // A Durable Object: every request for the name "global" reaches
            // the same one object, one at a time, so the count is exact.
            case '/count': {
                const counter = env.COUNTER.getByName('global')
                return Response.json({ count: await counter.increment() })
            }

            default:
                return new Response('Not found', { status: 404 })
        }
    },

    // The Cron Trigger: no request, just the time.
    async scheduled(controller, env) {
        const time = new Date(controller.scheduledTime).toISOString()
        await env.NOTES.put('lastCron', time)
        console.log('cron ran at', time)
    },
}

// Cloudflare makes one Counter per name, wherever it's first asked for, and
// keeps its storage with it. The Worker calls its methods as if they were
// local; they're really remote calls.
export class Counter extends DurableObject {
    async increment() {
        const count = ((await this.ctx.storage.get('count')) ?? 0) + 1
        await this.ctx.storage.put('count', count)
        return count
    }
}

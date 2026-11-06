// AgentScript's Schelling model running on Cloudflare, not in the browser.
//
//   GET /run?ticks=100&seed=1    a fresh model for every request: run it,
//                                return the result as JSON, forget it
//
// README.md here has the whole story.
import './nocanvas.js' // first: AgentScript needs a canvas as it loads
import { util } from 'agentscript/dist/agentscript2d.js'
import Model from './schelling.js'

// One character per patch, a row per line: X, O or . for empty.
function grid(model) {
    return model.patches.map(p =>
        p.turtlesHere.length ? p.turtlesHere[0].breed.name[0] : '.'
    )
}

function run(ticks, seed) {
    // randomSeed swaps in its own Math.random, for repeatable runs. Every
    // request shares this isolate's globals, so put the real one back.
    const random = Math.random
    try {
        if (seed !== undefined) util.randomSeed(seed)
        const start = Date.now()
        const model = new Model()
        model.setup()
        while (model.ticks < ticks && !model.done) model.step()
        const cells = grid(model).join('')
        const size = model.world.width
        return {
            ticks: model.ticks,
            done: model.done ?? false,
            percentHappy: model.percentHappy,
            // Workers only advance the clock between I/O, so this is 0
            // in production; wrangler tail shows the real CPU time.
            ms: Date.now() - start,
            grid: Array.from({ length: size }, (_, y) =>
                cells.slice(y * size, (y + 1) * size)
            ),
        }
    } finally {
        Math.random = random
    }
}

export default {
    fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/run') {
            const ticks = Math.min(Number(url.searchParams.get('ticks') ?? 100), 1000)
            const seed = url.searchParams.get('seed')
            return Response.json(run(ticks, seed === null ? undefined : Number(seed)))
        }
        return new Response('not found', { status: 404 })
    },
}

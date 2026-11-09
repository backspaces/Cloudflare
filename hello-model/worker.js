// An AgentScript model, wrapped in the simplest Worker that runs it.
//
// A Worker's ins and outs:
//   in:  request  what the caller sent: the address, e.g. /?steps=50
//   in:  env      the "vars" in wrangler.jsonc: the defaults
//   out: Response what's sent back: the model's data, as JSON
//
//   /                              the defaults: 100 steps, the turtles
//   /?steps=50&return=turtles,links
//   /?population=30&speed=0.5      also sets the model's own variables
//
// Each request makes a fresh model: nothing is kept between requests.
//
// AgentScript comes from agentscript.org. The build in wrangler.jsonc
// downloads it, because a Worker can't download code while it runs. To use
// your own copy of AgentScript instead, beside this repo, swap these lines:
import HelloModel from 'https://agentscript.org/models/HelloModel.js'
// import HelloModel from '../../Agentscript/models/HelloModel.js'

export default {
    async fetch(request, env) {
        // In: everything after ? in the address, e.g. { steps: '50' }
        const {
            steps = env.STEPS,
            return: want = env.RETURN,
            ...settings
        } = Object.fromEntries(new URL(request.url).searchParams)
        const n = Math.min(Number(steps), env.MAX_STEPS)

        const model = new HelloModel()
        // Any other name in the address is one of the model's variables
        for (const [key, value] of Object.entries(settings)) {
            if (!(key in model)) {
                return Response.json(
                    { error: `HelloModel has no "${key}"` },
                    { status: 400 }
                )
            }
            model[key] =
                typeof model[key] === 'number'
                    ? Number(value)
                    : typeof model[key] === 'boolean'
                      ? value === 'true'
                      : value
        }

        await model.startup() // only matters for models that load data
        model.setup()
        for (let i = 0; i < n; i++) model.step()

        // Out: the data asked for
        const answer = { ticks: model.ticks }
        if (want.includes('turtles')) {
            answer.turtles = model.turtles.map(t => ({
                id: t.id,
                x: t.x,
                y: t.y,
                heading: t.heading,
            }))
        }
        if (want.includes('links')) {
            answer.links = model.links.map(l => ({
                id: l.id,
                from: l.end0.id,
                to: l.end1.id,
            }))
        }
        return Response.json(answer)
    },
}

// AgentScript models kept alive between requests, one model per name, each
// in its own Durable Object. There's no page: every answer is the model's
// data, as JSON.
//
//   /<name>/setup?model=schelling&density=70   make a new model, named <name>
//   /<name>/step                               run one step, then show its data
//   /<name>                                    show its data, without stepping
//
// Add &agents to any of them for every turtle, patch and link, not just
// how many there are. README.md here has the whole story.
//
// AgentScript comes straight from agentscript.org. A Worker can't import
// from the web while it runs, so `deno bundle` downloads these files when
// wrangler builds, and joins them into one file (see wrangler.jsonc).
import { DurableObject } from 'cloudflare:workers'
import Schelling from 'https://agentscript.org/models/SchellingModel.js'
import Hello from 'https://agentscript.org/models/HelloModel.js'

// deno-lint-ignore no-explicit-any
const models: Record<string, any> = { schelling: Schelling, hello: Hello }

interface Env {
    MODELS: DurableObjectNamespace<ModelHolder>
}

// The front door: reads the address, then asks the Durable Object for that
// name to do the work. This part keeps nothing between requests.
export default {
    async fetch(request: Request, env: Env) {
        const url = new URL(request.url)
        const [name, action = ''] = url.pathname.slice(1).split('/')
        if (!name) {
            return new Response(
                'Try /test/setup?model=schelling, then /test/step, then /test\n'
            )
        }

        const options = Object.fromEntries(url.searchParams)
        const agents = 'agents' in options
        const holder = env.MODELS.getByName(name)
        try {
            if (action === 'setup') {
                const { model = 'schelling', agents: _, ...params } = options
                return Response.json(await holder.setup(model, params, agents))
            }
            if (action === 'step') return Response.json(await holder.step(agents))
            if (action === '') return Response.json(await holder.data(agents))
            return new Response('Not found', { status: 404 })
        } catch (e) {
            return Response.json({ error: (e as Error).message }, { status: 400 })
        }
    },
}

// One of these exists for each name. It holds its model in memory, in a
// plain variable, so the model lasts only as long as this object stays
// awake. When Cloudflare puts an idle object to sleep, the model is gone.
export class ModelHolder extends DurableObject {
    // deno-lint-ignore no-explicit-any
    model: any = null
    kind = ''
    awakeSince = new Date().toISOString()

    setup(kind: string, params: Record<string, string>, agents: boolean) {
        const Model = models[kind]
        if (!Model) {
            throw new Error(
                `no model "${kind}": try ${Object.keys(models).join(', ')}`
            )
        }
        const model = new Model()
        // Parameters arrive as text: turn "70" into 70 and "true" into true.
        for (const [key, text] of Object.entries(params)) {
            if (!(key in model)) throw new Error(`${kind} has no "${key}"`)
            const number = Number(text)
            model[key] =
                text === 'true' ? true
                : text === 'false' ? false
                : text !== '' && !isNaN(number) ? number
                : text
        }
        model.setup()
        this.model = model
        this.kind = kind
        return this.data(agents)
    }

    step(agents: boolean) {
        this.need().step()
        return this.data(agents)
    }

    data(agents: boolean) {
        const model = this.need()
        const all = {
            turtles: model.turtles.map(agentData),
            patches: model.patches.map(agentData),
            links: model.links.map(agentData),
        }
        const { ticks, done, ...params } = plainValues(model)
        return {
            model: this.kind,
            ticks,
            done: done ?? false,
            params,
            counts: {
                turtles: model.turtles.length,
                patches: model.patches.length,
                links: model.links.length,
            },
            // How big the model's data is, written out as JSON: what it
            // would take to save it.
            dataBytes: JSON.stringify(all).length,
            awakeSince: this.awakeSince,
            ...(agents ? all : {}),
        }
    }

    need() {
        if (this.model) return this.model
        throw new Error(
            'no model here: either it was never set up, or it was forgotten ' +
                `when this object went to sleep (it woke at ${this.awakeSince})`
        )
    }
}

// An agent's own data: its plain values (numbers, text, true/false), its
// breed, and for a link the ids of its two ends. Everything else on an
// agent is AgentScript's wiring, like lists of neighbors, and is left out.
// deno-lint-ignore no-explicit-any
function agentData(agent: any) {
    const data = { breed: agent.breed?.name, ...plainValues(agent) }
    if (agent.end0) Object.assign(data, { end0: agent.end0.id, end1: agent.end1.id })
    return data
}

// deno-lint-ignore no-explicit-any
function plainValues(object: any) {
    // deno-lint-ignore no-explicit-any
    const values: Record<string, any> = {}
    for (const [key, value] of Object.entries(object)) {
        if (['number', 'string', 'boolean'].includes(typeof value)) values[key] = value
    }
    return values
}

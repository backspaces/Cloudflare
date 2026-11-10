// One AgentScript model, Schelling's, kept on Cloudflare in a Durable
// Object, and remembered even when that object sleeps. There's one model,
// shared: everyone who uses this Worker steps the same one. Every answer is
// the model's data, as JSON. The page at / (public/index.html) has buttons
// for all of it.
//
//   /setup?density=70&tolerance=40   make a new model (both are optional)
//   /step                            run one step, then show its data
//   /step?n=10                       run 10 steps (at most 100)
//   /show                            show its data, without stepping
//
// Add ?agents (or &agents) to any of them for every turtle, patch and link,
// not just how many there are. README.md here has the whole story.
//
// AgentScript comes straight from agentscript.org. A Worker can't import
// from the web while it runs, so `deno bundle` downloads these files when
// wrangler builds, and joins them into one file (see wrangler.jsonc).
import { DurableObject } from 'cloudflare:workers'
import Model from 'https://agentscript.org/models/SchellingModel.js'
import * as util from 'https://agentscript.org/src/utils.js'

// The model's variables you can choose, and the ones it works out.
const settings = ['density', 'tolerance']
const results = ['percentHappy']

// The front door: reads the address, then asks the Durable Object to do the
// work. This part keeps nothing between requests. The page, at /, is served
// from public/ without reaching this code.
export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        const options = Object.fromEntries(url.searchParams)
        const agents = 'agents' in options
        delete options.agents

        // There's one Durable Object, named "schelling": every request
        // reaches the same one, wherever in the world it comes from.
        const holder = env.MODEL.getByName('schelling')
        let answer
        switch (url.pathname) {
            case '/setup':
                answer = await holder.setup(options, agents)
                break
            case '/step': {
                const n = Math.min(Math.max(Number(options.n ?? 1), 1), 100)
                answer = await holder.step(n, agents)
                break
            }
            case '/show':
                answer = await holder.show(agents)
                break
            default:
                return new Response('Not found', { status: 404 })
        }
        // A mistake, like stepping before Setup, comes back as { error }.
        return Response.json(answer, { status: answer.error ? 400 : 200 })
    },
}

// The Durable Object. It keeps the model two ways:
//
// - In memory, as a plain variable: fast, but lost when Cloudflare puts the
//   object to sleep, about 10 seconds after its last request.
// - In storage, as a recipe: its settings, its random seed and how many
//   steps it has run. Storage survives sleep.
//
// When a request finds no model in memory, the object rebuilds it from the
// recipe: same seed, same settings, setup(), then the same number of steps.
// With the same random numbers, that gives exactly the same model, as long
// as all its randomness comes from Math.random, it depends on nothing
// outside itself, and AgentScript's code hasn't changed (a redeploy may
// change it). Replays grow with the number of steps; the planned fix is
// saving and restoring every agent, once AgentScript can rebuild a model
// from its data. README.md, "Why the replay is exact" and "What comes next".
export class ModelHolder extends DurableObject {
    model = null // the AgentScript model, in memory
    recipe = null // what's saved in storage
    random = null // this model's own random numbers
    awakeSince = new Date().toISOString()

    // Each of these three answers with the model's data, or with { error }
    // for a mistake. (An error thrown here would reach the front door too,
    // but wrangler would also log it as a crash.)
    async setup(chosen, agents) {
        for (const key of Object.keys(chosen)) {
            if (!settings.includes(key)) {
                return { error: `"${key}" isn't a setting: try ${settings.join(', ')}` }
            }
        }
        const seed = Math.floor(Math.random() * 2147483646) + 1
        this.recipe = { settings: chosen, seed, ticks: 0 }
        this.build()
        await this.ctx.storage.put('recipe', this.recipe)
        return this.data(agents)
    }

    async step(n, agents) {
        const replayed = await this.wake()
        if (replayed === null) return { error: 'no model yet: press Setup first' }
        this.run(() => {
            for (let i = 0; i < n && !this.model.done; i++) this.model.step()
        })
        this.recipe.ticks = this.model.ticks
        await this.ctx.storage.put('recipe', this.recipe)
        return { ...this.data(agents), replayed }
    }

    async show(agents) {
        const replayed = await this.wake()
        if (replayed === null) return { error: 'no model yet: press Setup first' }
        return { ...this.data(agents), replayed }
    }

    // Make sure the model is in memory. Answers how many steps had to be
    // replayed to rebuild it: 0 if it was already there, null if there's no
    // model at all.
    async wake() {
        if (this.model) return 0
        this.recipe = await this.ctx.storage.get('recipe')
        if (!this.recipe) return null
        this.build()
        return this.model.ticks
    }

    // Make the model from the recipe: settings, setup(), and the recipe's
    // number of steps, all with the recipe's random seed.
    build() {
        const { settings: chosen, seed, ticks } = this.recipe
        // AgentScript's randomSeed() puts a seeded generator in Math.random.
        // Take it for this model, and give the real one back.
        const real = Math.random
        util.randomSeed(seed)
        this.random = Math.random
        Math.random = real

        const model = new Model()
        for (const [key, text] of Object.entries(chosen)) model[key] = Number(text)
        this.model = model
        this.run(() => {
            model.setup()
            while (model.ticks < ticks) model.step()
        })
    }

    // Run some model code with this model's random numbers in Math.random,
    // so a replay draws exactly the numbers the first run did.
    run(fn) {
        const real = Math.random
        Math.random = this.random
        try {
            fn()
        } finally {
            Math.random = real
        }
    }

    data(agents) {
        const model = this.model
        const all = {
            turtles: model.turtles.map(agentData),
            patches: model.patches.map(agentData),
            links: model.links.map(agentData),
        }
        const pick = keys => Object.fromEntries(keys.map(key => [key, model[key]]))
        return {
            ticks: model.ticks,
            done: model.done ?? false,
            settings: pick(settings),
            results: pick(results),
            counts: {
                turtles: model.turtles.length,
                patches: model.patches.length,
                links: model.links.length,
            },
            // How big the model's data is, written out as JSON: what it
            // would take to save all of it, not just the recipe.
            dataBytes: JSON.stringify(all).length,
            awakeSince: this.awakeSince,
            ...(agents ? all : {}),
        }
    }
}

// An agent's own data: its plain values (numbers, text, true/false), its
// breed, and for a link the ids of its two ends. Everything else on an
// agent is AgentScript's wiring, like lists of neighbors, and is left out.
function agentData(agent) {
    const data = { breed: agent.breed?.name }
    for (const [key, value] of Object.entries(agent)) {
        if (['number', 'string', 'boolean'].includes(typeof value)) data[key] = value
    }
    if (agent.end0) Object.assign(data, { end0: agent.end0.id, end1: agent.end1.id })
    return data
}

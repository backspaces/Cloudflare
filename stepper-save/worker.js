// One AgentScript model, Schelling's, kept on Cloudflare in a Durable
// Object, and remembered even when that object sleeps, by saving the whole
// model: every turtle, patch and link. (stepper/, next door, remembers a
// recipe and replays it instead.) There's one model, shared: everyone who
// uses this Worker steps the same one. Every answer is the model's data,
// as JSON. The page at / (public/index.html) has buttons for all of it.
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
import { toData, fromData } from './modelData.js'

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
// - In storage, as data: toData(model), saved after Setup and every Step.
//   Storage survives sleep.
//
// When a request finds no model in memory, the object makes it again from
// the saved data, with fromData(): no replaying, and no seed.
export class ModelHolder extends DurableObject {
    model = null // the AgentScript model, in memory
    savedBytes = 0 // how big the saved data was, last time
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
        const model = new Model()
        for (const [key, text] of Object.entries(chosen)) model[key] = Number(text)
        await model.startup()
        model.setup()
        this.model = model
        await this.save()
        return this.data(agents)
    }

    async step(n, agents) {
        const restored = await this.wake()
        if (restored === null) return { error: 'no model yet: press Setup first' }
        for (let i = 0; i < n && !this.model.done; i++) this.model.step()
        await this.save()
        return { ...this.data(agents), restored }
    }

    async show(agents) {
        const restored = await this.wake()
        if (restored === null) return { error: 'no model yet: press Setup first' }
        return { ...this.data(agents), restored }
    }

    // Save the whole model in storage. Storage takes plain objects like
    // toData()'s directly; one value can be up to 2 MB.
    async save() {
        const data = toData(this.model)
        this.savedBytes = JSON.stringify(data).length
        await this.ctx.storage.put('model', data)
    }

    // Make sure the model is in memory. Answers whether it had to be
    // restored from storage, or null if there's no model at all.
    async wake() {
        if (this.model) return false
        const data = await this.ctx.storage.get('model')
        if (!data) return null
        this.model = await fromData(Model, data)
        this.savedBytes = JSON.stringify(data).length
        return true
    }

    data(agents) {
        const model = this.model
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
            savedBytes: this.savedBytes,
            awakeSince: this.awakeSince,
            ...(agents ? toData(model) : {}),
        }
    }
}

// AgentScript models run on Cloudflare, driven by the controls of
// AgentScript's views2gui pages. Each model is kept in its own Durable
// Object, and saved and restored there as in stepper-save/. The pages, in
// public/, draw the models; remote.js connects them to this Worker.
//
// The Worker answers four requests for each model, all POSTs with the
// model's settings (its own variables, like { "density": 70 }) as JSON:
//
//   /api/schelling/start   the model there is now, or a new one if none
//   /api/schelling/setup   a new model, with these settings
//   /api/schelling/step    one step, with these settings
//   /api/schelling/show    the model there is now, unchanged
//
// Each answers with the whole model, as toData() makes it, and three more:
// version (a number that goes up with every change to the model), made
// (true if this request made a new model) and restored (true if the model
// had been forgotten, and was read back from storage).
//
// A page that already has the model sends its version, like
// /api/schelling/show?version=12. If the model hasn't changed since, the
// answer is just { same: true, version: 12 }, not the whole model again.
// Pages ask for show about once a second, to follow changes others make.
//
// AgentScript comes straight from agentscript.org. A Worker can't import
// from the web while it runs, so `deno bundle` downloads these files when
// wrangler builds, and joins them into one file (see wrangler.jsonc).
import { DurableObject } from 'cloudflare:workers'
import { toData, fromData } from 'https://agentscript.org/src/ModelData.js'
import HelloModel from 'https://agentscript.org/models/HelloModel.js'
import SchellingModel from 'https://agentscript.org/models/SchellingModel.js'
import VirusModel from 'https://agentscript.org/models/VirusModel.js'

// The models, by the names used in addresses.
const models = { hello: HelloModel, schelling: SchellingModel, virus: VirusModel }
const actions = ['start', 'setup', 'step', 'show']

// The front door: reads the address and the settings, then asks the
// model's Durable Object to do the work.
export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        const [, api, name, action] = url.pathname.split('/')
        if (api !== 'api' || !models[name] || !actions.includes(action)) {
            return new Response('Not found', { status: 404 })
        }
        const settings = request.method === 'POST' ? await request.json() : {}

        // One Durable Object for each model, named by it: everyone using
        // the Schelling page shares the "schelling" one.
        const holder = env.MODEL.getByName(name)
        try {
            const version = Number(url.searchParams.get('version') ?? -1)
            const answer = await holder.ask(name, action, settings, version)
            return Response.json(answer, { status: answer.error ? 400 : 200 })
        } catch (error) {
            // A failure inside Cloudflare, like storage: answer it as JSON,
            // so the page can show it, and log it for ./run tail.
            console.error(name, action, error)
            return Response.json({ error: String(error) }, { status: 500 })
        }
    },
}

// The Durable Object. Like stepper-save's, it keeps its model in memory,
// and saves it to storage after every change, so it can restore it when
// it wakes up after a sleep.
export class ModelHolder extends DurableObject {
    model = null // the AgentScript model, in memory
    version = 0 // goes up with every change to the model

    async ask(name, action, settings, pageVersion) {
        const Model = models[name]

        // Not in memory? Restore it from storage, if it was ever saved.
        let restored = false
        if (!this.model && action !== 'setup') {
            const data = await this.ctx.storage.get('model')
            if (data) {
                this.model = await fromData(Model, data)
                this.version = data.version ?? 0
                restored = true
            }
        }

        const made = action === 'setup' || (action === 'start' && !this.model)
        if (made) {
            const model = new Model()
            useSettings(model, settings, Model)
            await model.startup()
            model.setup()
            this.model = model
        } else if (!this.model) {
            return { error: 'no model yet' }
        } else if (action === 'step') {
            useSettings(this.model, settings, Model)
            if (!this.model.done) this.model.step()
        }

        // A change is saved, with its new version.
        const changed = made || action === 'step'
        if (changed) this.version++
        const version = this.version
        if (changed) {
            await this.ctx.storage.put('model', { ...toData(this.model), version })
        }

        // Besides the model: its version, whether it was just made, and
        // whether it was restored from storage. Neither of those two means
        // it was still in memory.
        if (version === pageVersion) return { same: true, version, restored }
        return { ...toData(this.model), version, made, restored }
    }
}

// Copy the page's settings into the model. Only the model's own variables
// are copied, the numbers, text and true/false a new model starts with
// (like density), and only with the same kind of value (a number for a
// number), so a page can't set anything else.
function useSettings(model, settings, Model) {
    const defaults = settingsOf(Model)
    for (const [key, value] of Object.entries(settings)) {
        if (key in defaults && typeof value === typeof defaults[key]) {
            model[key] = value
        }
    }
}

// A new model's own variables, worked out once for each model.
const known = new Map()
function settingsOf(Model) {
    if (!known.has(Model)) {
        const fresh = new Model()
        const plain = Object.entries(fresh).filter(
            ([key, value]) =>
                !['ticks', 'done'].includes(key) &&
                ['number', 'string', 'boolean'].includes(typeof value)
        )
        known.set(Model, Object.fromEntries(plain))
    }
    return known.get(Model)
}

// remote(Model, name): a version of an AgentScript model class that runs
// on Cloudflare instead of in the page.
//
//   import SchellingModel from 'https://agentscript.org/models/SchellingModel.js'
//   import remote from './remote.js'
//   const Model = remote(SchellingModel, 'schelling')
//
// The rest of the page uses Model exactly as usual: new Model(), setup(),
// step(), reset(), and reading and setting its variables. Views, GUIDiv
// controls, monitors and plots all work as they are. Only one line more
// is needed, to redraw when Cloudflare answers:
//
//   model.onData = () => view.draw()
//
// How it works: setup() and step() don't run the model here. They send a
// request to the Worker (worker.js), with the model's settings. The Worker
// runs the model, and answers with all of it, as data. restore() puts that
// data into this same model, so whatever holds the model, like a view,
// sees the new turtles and patches.
//
// The answer comes a little later, so step() returns before the model has
// changed: a view drawn right after step() shows the step before. That's
// what onData is for. And while a step is on its way, more step() calls,
// say from an Animator at 30 frames a second, are skipped: the model goes
// as fast as Cloudflare answers.
//
// Everyone using a model's page shares the one model on Cloudflare. So
// that each page shows it as it is, even when others step or restart it,
// a page that hasn't asked anything for a second asks to see it ("show").
// If the model hasn't changed, the answer is short: just "same".
//
// remote.js also puts a line at the top of the page, saying the model's
// tick and where Cloudflare's model came from: just made, restored from
// storage after its Durable Object slept, or still in memory.
import { restore } from 'https://agentscript.org/src/ModelData.js'

function showStatus(model, answer) {
    if (typeof document === 'undefined') return // not in a page
    let line = document.getElementById('remoteStatus')
    if (!line) {
        line = document.createElement('div')
        line.id = 'remoteStatus'
        line.style.cssText =
            'font: 14px system-ui, sans-serif; padding: 4px 8px; margin-bottom: 4px'
        document.body.prepend(line)
    }
    const from = answer.made
        ? 'a new model'
        : answer.restored
          ? 'restored from storage'
          : 'still in memory'
    line.textContent = `On Cloudflare: tick ${model.ticks} (${from})`
    // Yellow when restored, as in stepper and stepper-save
    line.style.background = answer.restored ? '#fff3c4' : '#f4f4f4'
}

export default function remote(Model, name) {
    // The model's settings: its own variables that a new model starts with,
    // like density and tolerance. The Worker uses the same rule.
    const fresh = new Model()
    const settingKeys = Object.keys(fresh).filter(
        key =>
            !['ticks', 'done'].includes(key) &&
            ['number', 'string', 'boolean'].includes(typeof fresh[key])
    )

    return class RemoteModel extends Model {
        onData = null // called after each answer, with the answer
        #started = false
        #waiting = false // a step is on its way
        #setupWaiting = false // a setup is waiting its turn
        #last = Promise.resolve() // requests go one at a time, in order
        #pending = 0 // requests sent or waiting to be
        #quietSince = 0 // when the last request was answered
        #wait = 1000 // how long a quiet page waits before asking to see the model
        #version = -1 // the version of Cloudflare's model this page has

        constructor(...args) {
            super(...args)
            // Ticks are counted on Cloudflare, and come with each answer.
            this.setAutoTick(false)
        }

        setup() {
            if (!this.#started) {
                // The first time, run setup() here too, to make the model's
                // breeds; its agents are then replaced by Cloudflare's. And
                // join the model Cloudflare has, rather than start a new one.
                super.setup()
                this.links.clear()
                this.turtles.clear()
                this.#started = true
                this.#ask('start')
                // When this page has been quiet for a while, ask to see the
                // model, in case someone else changed it. Not while the page
                // is hidden (another tab, a minimized window): nobody's
                // looking.
                setInterval(() => {
                    const quiet = Date.now() - this.#quietSince > this.#wait
                    const hidden = globalThis.document?.hidden
                    if (this.#pending === 0 && quiet && !hidden) this.#ask('show')
                }, 1000)
            } else {
                this.#ask('setup')
            }
        }

        step() {
            if (!this.#waiting) this.#ask('step')
        }

        settings() {
            return Object.fromEntries(settingKeys.map(key => [key, this[key]]))
        }

        #ask(action) {
            if (action === 'step') this.#waiting = true
            // A Setup already waiting its turn will use the latest settings
            // when it's sent, so another one would add nothing. (GUIDiv
            // runs each slider's command once as it starts, and in
            // views2gui pages that command restarts the model: without
            // this, a page would send a Setup for every slider.)
            if (action === 'setup') {
                if (this.#setupWaiting) return
                this.#setupWaiting = true
            }
            this.#pending++
            this.#last = this.#last.then(() => this.#send(action))
        }

        async #send(action) {
            if (action === 'setup') this.#setupWaiting = false
            const sent = this.settings()
            try {
                const query = action === 'show' ? `?version=${this.#version}` : ''
                const response = await fetch(`/api/${name}/${action}${query}`, {
                    method: 'POST',
                    body: JSON.stringify(sent),
                })
                const answer = await response.json()
                if (answer.error) return console.error(action, answer.error)
                this.#version = answer.version
                // While the model isn't changing, wait longer each time
                // before asking again: 1, 2, 4, … up to 30 seconds. That
                // lets Cloudflare put the model's Durable Object to sleep
                // (after about 10 seconds alone), and saves requests.
                // Any change, or any request but show, starts again at 1.
                if (answer.same) {
                    this.#wait = Math.min(this.#wait * 2, 30000)
                    return showStatus(this, answer)
                }
                this.#wait = 1000

                const now = this.settings()
                restore(this, answer)
                // The page's settings are its controls', so some answers
                // mustn't change them:
                // - a setting changed here while the request was on its way,
                //   say by a slider, keeps its new value;
                // - while a Setup waits to be sent, all of them stay: that
                //   Setup will send them;
                // - "show" never changes them: it's only for watching.
                for (const key of settingKeys) {
                    const keep =
                        action === 'show' ||
                        this.#setupWaiting ||
                        now[key] !== sent[key]
                    if (keep) this[key] = now[key]
                }
                this.onData?.(answer)
                showStatus(this, answer)
            } catch (error) {
                console.error(action, error)
            } finally {
                if (action === 'step') this.#waiting = false
                this.#pending--
                this.#quietSince = Date.now()
            }
        }
    }
}

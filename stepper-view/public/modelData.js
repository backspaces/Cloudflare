// Save a whole AgentScript model as plain data, and make a working model
// from that data again:
//
//   const data = toData(model)            // plain objects: can be JSON, or stored
//   const model = await fromData(Model, data)
//
// The data has every turtle, patch and link, with their ids, breeds and
// variables, the links' two ends, and the model's own variables and ticks.
// The restored model carries on exactly as the saved one would have.
//
// It runs in the browser and on Cloudflare alike: worker.js uses it to save
// and restore the model, and the page uses fromData() to make a model it
// can draw. A copy of stepper-save/modelData.js. It's meant to move into
// AgentScript.
import AgentArray from 'https://agentscript.org/src/AgentArray.js'

// ---- Saving -----------------------------------------------------------

export function toData(model) {
    return {
        variables: values(model, ['ticks', 'done']),
        ticks: model.ticks,
        done: model.done ?? false,
        // The ids the next new turtle and link will get
        nextIds: { turtles: model.turtles.ID, links: model.links.ID },
        patches: model.patches.map(p => ({ breed: breedName(p), ...values(p, ['turtles']) })),
        turtles: model.turtles.map(t => ({ breed: breedName(t), ...values(t) })),
        links: model.links.map(l => ({
            breed: breedName(l),
            ...values(l, ['end0', 'end1']),
            end0: l.end0.id,
            end1: l.end1.id,
        })),
    }
}

const breedName = agent => agent.agentSet.name

// An object's variables that are data. AgentScript keeps its own wiring (a
// turtle's links, a patch's neighbors) in read-only properties, so only
// what a model can write is saved.
function values(object, skip = []) {
    const out = {}
    for (const [key, value] of Object.entries(object)) {
        if (skip.includes(key) || !writable(object, key)) continue
        const saved = encode(value)
        if (saved !== undefined) out[key] = saved
    }
    return out
}
const writable = (object, key) => Object.getOwnPropertyDescriptor(object, key).writable

// A value as data:
// - a number, text, true/false or null: as it is
// - an agent: a reference to it, like { agent: 'turtles', id: 3 }
// - a list of those (a turtle's path, say): { list: [...] }
// Anything else, like a function, or an AgentSet such as model.turtles,
// answers undefined, and isn't saved.
function encode(value) {
    if (isPlain(value)) return value
    if (isAgent(value)) return { agent: value.agentSet.baseSet.name, id: value.id }
    if (Array.isArray(value) && !value.baseSet) {
        const items = value.map(encode)
        if (!items.includes(undefined)) {
            return { list: items, agentArray: value.constructor.name !== 'Array' }
        }
    }
    return undefined
}
const isPlain = v => ['number', 'string', 'boolean'].includes(typeof v) || v === null
const isAgent = v => v && typeof v === 'object' && v.agentSet && typeof v.id === 'number'

// ---- Restoring --------------------------------------------------------

export async function fromData(Model, data) {
    // Start the way any model starts. setup() makes the model's breeds and
    // defaults; then its turtles and links are replaced by the saved ones.
    const model = new Model()
    await model.startup() // loads any data the model needs
    model.setup()
    model.links.clear()
    model.turtles.clear()
    const breed = (base, name) => model[name] ?? model[base]

    // The turtles and links again, with their saved ids, in id order.
    const turtleById = new Map()
    for (const t of data.turtles) {
        model.turtles.ID = t.id
        turtleById.set(t.id, breed('turtles', t.breed).createOne())
    }
    const linkById = new Map()
    for (const l of data.links) {
        model.links.ID = l.id
        const [end0, end1] = [turtleById.get(l.end0), turtleById.get(l.end1)]
        linkById.set(l.id, breed('links', l.breed).createOne(end0, end1))
    }
    model.turtles.ID = data.nextIds.turtles
    model.links.ID = data.nextIds.links

    // Then everyone's variables. They come after making all the agents, so
    // a reference to any agent can be found.
    const find = {
        turtles: id => turtleById.get(id),
        links: id => linkById.get(id),
        patches: id => model.patches[id],
    }
    const decode = value => {
        if (value?.agent) return find[value.agent](value.id)
        if (value?.list) {
            const items = value.list.map(decode)
            return value.agentArray ? AgentArray.from(items) : items
        }
        return value
    }
    const fill = (object, saved, skip) => {
        for (const [key, value] of Object.entries(saved)) {
            if (!skip.includes(key)) object[key] = decode(value)
        }
    }

    data.patches.forEach((saved, i) => {
        const patch = model.patches[i]
        // setup() may have given this patch variables the saved one didn't
        // have: remove them.
        for (const [key, value] of Object.entries(patch)) {
            if (key === 'id' || key === 'turtles' || !writable(patch, key)) continue
            if (encode(value) !== undefined) delete patch[key]
        }
        breed('patches', saved.breed).setBreed(patch)
        fill(patch, saved, ['breed', 'id'])
    })
    for (const t of data.turtles) fill(turtleById.get(t.id), t, ['breed', 'id'])
    for (const l of data.links) fill(linkById.get(l.id), l, ['breed', 'id', 'end0', 'end1'])
    fill(model, data.variables, [])
    model.ticks = data.ticks
    model.done = data.done

    // Each patch remembers which turtles are on it; make them work it out
    // afresh, from where the turtles are now.
    model.patches.ask(p => (p.turtles = null))
    return model
}

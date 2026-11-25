# save-restore

How to keep something that can be forgotten at any moment: save it as
data after each change, and when it's gone, make it again from that data.

That's the one idea every Cloudflare **Durable Object** depends on, for an
AgentScript model, a chat room, a game, or anything else. This folder shows it
with no server at all: one web page, running AgentScript's Hello model, with
buttons for each part, and the saved data shown in full, so you can see exactly
what's kept.

This README assumes you know some JavaScript, and a little AgentScript for
the second half. New words are in **bold** the first time, and listed at the
end. [hello/](../hello/) explains Workers and Durable Objects from the start.

## Try it

    ./run dev

Open http://localhost:8787. (It's only a page: opening
`public/index.html` from any small web server works too.)

1. **Setup**, then **Step ×10** a few times. The turtles wander out from
   the middle.
2. **Save: toData(model)**. The model is turned into plain data and kept in
   the browser's storage. The data appears at the bottom: the model's own
   variables, its 10 turtles, its 10 links and its 1,089 patches.
3. **Reload the page.** The drawing is gone: the model was a JavaScript
   variable, and reloading forgets every variable. But "In storage" still
   shows the saved model.
4. **fromData: a new model**. The model is back, at the tick you saved,
   every turtle where it was. Step it: it carries on.
5. Step a few more times, then **restore: into this model**. The model goes
   back to the saved tick, without being replaced.

**Forget** does what reloading does, without leaving the page.

The browser's console (Option-Command-J in Chrome) has the page's `model`
and `view`, always the current ones, and `Model`, `toData`, `fromData` and
`restore`. Try:

```js
model.ticks                         // where it is
model.turtles[0]                    // one turtle, the real thing
toData(model).turtles[0]            // the same turtle, as saved data
model.step(); view.draw()           // a step, from the console
const m = await fromData(Model, toData(model)) // a copy, drawn nowhere
```

(Stepping from the console doesn't update the page's "Now" box; the next
button press does.)

## The idea, without AgentScript

Anything a program is working on lives in two kinds of places:

- **Memory**: its variables. Fast and easy, but lost when the program
  stops.
- **Storage**: kept on disk, or by some service. It lasts, but you have to put
  things there and get them back yourself.

A Durable Object's memory can be lost at any time: Cloudflare puts an object
nobody is using to sleep, about 10 seconds after its last request, and
memory goes with it (stepper/ measured this). Its storage, `ctx.storage`,
lasts. So a Durable Object that must remember something does three things:

1. **Keep it as plain data**, or know how to turn it into plain data:
   numbers, text, lists and objects of those, the things JSON can hold.
2. **Save it after each change**, to storage.
3. **When memory is empty, read it back** from storage, before doing
   anything else.

Here's all of it, for a shared list of messages, a chat room, say:

```js
import { DurableObject } from 'cloudflare:workers'

export class Room extends DurableObject {
    messages = null // in memory: lost when the object sleeps

    async add(text) {
        // 3. Memory empty? Read the messages back from storage
        //    (or start a new list, the very first time).
        this.messages ??= (await this.ctx.storage.get('messages')) ?? []

        this.messages.push(text)

        // 2. Save after each change.
        await this.ctx.storage.put('messages', this.messages)
        return this.messages
    }
}
```

The messages are already plain data (1.), a list of text, so they go into
storage just as they are. Nobody using the room can tell when the object
slept: every request finds the messages, in memory or read back.

This page does the same thing in a browser, where the two places are:

| | In a Durable Object | In this page |
| --- | --- | --- |
| memory | the object's variables, lost when it sleeps | the page's variables, lost when you reload |
| storage | `ctx.storage`, survives sleep | `localStorage`, survives reloading |
| save | `ctx.storage.put('model', data)` | `localStorage.setItem('save-restore', JSON.stringify(data))` |
| read back | `ctx.storage.get('model')` | `JSON.parse(localStorage.getItem('save-restore'))` |
| shared? | yes: one object, everyone reaches it | no: each browser has its own |

## AgentScript's part: ModelData.js

An AgentScript model isn't plain data. A turtle knows its patch, a link
knows its two turtles, and the model has functions. JSON can't hold any of
that, so the model can't just be put in storage. AgentScript's
[ModelData.js](https://agentscript.org/src/ModelData.js) does step 1 for
a model, both ways:

```js
import { toData, fromData, restore } from 'https://agentscript.org/src/ModelData.js'

const data = toData(model)               // the model, as plain data, to save
const model2 = await fromData(Model, data) // a new model, made from it
restore(model3, data)                    // or: put it into a model there is
```

### toData(model): save

Turns the model into plain data. Click "All of it, as saved" on the page to
see the whole thing. It has:

- `variables`: the model's own settings, like Hello's `population: 10`
  and `speed: 0.1`.
- `ticks` and `done`: how far it has run, and whether it has finished.
- `nextIds`: the id the next new turtle and link will get, so new ones
  don't repeat old ids.
- `turtles`: each turtle's breed, id, position (`x`, `y`) and heading
  (`theta`, in radians), plus any variables the model gave it.
- `links`: each link's breed and id, and its two ends, `end0` and `end1`,
  as turtle ids.
- `patches`: each patch's breed and id, plus any variables the model gave
  it. Hello's patches have none, so they're each just `{"breed":"patches","id":0}`,
  but there are 1,089 of them, so they're most of the 33 KB.

An agent that points at another agent, like a turtle's `home` patch, is
saved as `{ "agent": "patches", "id": 40 }`. Anything that isn't data,
like a function, isn't saved. Neither is AgentScript's own wiring, like
which turtles are on which patch: it can work that out again.

### fromData(Model, data): make a new model

Makes a brand-new model of that class, as usual (`new Model()`,
`startup()`, `setup()`), then fills it with the saved data. It's async,
because `startup()` may load files.

Use it when there's **nothing in memory**: after a reload here, or when a
Durable Object wakes up.

### restore(model, data): fill a model that exists

Puts the data into a model you already have: its turtles and links are
replaced, and its patches and variables set, but it stays **the same model
object**, with the same `model.turtles`, `model.patches` and
`model.links`.

That matters when other things hold on to the model. Here, it's the
drawing. The page's view was made for one model; after fromData, there's a
new one, and the page has to tell the view about it:

```js
view.model = model
view.drawOptions.turtles = model.turtles
view.drawOptions.links = model.links
```

After restore, there's nothing to tell: the view still has the right model,
and just draws again. That's why [stepper-gui/](../stepper-gui/) uses
restore: each page has a model with a view, sliders, monitors and plots all
attached, and the data from Cloudflare is restored into it.

It also lets you go back: restore the data saved at tick 10 into a model at
tick 15, and it's at tick 10 again.

**Which one?** Nothing in memory: fromData. A model that others are using:
restore.

## On Cloudflare

[stepper-save/](../stepper-save/) is this page's idea in a Durable
Object. Its whole remembering is two short methods (shortened a little
here):

```js
async save() {                       // after Setup, and after every Step
    await this.ctx.storage.put('model', toData(this.model))
}

async wake() {                       // before every request
    if (this.model) return           // still in memory
    const data = await this.ctx.storage.get('model')
    this.model = await fromData(Model, data)
}
```

Its page shows "restored from storage" when a request found the model
forgotten. [stepper-view/](../stepper-view/) draws it, and
[stepper-gui/](../stepper-gui/) runs AgentScript's own pages that way.

## Limits, and choices

- **Size.** A Durable Object stores up to 2 MB in one value; a browser's
  localStorage holds about 5 MB per site. Hello is 33 KB and Schelling
  about 230 KB, but Diffuse and Fire are about 3 MB, because their patches
  have variables: they'd need saving in parts.
- **How often to save.** Saving after every change means nothing is ever
  lost, but it's work each time. A model could save every 10 steps
  instead, and lose up to 9 steps if forgotten. Something small, like the
  chat room, should simply save every time.
- **The other way: a recipe.** [stepper/](../stepper/) doesn't save the
  model. It saves how to make it again, the settings, a random seed and the
  number of steps, and replays them on waking. A few dozen bytes, but the
  replay takes longer the longer the model has run.

## The files

| File | What it is |
| --- | --- |
| [public/index.html](public/index.html) | the whole example: the page, its buttons, and the code |
| [wrangler.jsonc](wrangler.jsonc) | the settings: the name, and that public/ is served as it is |
| [run](run) | runs wrangler here, through Deno |

There's no worker.js: Cloudflare only serves the page, and all the code
runs in your browser.

## Running it yourself

From this folder:

    ./run dev          # on this Mac, at http://localhost:8787
    ./run deploy       # to Cloudflare, at https://save-restore.<subdomain>.workers.dev

## Words

| Word | Meaning |
| --- | --- |
| Durable Object | one object on Cloudflare that every request reaches; its memory can be lost, its storage lasts |
| memory | a program's variables: fast, lost when the program stops or sleeps |
| storage | where data that must last is kept: `ctx.storage` on Cloudflare, `localStorage` in a browser |
| plain data | numbers, text, true/false, and lists and objects of those: what JSON can hold |
| toData | AgentScript: a model, as plain data |
| fromData | AgentScript: a new model, made from that data |
| restore | AgentScript: that data, put into a model that already exists |

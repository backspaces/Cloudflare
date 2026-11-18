# stepper-save

The same as [stepper/](../stepper/): one Schelling model on Cloudflare,
which you set up and step from a page with buttons, and which is
remembered even after Cloudflare forgets it. The difference is **how** it's
remembered:

| | stepper | stepper-save |
| --- | --- | --- |
| What's kept in storage | a recipe: settings, a random seed, how many steps | the whole model: every turtle, patch and link |
| How big that is | a few dozen bytes | about 220 KB for Schelling |
| Waking up | run the model again, step by step, up to where it was | read the saved model back in |
| Gets slower as the model runs? | yes: more steps to replay | no |
| Needs a seed, and the same AgentScript code? | yes | no |

Read [stepper/](../stepper/) first: this README only covers what's
different. The buttons, the answers, the Durable Object, why it forgets
and where AgentScript comes from are all the same, and explained there.

Live: https://stepper-save.backspaces.workers.dev

## Try it

Open https://stepper-save.backspaces.workers.dev (or, with `./run dev`,
http://localhost:8787). Press Setup, then Step a few times. Then wait a
minute and press Show: the yellow note says the model was restored from
storage, and how big the saved model was. (On your Mac, stopping
`./run dev` and starting it again also makes it forget, without the
wait.)

The live model is shared, as in stepper: if someone else presses Setup
while you're trying it, you'll see their model instead.

The answer has two new fields:

- `restored`: true if the model had been forgotten and was read back from
  storage, false if it was still in memory.
- `savedBytes`: how big the saved model is, written out as text.

## Saving and restoring a model

AgentScript's [ModelData.js](https://agentscript.org/src/ModelData.js)
has two functions, and they work for any AgentScript model, not only
Schelling. worker.js imports them from agentscript.org, like the model:

```js
import { toData, fromData } from 'https://agentscript.org/src/ModelData.js'
```

Then:

```js
const data = toData(model)                 // the whole model, as plain data
const model2 = await fromData(Model, data) // a working model again
```

`toData` writes down, for every turtle, patch and link, its id, its breed
and its variables, and for a link the ids of its two ends. It also writes
the model's own variables, like `density` and `percentHappy`, and its
`ticks`. What it leaves out is AgentScript's wiring, like each patch's list
of neighbors, which AgentScript builds itself.

`fromData` makes a new model the ordinary way, `new Model()` and
`setup()`, so it gets its breeds and settings. Then it throws away the
turtles and links `setup()` made, and puts the saved ones in their place,
with their saved ids.

The restored model isn't just similar: it's the same model. It carries on
exactly as the saved one would have, step for step. We checked by saving
and restoring each of AgentScript's 31 example models.

## In worker.js

The Durable Object, `class ModelHolder`, saves after Setup and after
every Step:

```js
await this.ctx.storage.put('model', toData(this.model))
```

and when a request finds no model in memory, it restores it:

```js
this.model = await fromData(Model, await this.ctx.storage.get('model'))
```

That's all there is to it. stepper's seed, its swapping of `Math.random`
and its replay loop are gone.

## What it costs

- **Storage**: about 220 KB for Schelling, saved after every Step. One
  stored value can be up to 2 MB, so Schelling fits easily. Some
  AgentScript models don't: Fire, Diffuse, Water and Roads each come to
  about 3 MB, and would need saving in parts.
- **Time**: saving is part of every Step; we haven't timed it on its
  own yet. A Show that had to restore took about 30 ms on a Mac, much of
  it `setup()` making a model that's then replaced. That's about the
  same as replaying a few Schelling steps, but it stays the same however
  long the model has run.

## Not only for Cloudflare

ModelData.js began here, as a trial, and is now part of AgentScript, so
any model, on Cloudflare or not, can be saved to a file or sent to
another page. [stepper-view/](../stepper-view/) does that: it sends the
model to a page that draws it.

## Running it yourself

From this folder:

    ./run dev          # on this Mac, at http://localhost:8787
    ./run bundle       # write what Cloudflare would get into out/, send nothing
    ./run deploy       # to Cloudflare, at https://stepper-save.<subdomain>.workers.dev
    ./run tail         # watch requests, with their CPU times

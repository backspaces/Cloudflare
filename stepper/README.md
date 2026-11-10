# stepper

An AgentScript model that lives on Cloudflare: you set it up, then step it
whenever you like, and it remembers where it was, even hours later. Each
answer is the model's data, as text. It's the **M** of AgentScript's Model,
View, Controller, on its own; the page here only has buttons to drive it.

It answers two questions:

1. **Where does a model live between steps?** A Worker forgets everything
   after each request (see [hello/](../hello/)), but a model has to
   remember where every turtle is.
2. **Is AgentScript too heavy for this?** How much computer time does a
   step take, and how big is a model's data?

Read [hello/](../hello/) first: this builds on its Durable Object.

Live: https://stepper.backspaces.workers.dev

## Try it

Open https://stepper.backspaces.workers.dev (or, with `./run dev`,
http://localhost:8787). The page has:

- **Settings**: Schelling's two, filled in with its defaults,
  `density=90&tolerance=50`. Edit them before Setup to try others.
- **Setup** makes a new model. **Step** and **Step ×10** run it. **Show**
  shows it without stepping.

Then wait a minute and press Step again. The yellow note says the model
had been forgotten and was rebuilt: that's below, in "It forgets".

There's one model, and everyone shares it: if a teammate presses Setup
while you're stepping, your next Step carries on from their new model.
That's the point of a Durable Object (below), shown the friendly way.

The answer looks like this:

```json
{
  "ticks": 2,
  "done": false,
  "settings": { "density": 90, "tolerance": 50 },
  "results": { "percentHappy": 85 },
  "counts": { "turtles": 2380, "patches": 2601, "links": 0 },
  "dataBytes": 234687,
  "awakeSince": "2026-11-05T20:41:02.114Z",
  "replayed": 0
}
```

- `settings` are the model's variables you choose.
- `results` are the ones it works out: `percentHappy` is the percent of
  turtles happy with their neighbors. At 100, the model is `done`.
- `counts` says how many turtles, patches and links it has.
- `dataBytes` is how big all their data is, written out as text.
- `awakeSince` is when the object holding the model last woke up.
- `replayed` is how many steps were rerun to rebuild a forgotten model: 0
  if it was still in memory.

### Without the page

Each button is just an address, so a browser, `curl` or another program
can do the same:

    /setup?density=70&tolerance=40
    /step
    /step?n=10
    /show

To see every turtle, patch and link, not just how many there are, add
`agents` to any of them (`/step?agents`, or `&agents`).

## Where the model lives

A Worker can't keep the model: the next request may be answered by a
different copy of the code, in another city, and JavaScript variables don't
carry over.

So the model lives in a **Durable Object**, the kind of object hello uses
for its counter: one object, in one place, that every request reaches.
hello's Counter keeps a number; this one keeps a whole AgentScript model.

```
browser ──/step──▶ Worker (keeps nothing) ──step()──▶ Durable Object "schelling"
                                                       holds the model
```

In [worker.js](worker.js):

- `fetch()` is the front door. It reads the address, finds the Durable
  Object (`env.MODEL.getByName('schelling')`), and asks it to `setup()`,
  `step()` or `show()`.
- `class ModelHolder` is the Durable Object. Its `model` variable holds the
  AgentScript model.

Asking for a different name would give a different object, with its own
model: that's how a Worker could keep one model per person. Here, one
shared model keeps it simple.

### It forgets

A Durable Object keeps its variables in memory, and memory doesn't last. A
Durable Object that nobody uses for a while is put to sleep by Cloudflare,
and its memory, the model with it, is gone. We measured how quickly:

| Left alone for | Model in memory |
| --- | --- |
| 5 seconds | still there |
| 10 seconds and longer | forgotten |

`awakeSince` shows it: when it changes, the object slept and woke up again.

### So it remembers a recipe

hello's counter doesn't have this problem, because it saves the count in
the object's **storage**, which survives sleep. Stepper does the same, but
it doesn't save the whole model, all its turtles and patches. It saves a
**recipe** for making it again, a few dozen bytes:

```json
{ "settings": { "density": "70" }, "seed": 1840211873, "ticks": 12 }
```

- **settings**: the ones chosen at Setup.
- **seed**: a random number picked once, at Setup.
- **ticks**: how many steps have run, saved again after every step.

When a request finds no model in memory, the object follows the recipe:
it makes the model with the same settings, gives it the same seed, runs
`setup()`, and then runs `step()` until it reaches tick 12. Then it carries
on with the request. `replayed` says how many steps that took.

In short: **remember which step we're on, and to rebuild, run the model
that many steps, with a seed that makes the run come out the same.**

### Why the replay is exact

AgentScript models use random numbers, for where turtles start and where
they move. A seed makes those numbers come out the same every time, so the
same steps give the same model, turtle for turtle. We checked: a Schelling
model's 2,300 turtles were all in the same places after a replay.

The model doesn't know about any of this. AgentScript has a seeded random
number generator, `util.randomSeed()`, made for testing; stepper gives one
to the model and swaps it into `Math.random` only while the model runs.
Finished AgentScript models aren't usually seeded, and they don't need to
change for this.

It's exact only while three things hold:

1. **All the model's randomness comes from `Math.random`.** AgentScript's
   own `oneOf()`, `shuffle()` and the rest do. A model with its own random
   numbers, from somewhere else, would replay differently.
2. **The model depends on nothing outside itself**: not the clock, not
   data fetched from the web that might change. Same model, same run.
3. **AgentScript's code is the same as on the first run.** The Worker
   carries the copy it was built with. A redeploy that brings a changed
   SchellingModel or AgentScript could replay differently, so after a
   redeploy, start again with Setup.

### What it costs, and what comes next

The cost is computer time on waking: replaying is running the model again,
and it grows with the number of steps. Schelling's first steps are its
heaviest (see below), but it finishes in a few dozen steps, so a replay is
never long. A model that runs for thousands of steps would spend longer
and longer waking.

The fix for that is **save and restore**: save every turtle, patch and
link, and rebuild the model from them. Waking would be instant, with no
replay, and none of the three conditions above would matter. `dataBytes`
shows how much there is to save: about 230 KB for Schelling, which fits
easily in a Durable Object's storage. A middle way would combine the two:
save everything now and then, and replay only the steps since.

What's missing is in AgentScript: it has no way yet to rebuild a working
model from its data. That would take something like `model.toData()` and
`Model.fromData(data)`, restoring each turtle with its id, breed and
position, each patch's variables, each link between the right two turtles,
and the model's own variables and `ticks`. It's the planned next step, and
it would be useful outside Cloudflare too: saving a model to a file, or
sending one to another page.

## What a model's data is

Every AgentScript model has the same parts: turtles, patches and links,
each with its own data. `?agents` shows them. For each one it keeps the
plain values (numbers, text, true or false), its breed, and for a link,
the ids of the two turtles it joins:

```json
{ "breed": "Xs", "id": 0, "theta": 1.57, "x": -25, "y": 25 }
```

It leaves out AgentScript's internal wiring, like each patch's list of
neighbors, which AgentScript can rebuild.

What shows up surprised us a little: Schelling's patches have no data of
their own, only an id. Whether a patch is empty is worked out from where the
turtles are. So nearly all of Schelling's data is its turtles: about 2,400
of them, with an id, a position and a breed each.

## Is AgentScript too heavy?

The Worker carries the parts of AgentScript a model needs, 20 files (see
"Where AgentScript comes from" below), so it's bigger than hello: 103 KB
(26 KB compressed), against hello's 2 KB. It still starts in 3 thousandths
of a second, so size isn't a problem.

The real measure is **CPU time**: how long Cloudflare's computer works on
each request. From `./run tail`:

| Request | CPU time |
| --- | --- |
| the front door, any request | 0 to 1 ms |
| Schelling, setup | 70 ms |
| Schelling, steps 1 to 8 | 504, 299, 150, 103, 79, 61, 52, 50 ms |
| Hello, setup | 8 ms |
| Hello, each step | 1 to 5 ms |

(ms is a thousandth of a second. Stepper ran AgentScript's HelloModel too
at first, for comparison.)

- **Hello is light.** A step takes a few ms.
- **Schelling's first steps are heavy**, because nearly every unhappy turtle
  searches all 2,601 patches for an empty one. Steps get cheaper as more
  turtles are happy and stay put.

Cloudflare's free plan nominally allows 10 ms per request. These Schelling
steps went far over and weren't stopped, so the limit for Durable Objects
seems to be looser than for plain Workers (where [model/](../model/) was
stopped). We shouldn't count on that: a model that's heavy per step belongs
on the paid plan, $5 a month, which allows 30 seconds per request.

So: AgentScript itself isn't too heavy to carry. Whether a model is too
heavy depends on the model, and Hello-sized models fit easily.

## Where AgentScript comes from

worker.js imports the model straight from the AgentScript website, the
same way an AgentScript web page does:

```js
import Model from 'https://agentscript.org/models/SchellingModel.js'
```

But a Worker can't download code while it runs: Cloudflare only runs code
that was sent to it with the Worker. So the downloading happens earlier, on
your Mac, when wrangler builds the Worker:

1. Before `./run dev` or `./run deploy`, wrangler runs the `build` command
   in [wrangler.jsonc](wrangler.jsonc): `deno bundle`.
2. Deno starts at worker.js, follows every import, downloads each file from
   agentscript.org, and joins them all into one file, `build/worker.js`.
3. Wrangler sends that one file to Cloudflare.

```
worker.js ──imports──▶ agentscript.org/models/SchellingModel.js ──▶ src/Model.js ──▶ …
     └──────── deno bundle, on your Mac ────────▶ build/worker.js ──deploy──▶ Cloudflare
```

`deploy` lists every file it downloads. There are 20: the model files,
`Model`, `World`, `Patches`, `Turtles`, `Links` and their helpers. That's
all of AgentScript the Worker contains; the views, controls, maps and 3D
are never downloaded, because nothing imports them.

It downloads them afresh on every build (that's the `-r` in the
command), so each deploy uses whatever is on agentscript.org at that
moment. If the website changes, the next deploy picks it up; until then,
the Worker on Cloudflare keeps the copy it was built with.

`build/` is made by wrangler, and git ignores it.

## The files

| File | What it is |
| --- | --- |
| [worker.js](worker.js) | the front door, and the Durable Object that holds and remembers the model |
| [public/index.html](public/index.html) | the page with buttons, served as it is |
| [wrangler.jsonc](wrangler.jsonc) | the settings: name, the build command, the page, the Durable Object (`env.MODEL`) |
| [run](run) | runs wrangler here, through Deno |
| `build/` | worker.js joined with AgentScript, made by the build (not in git) |

## Running it yourself

From this folder:

    ./run dev          # on this Mac, at http://localhost:8787
    ./run bundle       # write what Cloudflare would get into out/, send nothing
    ./run deploy       # to Cloudflare
    ./run tail         # watch requests, with their CPU times

Nothing to install first: Deno downloads wrangler, and wrangler's build
downloads AgentScript.

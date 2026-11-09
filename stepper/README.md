# stepper

An AgentScript model that lives on Cloudflare and takes one step each time
you ask. There's no page and no drawing: each answer is the model's data,
as text. It's the **M** of AgentScript's Model, View, Controller, on its
own.

It's here to answer two questions:

1. **Where does a model live between steps?** A Worker forgets everything
   after each request (see [hello/](../hello/)), but a model has to
   remember where every turtle is.
2. **Is AgentScript too heavy for this?** How much computer time does a
   step take, and how big is a model's data?

Read [hello/](../hello/) first: this builds on its Durable Object.

Live: https://stepper.backspaces.workers.dev

## Try it

Open these addresses in your browser, in order:

1. https://stepper.backspaces.workers.dev/mine/setup?model=schelling

   Makes a new Schelling model, named `mine`, and shows its data. The name
   is up to you; each name is a separate model.

2. https://stepper.backspaces.workers.dev/mine/step

   Runs one step and shows the data again. Reload to step again, and watch
   `ticks` count up and `percentHappy` rise.

3. https://stepper.backspaces.workers.dev/mine

   Shows the data without stepping.

The answer looks like this (Firefox shows it neatly; in Chrome, tick
"Pretty print"):

```json
{
  "model": "schelling",
  "ticks": 2,
  "done": false,
  "params": { "density": 90, "tolerance": 50, "percentHappy": 85 },
  "counts": { "turtles": 2380, "patches": 2601, "links": 0 },
  "dataBytes": 234687,
  "awakeSince": "2026-11-05T20:41:02.114Z"
}
```

- `params` are the model's settings and results, its own variables.
- `counts` says how many turtles, patches and links it has.
- `dataBytes` is how big all their data is, written out as text.
- `awakeSince` is when the object holding the model last woke up (more
  below).

Change settings when you set up, by adding them to the address:

    /mine/setup?model=schelling&density=70&tolerance=40

To see every turtle, patch and link, not just how many there are, add
`agents` to any address:

    /mine/step?agents

There are two models to try: `schelling`, and `hello` (AgentScript's
HelloModel, which also has links):

    /h/setup?model=hello&population=5&agents

## Where the model lives

A Worker can't keep the model: the next request may be answered by a
different copy of the code, in another city, and JavaScript variables don't
carry over.

So each model lives in its own **Durable Object**, the kind of object
hello uses for its counter: one object, in one place, that every request
for its name reaches. hello's Counter keeps a number; here, each object
keeps a whole AgentScript model.

```
browser ──/mine/step──▶ Worker (keeps nothing) ──step()──▶ Durable Object "mine"
                                                           holds the model
```

In [worker.js](worker.js):

- `fetch()` is the front door. It reads the address, finds the Durable
  Object for that name (`env.MODELS.getByName(name)`), and asks it to
  `setup()`, `step()` or show its `data()`.
- `class ModelHolder` is the Durable Object. Its `model` variable holds the
  AgentScript model.

But there's a catch, and it's the point of this experiment. The model is
kept in an ordinary variable, in memory. A Durable Object that nobody uses
for a while is put to sleep by Cloudflare, and when it sleeps, its memory
is gone. The next request wakes up a fresh object with no model, and gets:

    no model here: either it was never set up, or it was forgotten when
    this object went to sleep

`awakeSince` shows when that happened: if it changes, the object slept and
woke up again.

hello's counter doesn't have this problem, because it saves the count in
the object's **storage**, which survives sleep. A model could be saved
there too, but that means turning all its turtles, patches and links into
data that can be stored, and back into a working model on waking. That's
what `dataBytes` measures: how much there would be to save.

### How long before it forgets?

Very quickly. We set up models, left each alone for a different time, then
checked it once:

| Left alone for | Model |
| --- | --- |
| 5 seconds | still there |
| 10 seconds and longer | forgotten |

So a model kept only in memory lasts while you keep stepping it, and is
gone 10 seconds after you stop. To keep a model for longer, it has to be
saved to the object's storage. That's the next experiment.

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

(ms is a thousandth of a second.)

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

worker.js imports the models straight from the AgentScript website, the
same way an AgentScript web page does:

```ts
import Schelling from 'https://agentscript.org/models/SchellingModel.js'
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
| [worker.js](worker.js) | the front door and the Durable Object that holds each model |
| [wrangler.jsonc](wrangler.jsonc) | the settings: name, the build command, the Durable Object |
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

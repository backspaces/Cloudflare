# model

An AgentScript model running **on Cloudflare**, not in the browser. A
[playground](../playground/) sends the page to your browser and the model
runs there; this Worker runs the model itself, on Cloudflare's machines, and
sends back the result.

    https://model.backspaces.workers.dev/run?ticks=10&seed=1

Each request builds a fresh SchellingModel, steps it, and returns JSON:
`ticks`, `done`, `percentHappy`, and `grid`, the board as rows of `X`, `O`
and `.` for empty. With a `seed` the same request always gives the same
run; `ticks` is capped at 1000.

## Why the code has to be bundled

On Deno, SchellingLive starts with

    import Model from 'https://agentscript.org/models/SchellingModel.js'

and Deno downloads that file, and everything it imports, when the server
starts. **Workers can't do that.** A Worker runs only the code that was
uploaded with it: no imports from URLs, and no `eval` or `new Function`
either. Cloudflare starts a Worker in whichever of its data centers a
request lands in, in a few milliseconds, so the code has to be complete and
fixed when you deploy; there's no time, or permission, to go fetch more.

That's only true of code. A running Worker can `fetch()` anything on the
web: JSON, images, a model's data files. Only the JavaScript must be
uploaded.

So the code is **bundled**: before uploading, wrangler starts at
[worker.ts](worker.ts), follows its imports, and joins every file they
reach into one `worker.js`, which is what gets uploaded.

```
worker.ts ──▶ schelling.js ──▶ agentscript ──▶ ...   follow the imports
                                                     on this computer
   └──────────────── one worker.js ───────────▶ Cloudflare
```

## Where agentscript comes from

`from 'agentscript/...'` has no `./` and no URL, so it means "the npm
package in `node_modules/`". [package.json](package.json) lists
`agentscript`, and `deno install` downloads it there, the way `npm install`
would. `node_modules/` isn't committed (git ignores it), and VS Code dims
or hides it, so after cloning, run `deno install` in this folder first.

## Not all of AgentScript is uploaded

The whole npm package lands in `node_modules/`: 18 MB, with the docs, the
IDE, the maplibre and leaflet examples and more. **Only code the imports
actually reach is bundled**, so maplibre, leaflet, three.js and the views
are never uploaded: nothing here imports them.

| Imports from | Uploaded | What's in it |
| --- | --- | --- |
| `dist/agentscript2d.js` (now) | 301 KB, 71 KB gzipped | the whole 2D one-file bundle |
| `src/` (after AgentScript 0.10.28) | 99 KB, 25 KB gzipped | the 17 modules a model needs: `Model`, `World`, `Patches`, `Turtles`, `Links`, `utils` … |

The free plan allows 3 MB, so either fits easily.

## Why there are workarounds (for now)

AgentScript 0.10.27, the version on npm, wasn't written with bundlers in
mind:

- **`src/` and `models/` import with root paths**, like `/src/utils.js`, or
  full `https://agentscript.org/...` URLs. Those only work when the files are
  served from agentscript.org, so a bundler can't follow them. `vendor/`,
  which `src/` imports, isn't in the npm package at all.
- **`Color.js` makes a canvas as it loads**, and Workers have no canvas, so
  even the one-file `dist/` bundle crashed on import.

So for now this folder uses the `dist/` bundle, keeps its own copy of the
model in [schelling.js](schelling.js) (with its import changed), and loads
[nocanvas.ts](nocanvas.ts), a stand-in canvas that lets AgentScript load
and fails loudly if anything draws on it.

AgentScript's commit 656471f2 fixes all three: relative imports, the canvas
made on first use, and `vendor/` published. Once that's on npm as 0.10.28,
both workaround files go, and [worker.ts](worker.ts) imports the model
straight from the package:

```ts
import Model from 'agentscript/models/SchellingModel.js'
import * as util from 'agentscript/src/utils.js'
```

## CPU time is the limit

Workers are billed by CPU time, and the free plan allows 10 ms a request.
Schelling on its 51×51 board is far heavier than that. From `wrangler
tail`:

| Run | CPU |
| --- | --- |
| setup only | 33–92 ms |
| 1 tick | 250–310 ms |
| 10 ticks | ~1.1 s (allowed, this time) |
| 100 ticks | stopped: error 1102, exceeded CPU |

Cloudflare lets a few requests run over, but not a whole run. Workers Paid
($5 a month) allows 30 s a request by default, up to 5 minutes.

`ms` in the JSON is always 0 on Cloudflare: a Worker's clock only moves
between I/O, a guard against timing attacks. `wrangler tail` shows the real
CPU time.

## Running it

From this folder:

    deno install                                   # once: agentscript into node_modules/
    deno run -A npm:wrangler@4.151.3 dev           # local, http://localhost:8787/run
    deno run -A npm:wrangler@4.151.3 deploy        # to model.backspaces.workers.dev
    deno run -A npm:wrangler@4.151.3 tail          # watch requests, with CPU times

## Next

A plain Worker forgets everything when the request ends, so it can't keep
one model running. A **Durable Object** can: one long-lived instance that
steps the model on a timer and that every viewer connects to, like
SchellingLive on Deno.

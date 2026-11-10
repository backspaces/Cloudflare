# hello-model

The simplest way to run an AgentScript model on Cloudflare: import the
model, and wrap it in a `fetch()` function. Each request runs the model and
answers with its data, as JSON. No page, no drawing: just the model.

Read [hello/](../hello/) first if Workers are new to you.

## Try it

    ./run dev

then open these in your browser:

| Address | Answer |
| --- | --- |
| http://localhost:8787/ | 100 steps, then the turtles |
| http://localhost:8787/?steps=5&return=turtles,links | 5 steps, then the turtles and links |
| http://localhost:8787/?population=30&return=links | 30 turtles, and their links |
| http://localhost:8787/?steps=99999 | stops at 1000 steps, the most allowed |
| http://localhost:8787/?nope=1 | an error: the model has no "nope" |

Each request makes a new model, runs it, and answers. Nothing is kept
between requests.

## A Worker's ins and outs

Every Worker has the same three:

| | What | Where it comes from |
| --- | --- | --- |
| in | `request` | the caller: the address, like `/?steps=5` |
| in | `env` | the settings in `wrangler.jsonc` |
| out | `Response` | what the Worker sends back |

Cloudflare calls the Worker's `fetch(request, env)` for each request, and
sends back the `Response` it returns.

### env: the defaults, in wrangler.jsonc

[wrangler.jsonc](wrangler.jsonc) holds the Worker's settings. Three are
Cloudflare's own: `name` (its address), `main` (the code file) and
`compatibility_date`. Ours go in `vars`:

```jsonc
"vars": {
  "STEPS": 100,        // how many steps to run
  "MAX_STEPS": 1000,   // the most a request may ask for
  "RETURN": "turtles"  // what to send back: turtles, links, or both
}
```

The Worker gets them as `env.STEPS`, `env.MAX_STEPS` and `env.RETURN`.
`./run dev` lists them as it starts, so you can see they arrived. They're
the same for every request; changing them means deploying again.

### request: choices, in the address

Everything after `?` in the address:

- `steps` and `return` replace `env.STEPS` and `env.RETURN`, for this
  request only. `steps` can't go past `env.MAX_STEPS`.

  Each address setting has a default in `wrangler.jsonc` with the same
  name in capitals: `steps` → `STEPS`, `return` → `RETURN`. That's the
  usual style: capitals for settings (as in Cloudflare's examples),
  lowercase in addresses. Names are case-sensitive, so `?STEPS=5` doesn't
  work. The line in worker.js that joins each pair is written out by
  hand, so a caller can't replace anything else in `env`.
- Any other name is one of the model's own variables, like `population`
  or `speed`, and is set before the model's `setup()`. A name the model
  doesn't have is an error.

### Response: the model's data

```json
{ "ticks": 5,
  "turtles": [{ "id": 0, "x": 0.18, "y": -0.24, "heading": -215.6 }, …],
  "links": [{ "id": 0, "from": 0, "to": 7 }, …] }
```

## The code

[worker.js](worker.js) is the whole Worker, about 35 lines. The comments
mark each in and out. Its middle is how any AgentScript model runs:

```js
const model = new Model()
await model.startup() // loads any data the model needs; Hello has none
model.setup()
for (let i = 0; i < n; i++) model.step()
```

## Where AgentScript comes from

worker.js imports the model from the AgentScript website, the same way an
AgentScript web page does:

```js
import Model from 'https://agentscript.org/models/HelloModel.js'
```

The model is imported as plain `Model`, the way AgentScript's own pages
do. The name after `import` is whatever the importing file chooses, so
any model can be `Model`, and the rest of worker.js never names it.

But a Worker can't download code while it runs: Cloudflare only runs code
that was sent to it. And wrangler, which sends it, only follows imports of
files on your Mac. So something has to download AgentScript first. That's
the `build` entry in [wrangler.jsonc](wrangler.jsonc):

```jsonc
"main": "build/worker.js",
"build": {
  "command": "deno bundle -r --allow-import -o build/worker.js worker.js",
  "watch_dir": ["worker.js"]
}
```

Wrangler runs the command before `dev`, `bundle` and `deploy`. It's an
ordinary command; here, Deno does the work:

| Part | What it means |
| --- | --- |
| `deno bundle` | join worker.js and everything it imports into one file |
| `-r` | download fresh each time, so a build gets agentscript.org as it is now |
| `--allow-import` | Deno's permission to download imports from the web |
| `-o build/worker.js` | where to write the one file |
| `worker.js` | where to start |

`"main"` then names `build/worker.js`, the joined file, not `worker.js`.
And `watch_dir` makes `./run dev` build again when you edit worker.js.
`build/` is made each time, and git ignores it.

```
worker.js ──imports──▶ agentscript.org/models/HelloModel.js ──▶ src/Model.js ──▶ …
     └──────── deno bundle, on your Mac ────────▶ build/worker.js ──deploy──▶ Cloudflare
```

Any Worker that imports from the web needs a `build` entry like this.
One that only imports its own files doesn't: wrangler joins those itself,
as in [hello/](../hello/).

### Your own copy of AgentScript instead

worker.js has another import, commented out, that takes HelloModel from
the AgentScript repo beside this one:

```js
// import Model from '../../Agentscript/models/HelloModel.js'
```

Use it in place of the first one: then nothing is downloaded, and the Worker
gets your copy, changes you haven't pushed included.

Leave wrangler.jsonc alone: the same `build` entry works for both. Deno
follows a path to a file on your Mac just as it follows an address on the
web; it simply has nothing to download, so `-r` and `--allow-import` do
nothing. Switching is one line in worker.js.

(With only the local import, the build isn't strictly needed: wrangler
follows paths to files itself. You could delete `"build"` and set
`"main"` back to `"worker.js"`. But then switching would mean changing
both files, so it's simpler to keep the build.)

## See what Cloudflare gets

    ./run bundle

This builds the Worker without sending it. Its printout lists each file
Deno downloads: 19 from agentscript.org, the model and AgentScript's
`Model`, `World`, `Turtles`, `Patches`, `Links` and their helpers. No
views, no drawing, no `dist/`.

It writes the result to `out/`:

- `out/worker.js`: the one file, 97 KB (25 KB compressed). Search it for
  `HelloModel` to find the model, and for `fetch(` to find the wrapper.

The bundler leaves out functions nothing uses: of `utils.js`'s 167, only
42 are in. It can't leave out parts of a class, though, so every class it
needs comes whole, with all its methods. That's most of the 97 KB.

`out/` is made by wrangler, and git ignores it.

## Commands

    ./run dev       # on this Mac, at http://localhost:8787
    ./run bundle    # write what Cloudflare would get into out/, send nothing
    ./run deploy    # to Cloudflare, at https://hello-model.<subdomain>.workers.dev
    ./run tail      # watch the deployed Worker's requests, with their CPU times

## Try another model

Change the address in the import to another model. worker.js has one
ready, commented out:

```js
import Model from 'https://agentscript.org/models/SchellingModel.js'
```

Nothing else changes, because the rest of worker.js only says `Model`.
The model's own variables change, though: Schelling has `density` and
`tolerance` where Hello has `population` and `speed`. Bigger models take more computer time
per request; see [stepper/](../stepper/) for measurements.

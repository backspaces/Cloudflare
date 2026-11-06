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
| http://localhost:8787/?nope=1 | an error: HelloModel has no "nope" |

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
const model = new HelloModel()
await model.startup() // loads any data the model needs; Hello has none
model.setup()
for (let i = 0; i < n; i++) model.step()
```

## Where AgentScript comes from

The import is a plain path to the AgentScript repo, which sits next to
this one in `Repos/`:

```js
import HelloModel from '../../Agentscript/models/HelloModel.js'
```

There's no download and no npm: wrangler reads the files from your Mac.
So this only works with AgentScript checked out beside this repo.

A Worker on Cloudflare can't load code while it runs, so wrangler does it
first. It starts at worker.js, follows every import, and joins all the
files into one. That one file is what Cloudflare gets.

## See what Cloudflare gets

    ./run bundle

This builds the Worker without sending it, and writes the result to
`out/`:

- `out/worker.js`: the one file, 98 KB (25 KB compressed). Search it for
  `HelloModel` to find the model, and for `fetch(` to find the wrapper.
- `out/worker.js.map`: lists the files it was made from. There are 18:
  worker.js, HelloModel.js, and 16 AgentScript files from `src/` and
  `vendor/`. No views, no drawing, no `dist/`.

The bundler leaves out functions nothing uses: of `utils.js`'s 167, only
42 are in. It can't leave out parts of a class, though, so every class it
needs comes whole, with all its methods. That's most of the 98 KB.

`out/` is made by wrangler, and git ignores it.

## Commands

    ./run dev       # on this Mac, at http://localhost:8787
    ./run bundle    # write what Cloudflare would get into out/, send nothing
    ./run deploy    # to Cloudflare, at https://hello-model.<subdomain>.workers.dev
    ./run tail      # watch the deployed Worker's requests, with their CPU times

## Try another model

Change the import to another model in `../../Agentscript/models/`, and
change `HelloModel` where it's used. Bigger models take more computer time
per request; see [stepper/](../stepper/) for measurements.

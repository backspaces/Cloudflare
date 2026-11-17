# stepper-view

The Schelling model of [stepper-save/](../stepper-save/), drawn. The model
runs on Cloudflare, and is saved and restored there exactly as in
stepper-save; this page shows it as an AgentScript view, like
[views2/schelling.html](https://agentscript.org/views2/schelling.html),
instead of as text.

Read [stepper/](../stepper/) and [stepper-save/](../stepper-save/) first.
The Worker here is stepper-save's, unchanged; only the page is new.

## Try it

    ./run dev

Open http://localhost:8787. The page has three buttons:

- **Setup** makes a new model, and draws it.
- **Step** runs one step, and draws it.
- **Run** steps again and again, drawing each, until the model is done
  or you press Stop.

When the page opens, it draws the model the Worker already has, at
whatever tick it was left; Setup starts again at tick 0.

The line beside the buttons says the tick, how many turtles are happy,
and where the Worker's model came from:

- **a new model**: just made by Setup.
- **restored from storage**: the Durable Object had gone to sleep, and
  forgotten the model, so it read it back from storage. Leave the page
  alone for a minute, then press Step, to see this.
- **still in memory**: the object was awake, and still had it.

The Worker's whole answer for each button is in the browser's console
(in Chrome: View, Developer, JavaScript Console).

In the Terminal, `./run dev` shows a line like `Xs: 1154, Os: 1173, …`
whenever the model is restored: that's Schelling's `setup()`, run by
`fromData()` before it puts the saved turtles back.

There's one model, shared, as in stepper: open the page in two windows,
press Step in one, then Step in the other, and the second carries on from
the first.

## How a model on Cloudflare gets drawn

In views2, the model runs in the page, and the view draws it. Here the
model runs on Cloudflare, and the page has no model of its own. So for
each button:

1. The page asks the Worker, say `/step?agents`. The Worker steps the
   model, and answers with all of it as data: `toData(model)`.
2. The page turns that data back into a model with `fromData()`, the same
   function the Worker uses to restore a model after it sleeps.
3. TwoDraw draws that model, just as in views2.

```js
const answer = await (await fetch('/step?agents')).json()
view.model = await fromData(Model, answer)
view.draw()
```

The model in the page is only for drawing: it's never stepped here. A new
one comes with every answer.

One catch: TwoDraw's options hold the turtles and links to draw, taken
from the first model it's given. So the page replaces those along with
the model (`view.drawOptions.turtles = model.turtles`, and the same for
links), or every step would draw the first model again.

The page and the Worker both import `fromData()` from AgentScript's
[ModelData.js](https://agentscript.org/src/ModelData.js): the page while
it runs, in the browser, and the Worker when it's built, like the rest of
AgentScript.

## What it costs

Each step sends the whole model, about 230 KB for Schelling, so this
isn't smooth animation: Run waits for each step to arrive and be drawn
before asking for the next. That's fine for watching a model that runs on
Cloudflare; a model that only needs to be watched in one browser is
better run in that browser, as in views2.

`fromData()` also runs the model's `setup()` in the page each time,
before putting the saved agents in. Schelling's setup prints a line, so
the console shows an extra "Xs: … Os: …" line for each step.

## The files

| File | What it is |
| --- | --- |
| [public/index.html](public/index.html) | the page: three buttons and the drawing |
| [worker.js](worker.js) | stepper-save's Worker: the front door, and the Durable Object that holds the model |
| [wrangler.jsonc](wrangler.jsonc) | the settings |
| [run](run) | runs wrangler here, through Deno |

## Running it yourself

From this folder:

    ./run dev          # on this Mac, at http://localhost:8787
    ./run bundle       # write what Cloudflare would get into out/, send nothing
    ./run deploy       # to Cloudflare, at https://stepper-view.<subdomain>.workers.dev
    ./run tail         # watch requests, with their CPU times

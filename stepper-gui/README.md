# stepper-gui

AgentScript's [views2gui](https://agentscript.org/views2gui/) pages,
with sliders, buttons, monitors and plots, but with the model running on
Cloudflare instead of in the page. A menu chooses the model: Hello,
Schelling or Virus.

Read [stepper-view/](../stepper-view/) first: it draws one model that
runs on Cloudflare, with its own three buttons. This does the same for
any model, with the page's own controls.

## Try it

    ./run dev

Open http://localhost:8787, choose a model, and use its controls as on
agentscript.org: start/stop, step, restart, the sliders.

Each model is shared, as in stepper, and every page follows it: open the
same model in two windows, step in one, and the other shows the change
within a second or so. It's like someone joining: they see the model
others are running.

A line at the top of each page, added by remote.js, says the model's tick
and where Cloudflare's model came from:

- **a new model**: just made, by opening the page or by restart.
- **restored from storage**, in yellow: the Durable Object had gone to
  sleep and forgotten the model, so it read it back from storage, as in
  [stepper-save/](../stepper-save/). To see this, stop the model and
  leave the page alone for about half a minute: its checks on the model
  spread out (below), the object goes to sleep, and the next check
  restores it.
- **still in memory**: the object was awake, and still had it.

Opening a page makes a new model, with the page's starting settings,
for everyone using that model. That's GUIDiv: as it builds each slider, it
runs the slider's command once with its starting value, and in views2gui
pages that command restarts the model. Restart, or moving a slider, does
the same.

### How pages follow the model

A page that has been quiet for a while asks to see the model (`show`),
so it learns about steps and restarts made from other pages. "A while"
starts at a second. Each time the model turns out unchanged, the page
waits twice as long before asking again, 1, 2, 4, 8, 16 seconds, up to
30; any change starts it at a second again. So a page following a model
someone is running catches up within a second or two, and a page
watching an idle model asks rarely, which also lets Cloudflare put the
model's Durable Object to sleep.
Each change to the model gives it a new version number, and the page
says which version it has; if that's still the latest, the answer is
just "same", about 40 bytes, not the whole model. So a page watching a
model that isn't changing costs one small request every 30 seconds,
about 3,000 a day, and none while it's hidden, in another tab or a
minimized window. (Cloudflare's free plan allows 100,000 requests a day
for the whole account.) Its sliders
stay as they are: following the model changes what's drawn, not the
page's settings.

## How a page's model runs on Cloudflare

Each page here is a copy of the views2gui page, with one change that
matters. Where the original imports the model:

```js
import Model from 'https://agentscript.org/models/SchellingModel.js'
```

this one makes a **remote** version of it:

```js
import SchellingModel from 'https://agentscript.org/models/SchellingModel.js'
import remote from './remote.js'
const Model = remote(SchellingModel, 'schelling')
```

The rest of the page is the original, and uses `Model` as usual. The
remote version is a subclass of the model. It looks the same to the
page, with the same variables, but:

- `setup()` and `step()` don't run the model. They send a request to the
  Worker, with the model's settings (`density`, `tolerance`, …).
- The Worker runs the model, in a Durable Object, and answers with all of
  it, as data.
- AgentScript's `restore()` puts that data into the page's model. It's the
  same model object, with the same `turtles`, `patches` and `links`, so the
  view, the monitors and the plots just see the new values.

The model's settings go with every request, not just with Setup, so a
slider that changes `speed` while Hello runs works too.

The other change: the answer comes a moment after `step()`, so the page
gets one more line, to draw again when it arrives:

```js
model.onData = () => view.draw()
```

### What's different from running in the page

- **Speed.** The Animator still asks for a step 30 times a second, but
  while one step is on its way, more are skipped. So a model goes as fast
  as Cloudflare answers: a few steps a second for Schelling, which sends
  about 230 KB each time, and faster for small models.
- **The ticks monitor.** Pages that show the Animator's `ticks` count every
  step the Animator asked for, skipped ones too. The model's own `ticks`,
  counted on Cloudflare, is the right one.
- **Restarts.** A page that's starting up asks for a restart once for
  each slider, as GUIDiv runs their commands. Restarts waiting their turn
  are joined into one: it's sent with the latest settings.

## The files

| File | What it is |
| --- | --- |
| [public/index.html](public/index.html) | the menu: choose a model, and its page shows below |
| [public/remote.js](public/remote.js) | `remote()`: makes a model class run on Cloudflare |
| public/hello.html, schelling.html, virus.html | views2gui's pages, made remote by makePages.js |
| [makePages.js](makePages.js) | copies a views2gui page from agentscript.org and makes it remote |
| [worker.js](worker.js) | the front door, and the Durable Object that holds each model |
| [wrangler.jsonc](wrangler.jsonc) | the settings |
| [run](run) | runs wrangler here, through Deno |

## Adding a model

1. Add it to `models` in [worker.js](worker.js), with its import.
2. Make its page: `deno run -A makePages.js tsp`
3. Add it to the menu in [public/index.html](public/index.html).

Not every views2gui model fits yet. Diffuse and Fire save about 3 MB,
over the 2 MB a Durable Object can store in one value, so they'd need
saving in parts. Models whose steps are heavy, like Ants, would need
Cloudflare's paid plan.

## The Worker's addresses

The pages use these; you can too, with `curl -X POST -d '{}'`:

    /api/schelling/start   the model there is now, or a new one if none
    /api/schelling/setup   a new model, with the settings sent
    /api/schelling/step    one step, with the settings sent
    /api/schelling/show    the model as it is (add ?version=N for "same" if unchanged)

Each is a POST, with the settings as JSON, like `{"density": 70}`, and
answers with the whole model as data, plus `version`, `made` and
`restored`. The last two are what the line at the top of the page shows. Only the model's own variables are
used as settings, and only with the right kind of value.

## Running it yourself

From this folder:

    ./run dev          # on this Mac, at http://localhost:8787
    ./run bundle       # write what Cloudflare would get into out/, send nothing
    ./run deploy       # to Cloudflare, at https://stepper-gui.<subdomain>.workers.dev
    ./run tail         # watch requests, with their CPU times

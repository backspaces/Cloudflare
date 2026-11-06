# hello

A small, complete example of a Cloudflare **Worker**. It doesn't do anything
useful on purpose: each button on its page shows one thing a Worker can do,
so you can see how the pieces fit together.

This README assumes you know what a web page is and some JavaScript, and
nothing about Cloudflare or servers. New words are in **bold** the first
time, and listed at the end.

Live: https://hello.backspaces.workers.dev

## A playground and a Worker

When you type an address into a browser, the browser sends a **request**
to some computer on the internet, a **server**, and the server sends back a
**response**: usually a page.

There are two ways a server can come up with that response.

1. **Send a file that already exists.** The page was written ahead of time,
   and every visitor gets the same copy. That's all a
   [playground](../playground/) does: you give it an HTML file, Cloudflare
   keeps a copy, and hands that copy to anyone who asks. Cloudflare doesn't
   run anything of ours. If the page has JavaScript, like an AgentScript
   model, it runs later, in the visitor's browser.

2. **Run a program that works out the response.** Here we write code that
   runs on Cloudflare's computers each time a request comes in. The code
   looks at what was asked for, and builds the answer then and there: it
   might count something, save something, or look something up. That's a
   **Worker**.

Think of a playground as a bulletin board: you pin a page up and people
read it. A Worker is a clerk at a desk: each visitor asks something, and the
clerk works out the answer.

This hello Worker does both. Its page, `public/index.html`, is a plain file,
like a playground. The buttons on the page send requests that are answered
by code, in `worker.ts`.

## What's unique about Workers

Most servers are a computer, rented or your own, running your program all
day, waiting for requests. SchellingLive on Deno Deploy works that way.
Workers are different:

- **No computer of ours is running.** You give Cloudflare your code and it
  keeps it. When a request arrives, Cloudflare starts the code, lets it
  answer, and may then put it away. Starting takes a few thousandths of a
  second, so visitors don't notice.
- **It runs near the visitor.** Cloudflare has computers in over 300 cities,
  called **data centers**. Your code is copied to all of them, and a request
  is answered by the one nearest the visitor. Click the `/hello` button: it
  shows which one answered you (`MCI` is Kansas City).
- **It forgets.** Because the code can be put away after any request, and
  the next request may be answered in another city, a JavaScript variable
  can't be trusted to remember anything. What needs to last goes in
  **storage**: places Cloudflare keeps data for you. This example shows two
  kinds, KV and a Durable Object, below.
- **It can wake up on a schedule.** Besides answering requests, a Worker can
  be run by a clock, every 5 minutes, say. That's a **Cron Trigger**.
- **You pay for work, not waiting.** Cloudflare counts the time your code
  spends computing, not the time it sits waiting. The free plan allows a
  little per request, which is plenty for hello, but not for a big model
  (see [model/](../model/)).

## What wrangler is

**Wrangler** is Cloudflare's tool for Workers. It isn't part of a Worker:
it's a separate program that runs on your Mac, and never on Cloudflare.

| | Wrangler | A Worker |
| --- | --- | --- |
| What it is | a tool you type commands into | your code |
| Where it runs | on your Mac, in the Terminal | on Cloudflare's computers |
| When it runs | when you type `./run dev`, `./run deploy`, … | when a request, or the clock, arrives |
| Its job | try out, send and watch the Worker | answer requests |

Your Worker never sees wrangler. Once deployed, it keeps running on
Cloudflare whether your Mac is on or not. Wrangler is to a Worker what git
is to your code: it helps you store and send the code, but it isn't part of
the program. In the clerk picture, the Worker is the clerk, wrangler is how
you hire and check on the clerk from home, and wrangler.jsonc is the
clerk's job description.

You don't strictly need wrangler: Cloudflare's website (the dashboard) can
create and edit Workers too. Wrangler is just the handiest way, from the
Terminal. You type its commands there; the three you'll use most:

- `wrangler dev` runs your Worker **on your own Mac**, pretending to be
  Cloudflare, so you can try it at `http://localhost:8787` without
  publishing anything. It can, because wrangler brings along a copy of
  **workerd**, the program Cloudflare itself uses to run Workers. Only the
  storage is pretend: it's kept in a hidden `.wrangler/` folder here.
- `wrangler deploy` sends your Worker **to Cloudflare**, where it gets its
  real address and the whole world can use it.
- `wrangler tail` shows, live, what your deployed Worker is doing: each
  request, and anything it prints with `console.log`.

Wrangler gets its instructions from the settings file
[wrangler.jsonc](wrangler.jsonc): the Worker's name, which file holds the
code, which folder holds the plain files, and which storage it uses.
`wrangler.jsonc` isn't a magic name, just the one wrangler looks for on its
own (it looks in the current folder, then the folders above it). A file
with any other name works if you point wrangler at it:
`wrangler deploy -c my-settings.jsonc`. We always use the default.

Wrangler is a Node program, but we run it through Deno, so there's nothing
to install. The [run](run) script here does that for you, so
`./run deploy` means `wrangler deploy`.

## Try it on your Mac

1. Open the Terminal and go to this folder:

       cd ~/Dropbox/Repos/Cloudflare/hello

2. Start the pretend Cloudflare:

       ./run dev

   The first time takes a minute while Deno downloads wrangler. When it
   prints `Ready on http://localhost:8787`, it's running.

3. Open http://localhost:8787 in your browser and click the buttons. Each
   one shows the Worker's answer underneath.

4. Press Ctrl-C in the Terminal to stop it.

## What each button does

**The page itself.** `/`, the page with the buttons, is the file
`public/index.html`. Cloudflare sends it as it is; none of our code runs.

**/hello: settings.** The code answers with a greeting it reads from
`wrangler.jsonc`. Keeping settings there, not in the code, means you can
change them without touching the code. It also says whether a **secret**
is set, a password or key, without ever showing it (more below).

**/count: a Durable Object.** A shared counter: 1, 2, 3, … Ask from two
browsers, or from two countries, and they share the same count, with no
number skipped or repeated. That's what a **Durable Object** is for: one
single object, living in one place, that every request reaches, and that
handles requests one at a time, so they never trip over each other. It
keeps its own storage, so the count survives. Think of one notebook that
everyone takes turns writing in. Good for counters, chat rooms, and an
AgentScript model everyone watches together.

**/note: KV.** Saves a short note, and reads it back. **KV** (for
"key-value": you store a value under a name, its key) is storage that
Cloudflare copies to every data center, so reading is fast from anywhere.
The catch: after a save, the other cities can take up to a minute to see
the new note. Think of a notebook photocopied to every city. Good for
things read often and changed rarely, like settings.

**The Cron Trigger.** Every 5 minutes, on Cloudflare, the clock runs the
Worker, and it saves the time into KV. `/note` shows that time as
`lastCron`, so you can see it has been running. On your Mac there's no
clock running it; visit http://localhost:8787/__scheduled to run it by hand.

**Anything else**, like http://localhost:8787/nope, gets "Not found".

## The files

| File | What it is | Who reads it | Sent to Cloudflare? |
| --- | --- | --- | --- |
| [public/index.html](public/index.html) | the page with the buttons | Cloudflare | yes, exactly as it is |
| [worker.ts](worker.ts) | the code: answers each request, and runs on the clock | Cloudflare | yes, after wrangler joins it with what it imports into one file |
| [wrangler.jsonc](wrangler.jsonc) | the settings: name, files, storage, schedule | wrangler | the settings in it, yes; the file itself, no |
| `.dev.vars` | the secret, for your Mac only (not in git) | wrangler, during `dev` | never; the real secret goes up separately |
| [run](run) | runs wrangler in this folder, through Deno | the Terminal | no |
| README.md | this | people | no |
| `.wrangler/` | wrangler's scratch folder (not in git) | wrangler | never |

`.wrangler/` appears the first time you run wrangler here. It holds:

- `state/`: the pretend storage for `./run dev`, your Mac's own note and
  count. It has nothing to do with the live site's storage.
- `tmp/`: worker.ts joined into one file, ready to run. Open
  `tmp/dev-…/worker.js` to see what that looks like.
- `cache/`: things wrangler remembers, like which Cloudflare account you use.

It's safe to delete. Wrangler makes a fresh one next time, but your local
note and count start over, since that's where they were kept.

The odd one is wrangler.jsonc: its settings reach Cloudflare, but the file
doesn't. It's like drafting a tax form on your own notepad: you copy the
answers onto the official form, and the tax office keeps the answers, never
your notepad. On `./run deploy`, wrangler reads the file and tells
Cloudflare each setting in turn: the name, the greeting, which storage,
the schedule. Cloudflare keeps them in its own records, which you can see on
the Worker's Settings page on Cloudflare's website. Your code gets them
through `env`.

Each deploy replaces Cloudflare's copy with what the file says. So if
someone changes a setting on the website, the next deploy puts the file's
value back (wrangler warns you first). Make changes in wrangler.jsonc, and
use the website for looking.

### Reading worker.ts

The code has two parts that Cloudflare calls, and one class.

- `fetch(request, env)` runs for every request that isn't a plain file. It
  looks at the address, `/hello`, `/note` or `/count`, and builds the
  answer. `request` is the visitor's request; `env` is how the code reaches
  everything set up in wrangler.jsonc: `env.GREETING` is the setting,
  `env.NOTES` is the KV storage, `env.COUNTER` is the Durable Object.
- `scheduled()` is what the clock runs, every 5 minutes.
- `class Counter` is the Durable Object. The line
  `env.COUNTER.getByName('global')` finds the one Counter named "global",
  and `counter.increment()` asks it to add one. It reads like an ordinary
  method call, but the Counter may be in another city: Cloudflare carries
  the call there and brings back the answer.

Wrangler's printout calls these connections, `env.NOTES` and the rest,
**bindings**.

## Publishing it

To see what would be sent first, without sending it:

    ./run bundle

This writes it to `out/` (git ignores it): `out/worker.js` is worker.ts
turned into plain JavaScript, 2 KB. That one file is all the code
Cloudflare gets. Then:

    ./run deploy

The first time, wrangler also creates the KV storage in your Cloudflare
account. It then offers to write that storage's id into wrangler.jsonc:
don't keep it. Each person deploys to their own account, and the id only
exists in one. Later deploys find the storage again without it.

The secret isn't sent with the code. Set it on Cloudflare once:

    ./run secret put SECRET_TOKEN

Until then, `/hello` on the live site says `"hasSecret": false`.

To use your own Cloudflare account, sign in once with
`./run login`. The address will be `https://hello.<you>.workers.dev`.

## Words

| Word | Meaning |
| --- | --- |
| request, response | a browser asks (request), a server answers (response) |
| server | a computer that answers requests |
| Worker | your code, kept by Cloudflare, run when a request (or the clock) arrives |
| data center | one of Cloudflare's buildings full of computers, in 300+ cities |
| storage | where data that must last is kept, since a Worker forgets |
| KV | storage copied to every data center: quick to read, slow to spread a change |
| Durable Object | one object in one place, that every request reaches, one at a time |
| Cron Trigger | runs the Worker on a schedule, like an alarm clock |
| secret | a password or key the code can use but never shows |
| wrangler | Cloudflare's command-line tool, run on your Mac: `dev`, `deploy`, `tail` |
| workerd | the program that runs Workers, on Cloudflare and inside `wrangler dev` |
| wrangler.jsonc | wrangler's settings file for this Worker |
| binding | a connection set up in wrangler.jsonc, reached in code as `env.NAME` |
| deploy | send the Worker to Cloudflare, so it's live |

# playground

[playground.ts](playground.ts) gives an html file, or a folder of them, a
permanent https address: each playground is its own Worker with only static
assets, so Cloudflare serves the files and no code of ours runs.
[run](run) runs it with the permissions it needs, from any folder:

    ./run deploy ~/Dropbox/Repos/Agentscript/views2gui/schelling.html
    ./run deploy seg ~/Dropbox/Repos/Agentscript/views2gui/schelling.html
    ./run deploy ./site              # a folder, with its own index.html
    ./run list
    ./run delete schelling

`deploy` prints the address, `https://pg-schelling.backspaces.workers.dev`
for the first one. Without a name, it comes from the path: the file's name
without `.html`, or the folder's name, and an `index.html` is named after
its folder. Deploying to the same name again replaces what's there.

`~/Daily/bin/Bashrc` has a one-line `pg` function that calls `run`, so
`pg deploy page.html` works from anywhere.

- **A file is served as `index.html`**, so the address alone opens it. Its
  own imports aren't uploaded: AgentScript pages that import from
  `https://agentscript.org/...` work as they are, but a page that imports
  `./model.js` needs to be deployed as a folder.
- **A folder is served as it is**, minus dotfiles and `node_modules`.
- **Every name gets a `pg-` prefix.** So a playground can't replace a real
  Worker like `mcp`, and `list` and `delete` only ever see playgrounds.
  Names are lowercase letters, digits and dashes.
- **It uses wrangler's login**, so sign in once with
  `deno run -A npm:wrangler@4.151.3 login`. Each person's playgrounds go to
  their own account, at their own `workers.dev` subdomain. If a login has
  several accounts, set `CLOUDFLARE_ACCOUNT_ID` to pick one.
- **`list` asks Cloudflare's API directly**, since wrangler can't list
  Workers. It borrows wrangler's token for that.
- **Wrangler runs in an empty temp folder**, so a `wrangler.jsonc` in the
  folder you start from is never picked up by accident.
- **`delete` asks first**, unless it's run without a terminal.

Compared with [tunnel/](../tunnel/): a tunnel serves the file from this Mac
only while it runs, and shows edits live; a playground is a copy on
Cloudflare that stays up, and needs a `deploy` to change.

// Make public/<name>.html from AgentScript's views2gui/<name>.html, so
// the model runs on Cloudflare. Run from this folder:
//
//   deno run -A makePages.js hello schelling virus
//
// Each page gets three changes, and nothing else:
// 1. The model's import is renamed, and Model becomes its remote version:
//      import HelloModel from 'https://agentscript.org/models/HelloModel.js'
//      import remote from './remote.js'
//      const Model = remote(HelloModel, 'hello')
// 2. Before the Animator, a line to redraw when Cloudflare answers:
//      model.onData = () => view.draw()
// 3. A note in the title, so you can tell it from the original.
//
// The models must also be in worker.js's list.

for (const name of Deno.args) {
    const url = `https://agentscript.org/views2gui/${name}.html`
    let page = await (await fetch(url)).text()

    const importLine = /import Model from '(https:\/\/agentscript\.org\/models\/(\w+)\.js)'/
    const found = page.match(importLine)
    if (!found) throw Error(`${url}: no "import Model from ..." line`)
    const [, modelUrl, className] = found
    page = page.replace(
        importLine,
        `import ${className} from '${modelUrl}'\n` +
            `            import remote from './remote.js'`
    )
    // After the last import, make the remote Model
    const lastImport = [...page.matchAll(/^ *import .*$/gm)].at(-1)
    const at = lastImport.index + lastImport[0].length
    page =
        page.slice(0, at) +
        `\n\n            // This model runs on Cloudflare: see remote.js\n` +
        `            const Model = remote(${className}, '${name}')` +
        page.slice(at)

    if (!page.includes('const anim = new Animator(')) {
        throw Error(`${url}: no "const anim = new Animator(" line`)
    }
    page = page.replace(
        'const anim = new Animator(',
        `// Redraw when Cloudflare answers\n` +
            `            model.onData = () => view.draw()\n\n` +
            `            const anim = new Animator(`
    )
    page = page.replace(/<title>(.*)<\/title>/, '<title>$1, on Cloudflare</title>')

    await Deno.writeTextFile(`public/${name}.html`, page)
    console.log(`public/${name}.html, from ${url}`)
}

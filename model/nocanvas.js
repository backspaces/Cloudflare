// Workers have no canvas, but AgentScript's one-file bundle makes one as it
// loads (Color.js's sharedCtx1x1, for parsing css colors). This stand-in
// lets it load; anything that actually draws on it fails, loudly.
// Import it before anything that imports AgentScript.

globalThis.OffscreenCanvas ??= class {
    constructor(width, height) {
        this.width = width
        this.height = height
    }
    getContext() {
        return new Proxy(
            {},
            {
                get(_, name) {
                    throw new Error(`no canvas in Workers (ctx.${String(name)})`)
                },
            }
        )
    }
}

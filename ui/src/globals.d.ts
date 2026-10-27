// Build-time constants of this bundle. Declared once, here, rather
// than with a `declare global` inside whichever module happens to touch them first —
// that is how deleting one file made two unrelated ones stop compiling.
declare global {
    /** Приписка к имени выпуска (vite.config.ts, define): «beta 1» у предвыпуска, пусто у
     *  выпуска. На стенде тестов не определена — читать через `typeof`. */
    const __RELEASE_SUFFIX__: string
}
export {}

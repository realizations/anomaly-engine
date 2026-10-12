/**
 * Vite's compile-time constants, as TypeScript sees them.
 *
 * `import.meta.env` is substituted by Vite at build time, but `tsc` runs first in
 * `npm run build` and knows nothing about it, so without this declaration the flag is
 * a type error rather than a constant.
 *
 * Only `DEV` is declared. The alternative is pulling in the whole `vite/client` type
 * surface, which would silently type-check a dozen other globals this project does not
 * use -- and a global that type-checks without existing is how a typo becomes a runtime
 * `undefined`.
 *
 * `DEV` is the flag that matters here: it is true under `vite dev` and false in a build,
 * and it is what keeps the `dev-build-message` easter egg out of the shipped bundle.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

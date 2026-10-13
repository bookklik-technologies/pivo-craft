# Installation & running

PiVo Craft is a Vite application. Everything runs locally in your browser — no account, no project upload, no runtime CDN.

## Requirements

- Node.js **20.19+** or **22.12+** (release tested with Node 24.14.1)
- npm (or pnpm, see `packageManager`)

## Run the dev server

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. All editing stays in your browser.

## Production build

```sh
npm run build        # typecheck (tsc --noEmit) + production app in dist/
```

Release packages also provide an offline-capable `dist/standalone.html`. The separate `package-release.py` release-packaging script generates it from a production build and existing verification artifacts; `npm run build` does not generate that file. File downloads work without a backend. Download or open the supplied standalone file in a desktop browser for full-size use.

::: warning Standalone & embedded contexts
Browser file origins or embedded previews may restrict IndexedDB, so automatic recovery can be unreliable there. Use normal hosted/localhost operation for dependable recovery.
:::

## Run the test suite

```sh
npm test             # headless core/codec tests
npm run test:coverage
```

Browser smoke checks run against a dev server on port 5173:

```sh
npx playwright install chromium
node scripts/browser/browser-smoke.mjs        # core editing flows
node scripts/browser/browser-m4.mjs           # advanced controls, simulated pen input, persistence
node scripts/browser/browser-refinements.mjs  # pattern phase, gradient colors, pixel-vote undo
node scripts/browser/browser-codecs.mjs       # indexed/Adam7 PNG, GIF loops, legacy tilemap imports
node scripts/browser/browser-workspace.mjs    # tabs, recovery slots, docks, shortcut remapping
```

Each script writes `*-results.json` evidence to `scripts/browser/results/` (further scripts cover density, font, icons, scrollbars, theme and typography). See [Verification](/verification) for the full picture.

## Next steps

- Build your first project with the [Beginner tutorials](/tutorials/), including screenshots and downloadable checkpoints.
- Follow the [User guide](/guide) for a walkthrough of the workspace.
- Read [File formats](/formats) to understand `.pvc`, PNG, GIF and ASE support.
- Drive the document model directly with the [Headless API](/api).

## Release validation and updates

Production browser checks use `npm run test:release` against the built app at its deployment subpath. Unit tests are manually authorized. See [production readiness](production-readiness.md) for current evidence and limitations. Updates show a prompt and require recovery to be stored before reload. Download native project backups regularly; browser site data can be cleared by the browser or user.

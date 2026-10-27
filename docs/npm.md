# PiVo craft: npm and headless SDK

## Installation and runtime

After the first manual publication:

```sh
npm install pivo-craft
```

Node.js 24 or newer. This is an ESM-only package with bundled public TypeScript declarations. CommonJS require and a CLI/--headless switch are not supported; headless means the programmatic SDK below. Use dynamic import from CommonJS if needed. Library consumers do not need Vite, TypeScript loaders, a browser or the editor source tree.

## Public entry points

| Import | API |
| --- | --- |
| `pivo-craft` | Combined portable core and IO |
| `pivo-craft/headless` | Alias of the combined API |
| `pivo-craft/core` | Data types, validation and editing |
| `pivo-craft/io` | Portable serialization/encoding/export |
| `pivo-craft/codecs` | Alias of portable IO |

Only documented entries are public. Source paths, lib chunks and editor internals are not exported. Generated declarations are included for each entry. Browser download/storage helpers are not exported by the SDK.

## Example

```js
import { createProject, renderFrame, encodePNG, saveNative } from 'pivo-craft/headless';
import { writeFile } from 'node:fs/promises';

const project = createProject(32, 32, 'Sprite');
const pixels = renderFrame(project, project.frames[0].id);
await writeFile('sprite.png', encodePNG(32, 32, pixels));
await writeFile('sprite.pvc', saveNative(project));
```

## Supported headless behavior

The root exports core and codec functions together. The overlapping imageToRGBA name selects the core implementation; the codec implementation is available as codecImageToRGBA or through the /codecs subpath. /codecs aliases /io. Import namespace objects directly from the relevant subpath. The nested @pivo-craft/core manifest is internal/private and is not a separate release dependency.

Calls do not open windows, start servers, contact remote services or access browser storage. You control filesystem access by reading/writing the returned bytes. Preserve native project files as editable backups. Codec/export validation errors reject invalid or unsupported data; do not ignore thrown errors or rejected promises.

The SDK uses the existing bounded project/PNG/codec validators. Headless calls execute in the caller's thread: Promise-returning APIs do not imply background workers. For untrusted batches, isolate work in your own Node worker/process with memory/time budgets and terminate the worker for cancellation. There is no built-in Node worker/progress adapter. Model capture, browser PWA/recovery, and UI interactions remain editor features, not implicit headless capabilities.

## Build and artifact validation

```sh
npm ci --ignore-scripts
npm run build:lib
npm run check:package
npm run check:consumer
npm run release:check
```

The browser build remains npm run build and writes dist/. The separate SDK build writes lib/; prepack rebuilds it automatically. Do not publish dist/ as the library. Runtime dependencies exclude browser-only fonts/icons/frameworks. Required dependency licenses/notices are included in the allowlisted tarball.

check:package inspects the exact npm pack inventory and public imports. check:consumer creates a real tarball, installs it outside the repo with production dependencies only, exercises basic portable operations, and strictly compiles/emits NodeNext consumer declarations with no DOM library. Its temporary directory is removed even on failure. These are package/consumer smoke checks, not the unit suite. release:check also checks dependencies and builds the browser app/docs. No listed check invokes npm test or browser suites; ask before running unit tests.

## Manual publication (one project at a time)

From this project's root:

```sh
npm run release:check
npm pack
npm publish --dry-run --access public
npm publish --access public
```

Only run the final command when you intend to publish. No workflow publishes automatically. Confirm npm login, package-name ownership and version availability first; registry E404 does not guarantee ownership. Before later releases, choose an unused semver version. prepublishOnly rejects any current npm audit vulnerability; prepack builds/checks the artifact and never runs unit tests. If publishing a previously created tarball rather than the project directory, run the release checks before packing: npm cannot rebuild a tarball for you. Configure provenance/trusted publishing according to your npm account if desired; no credentials are stored here.

The npm archive intentionally includes lib/, this document, README, LICENSE and the relevant third-party notices. Source, tests, tooling, app dist/ and standalone HTML are excluded. The root package has no dependency on another PiVo package: each can be published independently.

The gifenc implementation is bundled into the ESM output to avoid its legacy CommonJS named-export mismatch in Node. Its MIT notice is included. Other external libraries needed at runtime are declared as production dependencies.

# Headless API

For installed package imports, supported headless operations and release steps, see the [npm SDK guide](npm.md). The source paths below describe internal implementation, not public package subpaths.

API modules under `packages/core` and `packages/codecs` are usable headlessly in Node — no DOM required. The UI consumes the same compositor as atlas/GIF export.

`packages/core` is also wired as the alias `@pivo-craft/core` (see `tsconfig.json` and `vite.config.ts`); code inside this repository typically imports via relative paths.

## Document model — `packages/core/src/index.ts`

```ts
// @pivo-craft/core resolves through this repository's bundler configuration.
import {
  createProject, cloneProject, validateProject, paletteFor,
  getCel, ensureCel, addLayer, removeLayer, addFrame, removeFrame,
  linkCel, unlinkCel, moveCel, reorderLayer, convertMode, addTag,
  effectiveVisible, effectiveLocked, currentBackgroundColor,
} from '@pivo-craft/core';

import type { Project, Layer, Frame, Cel, Tag, Mode, RGBA, Rect, Point } from '@pivo-craft/core';
```

Key exported types: `Project`, `Layer`, `Frame`, `Cel`, `TileMap`, `TileSet`, `Tag`, `Slice`/`SliceKey`, `Ink`, `Tool`, `RGBA`, `Rect`, `Mode`, `ImageDataModel`.

### Commands

| Function | Purpose |
| --- | --- |
| `paint` | Raster painting with inks and paint options |
| `transformCel` | Raster cel transforms (flip/rotate/resize/translate) |
| `resizeProject` | Canvas resize with nearest-neighbor scaling |
| `adjust` | Color adjustments (brightness/contrast, HSL, gamma, curves, invert, grayscale, RGBA replacement) |
| `editTile` | Tilemap cell editing |
| `animationSequence` | Frame/animation sequencing |

### Selections

`makeSelection`, `combineSelection`, `wandSelection`, `makeEllipseSelection`, `makePolygonSelection`, `growSelection`, `shrinkSelection`, `boundsOfSelection`, `isEmptySelection`.

### Rendering

`renderFrame`, `renderOnion`, `imageRGBA`, `imagePixelsRGBA`, `cropBuffer`.

### History

```ts
import { History } from '@pivo-craft/core';
```

Snapshot-based history (not region patches); retains one undo entry even if it exceeds the configured budget.

### Advanced brushes, dynamics & blending

`captureBrush`, `validateBrush`, `brushToJSON`/`brushFromJSON`, `paintDynamic`, `strokeStamps`, `rasterOverlay`, `DEFAULT_DYNAMICS`, plus types `CustomBrush`, `StrokeSample`, `Dynamics`. Also `transformAdvanced` (numeric arbitrary rotation/scale/pivot with inverse nearest-neighbor sampling), `applyAdjustment`, and the compositing helpers `blendPixel`, `compositePixel`, `rgbaToGray`, `SUPPORTED_BLENDS`, `isSupportedBlend`.

## Codecs — `packages/codecs/src/index.ts`

The following imports assume a TypeScript file at the repository root. Node execution requires a TypeScript-capable runner.

```ts
import { saveNative, loadNative } from './packages/codecs/src/index.ts';       // .pvc ZIP
import { encodeASE, decodeASE } from './packages/codecs/src/index.ts';         // ASE subset
import { encodePNG, decodePNG, verifyPNG } from './packages/codecs/src/index.ts';
import { encodeGIF, encodeGIFDetailed, planGIFAnimation, decodeGIF, importGIF } from './packages/codecs/src/index.ts';
import { createAtlas, exportMetadata } from './packages/codecs/src/index.ts';  // atlas packing
```

Additional exports: `crc32`, `ByteReader`, `ByteWriter`, `deflateSync`, `inflateReusable`, `validateProjectShape`, `LIMITS`, `imageHash`, `makeImage`, `frameToRGBA`, `imageToRGBA`.

## Workspace — `packages/workspace/src`

- `DocumentTabs<T>` — multi-document tab management (8-tab limit, 128 MB byte budget).
- `validateLayout` / `movePanel` / `DEFAULT_LAYOUT` — dockable panel layout.
- `DEFAULT_SHORTCUTS`, `normalizeChord`, `validateShortcuts`, `shortcutJSON`, `parseShortcutJSON` — validated keyboard bindings.
- `resolveTheme`, `VIEW_COLORS` — theme resolution.

## Usage example

Save this example in a TypeScript file at the repository root. Layer and frame arguments are IDs, not array indices; `createProject` already creates an image layer and its first cel.

```ts
import {
  createProject, ensureCel, paint, renderFrame,
} from './packages/core/src/index.ts';
import { encodePNG } from './packages/codecs/src/index.ts';

const project = createProject(32, 32, 'Example');
const layerId = project.layers[0].id;
const frameId = project.frames[0].id;
ensureCel(project, layerId, frameId);

// Paint an opaque violet pixel at canvas coordinate (8, 8).
paint(project, layerId, frameId, 'pencil', [{ x: 8, y: 8 }], {
  color: [124, 58, 237, 255],
  size: 1,
  opacity: 255,
  ink: 'simple',
  brush: 'square',
});

const rgba = renderFrame(project, frameId);
const png = encodePNG(project.width, project.height, rgba);
// png is a Uint8Array containing the encoded PNG bytes.
```

The exact signatures are documented in the source (`packages/core/src/*.ts`) and exercised by the unit/integration tests under `packages/*/test`.

// PiVo Craft core — public API. Original implementation.
export type {
  AtlasOptions, AtlasRecord, AtlasResult, Blend, Cel, Diagnostic, Direction, Frame,
  ImageDataModel, Ink, Layer, Mode, PaintOptions, PaletteKey, Point, Project, RGBA,
  Rect, Slice, SliceKey, Tag, TileCell, TileMap, TileSet, Tool,
} from './types.ts';

import { createProject, cloneProject, cloneImage, cloneImageWithId, validateProject, paletteFor, getCel, ensureCel, addLayer, removeLayer, addFrame, removeFrame, linkCel, unlinkCel, moveCel, convertMode, addTag, effectiveVisible, effectiveLocked, imageToRGBA, reorderLayer, currentBackgroundColor } from './document.ts';
import { paint, transformCel, resizeProject, adjust, editTile, animationSequence } from './commands.ts';
import { makeSelection, combineSelection, wandSelection, makeEllipseSelection, makePolygonSelection, growSelection, shrinkSelection, boundsOfSelection, isEmptySelection } from './selection.ts';
import { renderFrame, renderOnion, imageRGBA, imagePixelsRGBA, cropBuffer } from './render.ts';
import { History } from './history.ts';
import { uid } from './util.ts';
import { blendPixel, compositePixel, rgbaToGray, SUPPORTED_BLENDS, isSupportedBlend } from './color.ts';

export {
  createProject, uid, cloneProject, cloneImage, cloneImageWithId, validateProject, paletteFor, getCel, ensureCel,
  addLayer, removeLayer, addFrame, removeFrame, linkCel, unlinkCel, moveCel,
  renderFrame, imageRGBA, renderOnion, paint, makeSelection, combineSelection,
  wandSelection, transformCel, resizeProject, convertMode, adjust, animationSequence,
  editTile, History,
};

export {captureBrush,validateBrush,brushToJSON,brushFromJSON,paintDynamic,strokeStamps,rasterOverlay,DEFAULT_DYNAMICS} from './advanced-brushes.ts';
export type {CustomBrush,StrokeSample,Dynamics} from './advanced-brushes.ts';
export {transformAdvanced} from './advanced-transforms.ts';
export type {AdvancedTransformOptions} from './advanced-transforms.ts';
export {applyAdjustment} from './color-adjustments.ts';
export type {AdjustmentOptions,AdjustmentKind} from './color-adjustments.ts';

// Extended surface (also public, documented in the report)
export {
  addTag, effectiveVisible, effectiveLocked, imageToRGBA, imagePixelsRGBA,
  reorderLayer, currentBackgroundColor, makeEllipseSelection, makePolygonSelection,
  growSelection, shrinkSelection, boundsOfSelection, isEmptySelection, cropBuffer,
  blendPixel, compositePixel, rgbaToGray, SUPPORTED_BLENDS, isSupportedBlend,
};

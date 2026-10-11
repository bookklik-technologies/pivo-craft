# Workspace increment — v0.5

## Documents

New and Open add a document tab; they no longer replace the current project. Each session retains its own undo/redo history, selection and bounded selection-history cache, current frame/layer, pan/zoom, grid/onion state, foreground/background colors, chosen tag, dirty status and recovery checkpoint reference. Tool/brush settings, dock layout and shortcut preferences are workspace-wide. Playback and unfinished pointer previews stop at a document switch.

Close asks before discarding a dirty document. Closing an inactive tab does not change the active document; closing the active tab selects a neighbor; closing the last creates a blank document. A page unload warning checks all tabs. Save/Export operate on the active document only. Compatible internal clipboard data can cross tabs; mismatched indexed palettes require an explicit conversion rather than silently reinterpreting indices.

Limits: 8 open tabs and a 128MiB estimate of live raster/metadata data. New sessions use a 32MiB snapshot-history budget, with the core's existing one-entry retention rule. This is not a guaranteed total JavaScript heap ceiling: history origins, previews, clipboard, selection caches and browser copies add overhead. Large documents still need worker processing and broader performance tests.

## Recovery

Latest/previous IndexedDB checkpoints are keyed by document-session ID. Writes capture the ID and bytes before switching; their completion cannot update another tab's status. Startup offers a list of recovery copies; restoration opens a new tab and does not overwrite files. Browser quota/transaction errors show a download-backup warning. Closed-session backups are retained, not silently deleted. This increment is not complete recovery-retention management or storage-failure certification; keep downloaded .pvc backups.

## Docking

Palette, layers, advanced editing, transform/selection and tilemap sections are actual DOM panels. Drag their headings to reorder/move them between left/right docks. Arrow buttons provide an equivalent keyboard-accessible route. Empty docks expose drop targets during panel drag. Width grab strips resize docks; Layout provides validated numeric widths. The timeline docks at bottom, left or right; bottom height has a grab strip and side width is numeric. Settings persist locally and reset positions are available.

Preview remains a viewport overlay. Arbitrary floating OS windows, multiple views of one document, split panes and a production history-branch UI are not implemented. Narrow panes can scroll horizontally rather than promising mobile parity.

## Shortcuts

Keys opens the command map. Type physical-key chords such as B, Mod+Shift+KeyZ, or Ctrl+Z (normalized to portable Mod). Mod means Control/Cmd. Commas separate up to three alternatives; blank unbinds. Conflicts, unsupported keys/commands and reserved focus/browser chords reject without changing the saved map. Defaults are editable/resettable; .pxkeys JSON import/export is versioned and validated. Tooltips/rail labels reflect current bindings.

Bindings do not run in text inputs, selects, textareas or dialogs, during composition/AltGraph, or mid-pointer gesture. Native button/tab Enter/Space activation is preserved. Tab is focus navigation; Escape cancels; Space-pan and mouse selection modifiers remain fixed. Desktop/window-manager/browser accelerators can intercept keys before JavaScript; this does not claim control over every OS shortcut.

Default document cycling is Mod+Alt+ArrowLeft/ArrowRight. Tab buttons also support arrow navigation. Editable command defaults cover tools, history, files, clipboard, selection, colors, playback and frame/document navigation. Mouse-wheel/stylus/modifier remapping is outside this increment.

## Verification

Workspace model tests cover isolation, limits, no-mutation rejection, conflict/reservation handling, portable maps and panel uniqueness. Chromium workflows exercise independent artwork/view/undo, cross-document copy/paste, recovery slots, dirty-close consent, actual heading drag, pointer resize, timeline relocation, typing safeguards, reset/import/export and reload persistence. Existing editing and codec workflows were rerun. See docs/verification.json for measured counts and limitations; no cross-browser/accessibility/heap certification is implied.

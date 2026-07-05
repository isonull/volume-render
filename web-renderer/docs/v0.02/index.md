# Index

This is the entry point for the Medical Rendering Framework v0.02 tool
architecture and implementation notes. The current code is the complete v0.02
update.

v0.02 builds on v0.01 by replacing ad hoc viewport event handling with a
separated tool and command framework. The current code also removes the original
all-purpose `Engine` facade and splits runtime ownership into services.

v0.02 currently includes:

```text
DOM input normalization
viewport-local pointer, wheel, hover, and keyboard routing framework
ToolRegistry, ToolGroupService, ToolMode, and input bindings
tool callbacks independent of DOM events
command dispatcher for render-state and scene edits
MPR navigation tools migrated from direct handlers
SceneService, ViewportService, and RenderService replacing Engine
SegmentationService for active segmentation, brush state, and labelmap edits
open/close volume and segmentation commands
MPR center, pan, slice-scroll, zoom, window/level, window sync, and overlay commands
MPR probe overlay for voxel, world, and intensity readout
EditLabelmapCommand with dirty-region texture invalidation path
SegmentationBrushTool with world-space sphere brush editing
viewport-local pending stroke preview
single labelmap edit command per accepted brush drag
```

Deferred beyond v0.02:

```text
command history and undo/redo
advanced brush strategies beyond sphere paint/erase
real keyboard shortcuts built on the existing key routing framework
GPU-rendered or renderer-owned brush preview
```

## Table of Contents

| File | Section | Topic |
|---|---|---|
| [01-reference-notes.md](01-reference-notes.md) | 1 | Cornerstone and OHIF reference points |
| [02-goals.md](02-goals.md) | 2 | v0.02 scope, non-goals, acceptance criteria |
| [03-architecture.md](03-architecture.md) | 3 | framework layers and data flow |
| [04-input-and-selection.md](04-input-and-selection.md) | 4 | input router, tool groups, tool modes, and bindings |
| [05-tool-response-and-commands.md](05-tool-response-and-commands.md) | 5 | command dispatcher, command ids, render scheduling |
| [06-segmentation-tools.md](06-segmentation-tools.md) | 6 | segmentation command path, brush editing, and preview |
| [07-implementation-plan.md](07-implementation-plan.md) | 7 | staged implementation checklist and status |
| [08-current-implementation.md](08-current-implementation.md) | 8 | current v0.02 code structure and status |

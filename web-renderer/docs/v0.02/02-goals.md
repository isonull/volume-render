# Section 2. Goals

v0.02 makes interaction complexity explicit and adds the first complete
segmentation editing path for the MVP.

## Section 2.1 Problem

v0.01 allowed React canvas handlers and MPR-specific logic to sit close
together. That was acceptable for navigation, but it does not scale to
segmentation because segmentation tools need:

```text
active segmentation state
active segment label
brush configuration
preview state
dirty voxel regions
render invalidation
multi-viewport consistency
```

If brush logic is added directly to React handlers, tool behavior, data edits,
and rendering updates become coupled too early.

## Section 2.2 Goals

v0.02 introduces a tool and command framework with these boundaries:

```text
React UI
  -> selects tools and invokes commands
  -> does not implement pointer gesture behavior

InputRouter
  -> normalizes DOM input
  -> does not know scene mutation rules

ToolController
  -> dispatches input to the tool chosen by ToolGroupService
  -> does not own volume or segmentation data

ToolRegistry / ToolGroupService
  -> register tool implementations
  -> attach tool groups to viewports
  -> resolve active/passive tools from bindings

Tool
  -> converts input and context into commands or temporary viewport UI state
  -> does not directly patch Scene, labelmap, or GPU resources

CommandDispatcher
  -> applies render-state and scene commands
  -> receives SceneService, ViewportService, RenderService, and
     SegmentationService directly

SceneService
  -> owns Scene lifetime and Scene transactions

ViewportService
  -> owns Viewport and MprRenderState registries

RenderService
  -> owns MprRenderer, PreparedScene, invalidation, and render scheduling

SegmentationService
  -> owns active segmentation state, brush settings, and labelmap edit helpers
```

## Section 2.3 Non-Goals

v0.02 should not implement:

```text
full OHIF mode or extension runtime
full annotation framework
complete undo/redo UI
command history storage
AI segmentation
DICOM segmentation export
multi-user collaboration
plugin runtime
```

Undo/redo and command history are deferred beyond v0.02. The v0.02 brush tool
still groups one drag gesture into one edit command, so a later history layer
has a clean operation boundary.

## Section 2.4 Current Status

Implemented:

```text
React canvas handlers call InputRouter
current MPR navigation behavior is implemented as tools
tools receive normalized ToolInputEvent objects instead of DOM events
tools execute commands instead of directly mutating render state
render-state changes are applied by commands
open/close volume and segmentation operations are applied by commands
Engine has been removed
requestRender is scheduled by RenderService
ToolRegistry and ToolGroupService route MPR tools by bindings
DragTool lifecycle includes start, drag, end, and cancel hooks
WindowLevelTool synchronizes final window to sibling MPR viewports on drag end
MPR probe overlay shows voxel, world, and intensity readout
SegmentationService and EditLabelmapCommand edit labelmaps with dirty regions
keyboard tool routing framework is connected
SegmentationBrushTool paints and erases with a world-space sphere brush
brush drag accumulates pending edits and commits once on drag end
pending brush preview is displayed inside the active viewport
```

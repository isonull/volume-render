# Section 7. Implementation Plan

This section records the completed v0.02 staged implementation.

## Section 7.1 Stage 1: Core Types

Add framework types:

```text
ToolInputEvent
Tool
Command
CommandContext
CommandDispatcher
ToolContext
```

Status: implemented for the current MVP. Core command, tool input, tool
registry, tool group, tool mode, and binding types exist.

## Section 7.2 Stage 2: InputRouter

Move React canvas input normalization into `InputRouter`.

Acceptance:

```text
canvas handlers contain no MPR math
DOM events are converted to ToolInputEvent
wheel delta is normalized to deterministic slice steps
pointer drag state is tracked centrally
```

Status: implemented for current MPR pointer, wheel, hover, and keyboard routing
events. The keyboard path exists as framework plumbing; v0.02 does not define
new keyboard shortcuts.

## Section 7.3 Stage 3: Tool Groups And Selection

Add `ToolRegistry`, `ToolGroupService`, and binding-based `ToolController`.

Acceptance:

```text
three MPR viewports are attached to an mpr tool group
active/passive/enabled/disabled modes are represented
bindings decide which active tool receives an event
toolbar selection changes active tool state without touching canvas handlers
```

Status: implemented for the current MPR viewports. The default `mpr` group
binds pan, window/level, stack scroll, zoom, probe, and segmentation brush
tools. UI mode switching changes the left-drag binding between navigate, brush,
and erase modes.

## Section 7.4 Stage 4: MPR Tools

Move existing viewport interactions into tools:

```text
StackScrollTool
PanTool
ZoomTool
WindowLevelTool
ProbeTool
```

Acceptance:

```text
all current MPR navigation behavior still works
current mouse voxel/world/intensity probe overlay works
wheel scrolling still advances one intended slice step
tools execute commands instead of mutating render state directly
window/level syncs final window on drag end
```

Status: implemented for current MPR tools.

## Section 7.5 Stage 5: Command Dispatcher

Add command application for render-state and scene changes.

Acceptance:

```text
render-state mutations are applied through commands
scene browser mutations are applied through commands
commands drive requestRender through RenderService
segmentation brush commands are grouped at drag-gesture boundaries
```

Status: implemented for current scene browser operations and MPR render-state
operations. Command history and undo/redo are deferred beyond v0.02.

## Section 7.6 Stage 6: Segmentation Tool Skeleton

Add the first segmentation-aware edit tool path.

Acceptance:

```text
active segmentation and active segment label are explicit
brush/probe tool can pick source volume voxel index and world point
EditLabelmapCommand shape exists
dirty segmentation region type exists
sphere brush can paint or erase the active segmentation
pending brush preview appears inside the active viewport
renderer invalidation can be requested from a segmentation command
```

Status: implemented. `SegmentationService`, active segmentation state, brush
state, `EditLabelmapCommand`, dirty-region renderer invalidation, sphere brush
paint/erase, and pending stroke preview exist.

## Section 7.7 Stage 7: Engine Removal

The original `Engine` facade has been removed.

Current ownership:

```text
SceneService
  -> Scene lifetime and transactions

ViewportService
  -> Viewport and MprRenderState registries

RenderService
  -> MprRenderer, PreparedScene, invalidation, requestAnimationFrame batching

SegmentationService
  -> active segmentation state and labelmap edit mutation helpers
```

The React entry creates these services directly and passes them to
`CommandDispatcher`.

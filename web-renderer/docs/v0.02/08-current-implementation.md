# Section 8. Current Implementation

This section summarizes the current v0.02 code state.

## Section 8.1 Removed Engine

`src/engine.ts` has been removed. The application entry no longer passes state
through an all-purpose engine object.

Current runtime construction in `src/mpr.tsx`:

```text
MprRenderer.create()
  -> SceneService
  -> ViewportService
  -> RenderService
  -> SegmentationService
  -> CommandDispatcher
  -> ToolRegistry
  -> ToolGroupService
  -> ToolController
  -> InputRouter
```

`CommandDispatcher` receives services directly:

```text
SceneService
ViewportService
RenderService
SegmentationService
```

## Section 8.2 Services

Implemented services:

```text
src/services/sceneService.ts
src/services/viewportService.ts
src/services/renderService.ts
src/services/segmentationService.ts
```

Responsibilities:

```text
SceneService
  Owns Scene | null.
  Creates scenes on first volume load.
  Applies Scene transactions.

ViewportService
  Owns Viewport objects.
  Owns MprRenderState objects.
  Creates and clears canvas-backed viewports.

RenderService
  Owns MprRenderer and PreparedScene.
  Converts SceneChangeSet into renderer invalidation.
  Batches requestRender calls with requestAnimationFrame.

SegmentationService
  Owns active segmentation id, active segment label, brush radius, and brush mode.
  Mutates labelmap voxel data for edit commands.
  Returns dirty Box3i regions for partial texture uploads.
```

## Section 8.3 Commands

Implemented command files:

```text
src/commands/commandDispatcher.ts
src/commands/sceneCommands.ts
src/commands/mprCommands.ts
src/commands/segmentationCommands.ts
```

Implemented command ids:

```text
scene.openVolume
scene.openSegmentation
scene.closeVolume
scene.closeSegmentation
mpr.setRenderState
mpr.centerVolume
mpr.panPlane
mpr.moveSlice
mpr.zoomPlane
mpr.windowLevel
mpr.syncWindowLevel
mpr.setOverlaySegmentation
segmentation.editLabelmap
```

## Section 8.4 Tools And Input

Implemented tool files:

```text
src/tools/toolInput.ts
src/tools/tool.ts
src/tools/toolRegistry.ts
src/tools/toolGroupService.ts
src/tools/inputRouter.ts
src/tools/toolController.ts
src/tools/mprTools.ts
```

Current MPR tool routing is binding based:

```text
left drag
  -> PanTool
  -> mpr.panPlane

shift drag or right drag
  -> WindowLevelTool
  -> mpr.windowLevel
  -> mpr.syncWindowLevel on drag end

wheel
  -> StackScrollTool
  -> mpr.moveSlice

ctrl + wheel
  -> ZoomTool
  -> mpr.zoomPlane

hover
  -> ProbeTool
  -> viewport overlay with voxel/world/intensity display

Brush or Erase mode left drag
  -> SegmentationBrushTool
  -> pending stroke edits are collected in memory
  -> segmentation.editLabelmap on drag end

Brush or Erase mode hover
  -> SegmentationBrushTool
  -> viewport-local pending stroke preview

keyDown / keyUp
  -> routed through InputRouter and ToolController
  -> no user-facing keyboard shortcuts are defined in v0.02
```

## Section 8.5 MPR Math

Shared MPR math moved to:

```text
src/mpr/mprMath.ts
```

It currently provides:

```text
canvasToWorld
worldToIndex
sliceStepSize
isVoxelInBounds
```

## Section 8.6 Current UI Surface

The current `mpr.html` React UI is intentionally minimal:

```text
Open Volume button
Scene browser
right-click volume menu: Center, Open Segmentation, Close
right-click segmentation menu: Center, Close
segmentation mode control: Navigate, Brush, Erase
active label control
brush radius control in millimeters
viewport labels
viewport-local MPR probe overlay
viewport-local brush preview overlay
```

Manual window input fields, Apply Window, Reset Views, and the side-panel
affine/intensity/cursor information block have been removed. Window/level is
handled by the tool, with final window synchronization on drag end. Centering is
handled through the scene browser context menu.

## Section 8.7 Deferred Beyond v0.02

The following items are not part of the completed v0.02 scope:

```text
command history and undo/redo
advanced brush strategies beyond sphere paint/erase
real keyboard shortcuts built on the existing routing framework
renderer-owned or GPU-rendered brush preview
AI or server-backed segmentation workflows
```

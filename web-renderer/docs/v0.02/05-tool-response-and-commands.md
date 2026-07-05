# Section 5. Tools And Commands

Tools translate input into commands. Commands apply state changes through
services.

## Section 5.1 Current Command Dispatcher

```ts
interface CommandContext {
  sceneService: SceneService
  viewportService: ViewportService
  renderService: RenderService
  segmentationService: SegmentationService
}

interface Command<TOptions = unknown, TResult = unknown> {
  readonly id: string
  execute(options: TOptions, context: CommandContext): TResult
}
```

The current `CommandDispatcher` is a registry plus executor:

```text
register(command)
execute(commandId, options)
```

## Section 5.2 Implemented Commands

Scene commands:

```text
scene.openVolume
scene.openSegmentation
scene.closeVolume
scene.closeSegmentation
```

MPR commands:

```text
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

Tool mapping:

```text
PanTool
  -> mpr.panPlane

StackScrollTool
  -> mpr.moveSlice

ZoomTool
  -> mpr.zoomPlane

WindowLevelTool
  -> mpr.windowLevel
  -> mpr.syncWindowLevel on drag end

ProbeTool
  -> React MPR probe callback
  -> viewport overlay only

SegmentationBrushTool
  -> pending stroke preview callback while hovering or dragging
  -> segmentation.editLabelmap on drag end
```

Tools do not call renderer APIs and do not mutate `Scene` directly.

## Section 5.3 Command Responsibilities

Commands currently apply changes directly through services:

```text
scene.openVolume
  -> SceneService.loadVolume
  -> RenderService.applySceneChangeSet

scene.openSegmentation
  -> SceneService.applyTransaction
  -> replace segmentations belonging to the source volume
  -> add LabelmapSegmentationData
  -> RenderService.applySceneChangeSet

mpr.panPlane / mpr.moveSlice / mpr.zoomPlane / mpr.windowLevel
  -> ViewportService.setRenderState
  -> RenderService.requestRender

mpr.syncWindowLevel
  -> reads source viewport window
  -> copies image.windowMin/windowMax to sibling MPR viewports with same volumeId
  -> RenderService.requestRender for each synchronized viewport

segmentation.editLabelmap
  -> SegmentationService.editLabelmap
  -> SceneTransaction.updateSegmentation(segmentationId, dirtyRegions)
  -> RenderService.applySceneChangeSet

scene.closeVolume
  -> remove source-volume segmentations
  -> remove volume
  -> if the scene becomes empty, clear render state, prepared scene, and viewports
```

The current implementation does not use explicit `CommandEffect` objects.
Effects are performed inside command execution. Command history and undo/redo
are deferred beyond v0.02.

## Section 5.4 Brush Edit Command Boundary

Brush editing intentionally commits once per drag gesture:

```text
pointerDown
  -> start pending stroke

pointerMove
  -> add or replace pending voxel edits by voxel offset
  -> update viewport-local preview

pointerUp
  -> execute segmentation.editLabelmap once
  -> upload dirty labelmap texture boxes
  -> clear pending stroke and preview
```

This keeps labelmap writes bounded and avoids one texture update per pointer
move.

## Section 5.5 Deferred History Shape

v0.02 does not implement command history or undo/redo. If that feature is added
later, the likely record shape is:

```text
navigation commands
  -> previous and next MprRenderState

segmentation edit commands
  -> segmentation id
  -> edited voxel region
  -> before/after label values or compact diff
  -> active segment label
```

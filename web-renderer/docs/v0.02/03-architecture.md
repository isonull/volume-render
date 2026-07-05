# Section 3. Architecture

The v0.02 tool framework is a layered path from browser input to rendering.

Current implemented path:

```text
DOM pointer, wheel, or keyboard event
  -> InputRouter
  -> ToolInputEvent
  -> ToolController
  -> ToolGroupService binding selection
  -> Tool callback
  -> CommandDispatcher
  -> SceneService / ViewportService / RenderService / SegmentationService
  -> RenderService.requestRender
```

## Section 3.1 Layers

```text
UI layer
  React buttons, menus, sliders, and scene browser commands.

Input layer
  Converts PointerEvent, WheelEvent, and KeyboardEvent into typed input events.

Selection layer
  ToolRegistry owns available tool factories.
  ToolGroupService attaches tool instances and bindings to viewports.
  ToolController dispatches events to tools selected by ToolGroupService.

Tool layer
  Contains pan, zoom, scroll, window/level, probe, and segmentation brush tools.

Command layer
  Applies render-state or scene mutations in one place.

Service/runtime layer
  Splits runtime ownership across SceneService, ViewportService, and
  RenderService. SegmentationService owns active segmentation state and
  labelmap edit helpers.
```

## Section 3.2 Current Runtime Services

`Engine` has been removed from the current code.

```text
SceneService
  -> owns Scene | null
  -> loadVolume
  -> applyTransaction
  -> destroyScene

ViewportService
  -> owns Map<viewportId, Viewport>
  -> owns Map<viewportId, MprRenderState>
  -> createViewport
  -> setRenderState
  -> clearViewports

RenderService
  -> owns MprRenderer
  -> owns PreparedScene cache
  -> applySceneChangeSet
  -> requestRender
  -> render
  -> releasePreparedScene

SegmentationService
  -> owns activeSegmentationId
  -> owns activeSegmentLabel
  -> owns brushRadiusMm and brushMode
  -> edits labelmap voxel values
  -> returns dirty Box3i regions
```

The React entry creates these services directly and passes them to
`CommandDispatcher`.

## Section 3.3 Implemented ToolGroup Model

The current code implements a compact ToolGroup model:

```ts
type ToolMode = 'active' | 'passive' | 'enabled' | 'disabled'

interface ToolBinding {
  kind: 'drag' | 'wheel' | 'hover' | 'key'
  button?: number
  key?: string
  code?: string
  modifiers?: Partial<KeyModifiers>
}

interface ToolGroup {
  id: string
  viewportIds: Set<string>
  tools: Map<string, ToolGroupToolState>
}
```

`src/mpr.tsx` creates one `mpr` tool group and attaches axial, coronal, and
sagittal viewports to it. Bindings map left drag to pan or brush depending on
UI mode, shift-left/right drag to window/level, wheel to stack scroll,
ctrl-wheel to zoom, hover to probe and brush preview, and keyboard events
through the same routing framework. v0.02 does not define user-facing keyboard
shortcuts yet.

## Section 3.4 Current Tool Context

```ts
interface ToolContext {
  commands: CommandDispatcher
  getActiveVolume(): ScalarVolume | null
  getBrushState(): BrushToolState
  getWorldPoint(viewportId: string, clientPoint: Vec2n): Vec3n | null
  getBrushPreviewRadiusPx(viewportId: string): number | null
  onBrushPreviewChanged(preview: BrushPreviewInfo | null): void
  onCursorMove(viewportId: string, clientPoint: Vec2n): void
  onCursorLeave(): void
  onWindowLevelChanged(state: MprRenderState): void
}
```

Persistent facts belong to `Scene` or render state. Temporary gesture state
belongs to `ToolController`, for example drag start position and active drag
tool.

## Section 3.5 Current Tool Interface

```ts
interface Tool {
  id: string
}

interface DragTool extends Tool {
  onDragStart?(event: ToolInputEvent, context: ToolContext): void
  onDrag(delta: Vec2n, event: ToolInputEvent, context: ToolContext): void
  onDragEnd?(event: ToolInputEvent, context: ToolContext): void
  onDragCancel?(event: ToolInputEvent, context: ToolContext): void
}

interface WheelTool extends Tool {
  onWheel(event: ToolInputEvent, context: ToolContext): void
}

interface HoverTool extends Tool {
  onHover(event: ToolInputEvent, context: ToolContext): void
  onHoverLeave?(event: ToolInputEvent, context: ToolContext): void
}

interface KeyTool extends Tool {
  onKeyDown?(event: ToolInputEvent, context: ToolContext): void
  onKeyUp?(event: ToolInputEvent, context: ToolContext): void
}
```

The drag lifecycle is used by `WindowLevelTool`: dragging updates the source
viewport interactively, and drag end synchronizes the final window to sibling
MPR viewports for the same volume.

The same drag lifecycle is used by `SegmentationBrushTool`: drag start and drag
move only collect pending voxel edits, and drag end sends one
`segmentation.editLabelmap` command. Cancel clears the pending stroke.

## Section 3.6 Brush Editing And Preview

`SegmentationBrushTool` uses a world-space sphere brush. The brush radius is
stored in millimeters by `SegmentationService`, so the painted region remains
defined in patient/world space even when the MPR plane is oblique to the voxel
grid.

Pending stroke preview is viewport-local UI state:

```text
hover or drag point
  -> SegmentationBrushTool
  -> ToolContext.onBrushPreviewChanged
  -> React viewport overlay
```

The preview is not written to `LabelmapSegmentationData` and is cleared on drag
end, drag cancel, hover leave, mode switch, close, or load.

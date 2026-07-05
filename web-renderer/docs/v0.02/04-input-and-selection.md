# Section 4. Input And Selection

This section defines how raw input becomes a selected tool callback.

## Section 4.1 InputRouter

`InputRouter` is the only object called by React canvas event handlers.

```ts
interface ToolInputEvent {
  type:
    | 'pointerDown'
    | 'pointerMove'
    | 'pointerUp'
    | 'pointerCancel'
    | 'wheel'
    | 'keyDown'
    | 'keyUp'
  viewportId: string
  clientPoint: Vec2n
  pointerId?: number
  button: number
  buttons: number
  deltaY: number
  key?: string
  code?: string
  repeat?: boolean
  modifiers: KeyModifiers
}
```

The original DOM event is not part of the public tool contract. React handlers
call `InputRouter` with the native event and viewport id.

## Section 4.2 Picking Boundary

Pointer tools often need image-space facts. Current shared MPR math lives in
`src/mpr/mprMath.ts`:

```text
canvasToWorld
worldToIndex
sliceStepSize
isVoxelInBounds
```

This supports the current `ProbeTool` cursor display, `StackScrollTool` slice
step calculation, and `SegmentationBrushTool` world-space sphere brush center.

## Section 4.3 Current Tool Selection

Current behavior is binding based. `ToolController` asks `ToolGroupService`
which tool is active for the event's viewport and input binding.

```text
pointerDown
  -> ToolGroupService.findDragTool(viewportId, event)
  -> stores active drag tool
  -> calls onDragStart when provided

pointerMove with active drag
  -> sends delta to active drag tool

pointerMove without active drag
  -> ToolGroupService.findHoverTool(viewportId)
  -> ProbeTool updates viewport overlay

pointerUp
  -> calls onDragEnd when provided
  -> clears active drag

pointerCancel
  -> calls onDragCancel when provided
  -> clears active drag

wheel
  -> ToolGroupService.findWheelTool(viewportId, event)

keyDown / keyUp
  -> ToolGroupService.findKeyTool(viewportId, event)
  -> routed to the most recently interacted viewport
```

Pointer capture still happens in the React canvas handler. Tool gesture state is
kept in `ToolController`.

## Section 4.4 Implemented Tool Set

Implemented tools:

```text
StackScrollTool
  wheel along plane normal
  executes mpr.moveSlice

PanTool
  drag in the MPR plane
  executes mpr.panPlane

ZoomTool
  ctrl+wheel
  executes mpr.zoomPlane

WindowLevelTool
  shift drag or right drag
  executes mpr.windowLevel
  executes mpr.syncWindowLevel on drag end

ProbeTool
  hover
  updates viewport-local voxel/world/intensity overlay

SegmentationBrushTool
  left drag in Brush mode paints active label
  left drag in Erase mode writes label 0
  hover and drag update viewport-local pending stroke preview
  executes one segmentation.editLabelmap command on drag end
```

The current default `mpr` tool group binds all three MPR viewports to the same
tool set. Each tool still receives the source `viewportId`, so operations remain
viewport-local unless a command explicitly synchronizes state.

The UI switches the left-drag binding between navigation and segmentation edit
modes. `Navigate` binds left drag to `PanTool`; `Brush` and `Erase` bind left
drag and hover to `SegmentationBrushTool`.

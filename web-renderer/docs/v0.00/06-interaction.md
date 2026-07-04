# Section 6. User Input And Interaction

This chapter describes how external user input becomes MPR viewport state
changes.

The MVP interaction path is:

```text
DOM input
  -> InputRouter
  -> Engine
  -> set complete MprRenderState for the viewport
  -> Engine.requestRender
```

Input handling should not bypass the engine. The MVP does not need a tool
registry or command dispatcher; viewport operations can compute the next
`MprRenderState` and set it directly through the engine.

## Section 6.1 InputRouter

`InputRouter` normalizes browser events into viewport-local interaction events.

```ts
class InputRouter {
  handlePointerDown(evt: PointerEvent): void
  handlePointerMove(evt: PointerEvent): void
  handlePointerUp(evt: PointerEvent): void
  handleWheel(evt: WheelEvent): void
  handleKeyDown(evt: KeyboardEvent): void
  handleKeyUp(evt: KeyboardEvent): void
}

interface InteractionEvent {
  viewportId: string
  canvasPoint?: Vec2
  clientPoint?: Vec2
  buttons?: number
  key?: string
  modifiers: KeyModifiers
  originalEvent: Event
}
```

`InputRouter` should not know renderer internals. It may route normalized
viewport events to small MPR interaction handlers.

## Section 6.2 MPR Viewport Operations

MVP interactions operate only on `MprRenderState`. They should not mutate
`Scene`, own GPU resources, or call renderer methods directly.

```ts
interface MprInteractionContext {
  scene: Scene
  viewport: Viewport
  renderState: MprRenderState
  pick(canvasPoint: Vec2): PickResult
}
```

MVP viewport operations:

```text
pan MPR plane
zoom MPR plane by changing pixelSize
scroll or move through the MPR normal
adjust window/level
reset axial, sagittal, and coronal states from the loaded NIfTI volume
```

Each operation computes a complete next `MprRenderState` and passes it to:

```text
engine.setRenderState(viewportId, nextState)
engine.requestRender(viewportId)
```

## Section 6.3 Three-Direction MPR Setup

After loading a NIfTI volume, the MVP creates three render states:

```text
axial    plane normal follows the volume k axis
coronal  plane normal follows the volume j axis
sagittal plane normal follows the volume i axis
```

The exact world-space `origin`, `right`, `up`, and `pixelSize` values are derived
from the NIfTI affine and volume shape. Voxel index coordinates are center-based.

## Section 6.4 Future Interaction Extensions

These concepts are useful later but should not be required for the MVP:

```text
ToolController
ToolRegistry
CommandDispatcher
RenderStateLink
multi-viewport synchronization policies
undo/redo command history
labelmap brush editing
```

They can be added after the first three-direction MPR viewer is working.

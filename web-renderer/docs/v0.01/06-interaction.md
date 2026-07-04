# Section 6. User Input And Interaction

This chapter describes how external user input becomes MPR viewport state
changes.

The v0.01 viewport interaction path is:

```text
DOM input
  -> React MVP handlers or future InputRouter
  -> Engine
  -> set complete MprRenderState for the viewport
  -> Engine.requestRender
```

Input handling should not bypass the engine. v0.01 does not need a tool
registry or command dispatcher; viewport operations can compute the next
`MprRenderState` and set it directly through the engine. The current MVP may
keep DOM event normalization inside the React entry while treating
`InputRouter` as a later extraction target.

v0.01 segmentation storage does not require brush interaction yet. Once voxel
editing is introduced, input should route through tool controllers and command
objects instead of adding paint logic directly to the React canvas handlers.

## Section 6.1 Scene Browser UX

The v0.01 front-end exposes scene facts through a small Scene browser:

```text
Open Volume button
  -> choose .nii or .nii.gz
  -> add ScalarVolumeData to Scene
  -> center MPR views on that volume

Scene browser
  -> list volumes
  -> show each volume's segmentations in that volume's dropdown
```

Volume context menu:

```text
Center
  -> put MPR planes at the center of the volume
  -> align axial/coronal/sagittal normals to the volume I/J/K axes in world space

Open Segmentation
  -> choose .nii or .nii.gz
  -> validate shape and affine against this source volume
  -> create LabelmapSegmentationData from this volume
  -> write imported label data into that segmentation

Close
  -> remove dependent segmentations
  -> remove the volume
  -> if no volumes remain, destroy the scene and clear viewports
```

Segmentation context menu:

```text
Center
  -> center the source volume and enable this segmentation overlay

Close
  -> remove this segmentation from Scene
```

File inputs should not be visible, persistent UX state. They may be hidden
implementation details behind explicit commands. Scene and render state remain
the source of truth after import.

## Section 6.2 InputRouter

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

## Section 6.3 MPR Viewport Operations

MPR navigation interactions operate only on `MprRenderState`. They should not mutate
`Scene`, own GPU resources, or call renderer methods directly.

```ts
interface MprInteractionContext {
  scene: Scene
  viewport: Viewport
  renderState: MprRenderState
  pick(canvasPoint: Vec2): PickResult
}
```

MPR viewport operations:

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

Segmentation creation or voxel editing is different from viewport navigation:
it mutates `Scene` through a transaction and emits a `SceneChangeSet`. It should
not be modeled as a `MprRenderState` update.

## Section 6.4 Three-Direction MPR Setup

After loading a NIfTI volume, v0.01 creates three render states:

```text
axial    plane normal follows the volume k axis
coronal  plane normal follows the volume j axis
sagittal plane normal follows the volume i axis
```

The exact world-space `origin`, `right`, `up`, and `pixelSize` values are derived
from the NIfTI affine and volume shape. Voxel index coordinates are center-based.

## Section 6.5 Future Interaction Extensions

These concepts are useful later but should not be required for v0.01:

```text
ToolController
ToolRegistry
CommandDispatcher
RenderStateLink
multi-viewport synchronization policies
undo/redo command history
labelmap brush editing
segmentation export
```

They can be added after the first three-direction MPR viewer is working.

For segmentation tools, the recommended flow is:

```text
DOM input
  -> InputRouter or equivalent normalized event path
  -> active ToolController
  -> pick MPR point into world/index coordinates
  -> create segmentation edit command
  -> Scene.transaction updates LabelmapSegmentationData
  -> Engine.applySceneChangeSet
  -> render affected viewports
```

# Section 1. Overview

## Section 1.1 v0.01 Goal

v0.01 builds on the v0.00 medical image viewing loop:

```text
load NIfTI scalar volumes
create or reuse one Scene from NIfTI voxel data and affine metadata
create three MPR render states: axial, sagittal, coronal
render three canvas-backed MPR viewports
handle MPR viewport interaction by directly updating MprRenderState
rerender affected viewport on the next animation frame
```

The v0.01 addition is Scene-owned labelmap segmentation data:

```text
create a labelmap segmentation associated with one scalar volume
create segmentations only from their source scalar volume
load external segmentation voxels only when shape and affine exactly match the source volume
store segmentation voxels in Scene as CPU-side facts
track segment metadata separately from scalar image metadata
emit typed SceneChangeSet events for segmentation add/remove/change
prepare labelmap GPU textures from Scene facts
render labelmaps as MPR overlays
```

Brush editing, segmentation export, undo/redo, non-volume annotations,
surfaces, contours, tensors, vector fields, multiple scene graphs, and generic
layer systems remain out of scope for the first v0.01 scene-model step.

## Section 1.2 v0.01 Acceptance Criteria

v0.00 acceptance criteria still apply. v0.01 is accepted when:

```text
Scene can contain scalar volumes and labelmap segmentations
each segmentation references its source scalar volume
segmentation shape and index-to-world space match the referenced volume
segmentations are created from a source volume, not constructed as free-floating data
external segmentation import rejects mismatched shape or affine
segments have stable ids, label values, names, colors, visibility, and opacity
segmentation voxel buffers are CPU-side Scene facts
segmentation add/remove/change operations emit typed SceneChangeSet entries
dirty voxel regions can be attached to segmentation.changed events
Engine maps segmentation scene changes to prepared-scene invalidations
destroying or replacing Scene releases prepared segmentation GPU resources
MPR render state can enable a visible labelmap overlay
the Scene browser lists volumes and nests segmentations under their source volume
```

## Section 1.3 Design Goals

- Make `Scene` the long-lived source of truth for NIfTI-derived scalar volumes.
- Make `Scene` the long-lived source of truth for labelmap segmentation facts.
- Keep GPU resources outside `Scene`.
- Keep viewport canvas ownership separate from renderer-specific display state.
- Treat scene mutations as transactions that emit typed `SceneChangeSet` objects.
- Render through a small `Engine` that owns the scene, viewports, render states, prepared scene, and renderer.
- Add segmentation data without introducing a generic scene graph or layer system.
- Keep brush tooling, command history, and segmentation export out of v0.01.
- Support labelmap overlay display once the Scene segmentation contract is stable.

## Section 1.4 v0.01 Core Concepts

```text
Engine
Scene
ScalarVolumeData
LabelmapSegmentationData
Segment
SceneTransaction
SceneChangeSet
Viewport
MprRenderState
PreparedScene
PreparedScalarVolume
PreparedLabelmapSegmentation
MprRenderer
InputRouter
```

Short definitions:

```text
Engine                       top-level owner of v0.01 lifecycle and render dispatch
Scene                        CPU-side data facts: scalar volumes and segmentations
ScalarVolumeData             3D scalar array with NIfTI-derived index-to-world transform
LabelmapSegmentationData     voxel label array associated with one scalar volume
Segment                      metadata for one label value inside a segmentation
SceneTransaction             controlled scene mutation scope
SceneChangeSet               typed journal of facts changed by one transaction
Viewport                     canvas-backed render target
MprRenderState               MPR plane, window/level, interpolation, and display state
PreparedScene                GPU cache derived from Scene
PreparedScalarVolume         uploaded scalar volume texture and metadata
PreparedLabelmapSegmentation uploaded labelmap texture and metadata, introduced when rendering needs it
MprRenderer                  WebGPU renderer for scalar MPR
InputRouter                  future extraction target for normalized viewport interaction events
```

## Section 1.5 v0.01 Flow

The public update path should stay narrow:

```ts
engine.applySceneChangeSet(changeSet)
engine.setRenderState(viewportId, state)
engine.requestRender(viewportId)
```

Internally:

```text
NIfTI volume load creates or reuses Scene and adds ScalarVolumeData
Engine creates axial, sagittal, and coronal MprRenderState objects
requestAnimationFrame flushes pending renders
MprRenderer prepares scalar volume GPU resources when needed
MprRenderer draws PreparedScene into Viewport using MprRenderState
MPR interaction computes and sets a complete next MprRenderState
Engine requests the affected viewport render
Segmentation import is started from a source volume in the Scene browser
Segmentation creation validates the selected source volume shape and affine
Segmentation creation mutates Scene through a transaction
Segmentation edits emit segmentation.changed with optional dirty regions
Engine invalidates prepared segmentation resources for affected regions
MprRenderer composites visible labelmap overlays during MPR rendering
```

`Scene` is the CPU-side source of truth for both scalar images and
segmentations. `PreparedScene` is a disposable GPU cache owned by `Engine`.
Resource lifetime starts when the first NIfTI-backed volume is loaded into a
`Scene`. Closing one volume removes that volume and its dependent
segmentations; destroying the `Scene` releases all prepared GPU resources.

## Section 1.6 Future Extensions

These concepts are useful later, but should not be required for v0.01:

```text
SceneManager
ViewportManager
RendererRegistry
PreparedSceneCache
SceneViewportIndex
CacheManager
Pipeline
VolumeRenderState
RenderStateLink
ToolRegistry
BrushTool
SegmentationToolController
Segmentation export
Command history for segmentation strokes
```

They should be introduced only when the implementation needs multiple scenes,
multiple renderer types, shared resource caches, segmentation editing, complex
viewport linking, or a plugin-like tool system.

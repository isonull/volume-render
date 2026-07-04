# Section 1. Overview

## Section 1.1 MVP Goal

The MVP should implement one complete medical image viewing loop:

```text
load one NIfTI scalar volume
create one Scene from the NIfTI voxel data and affine metadata
create three MPR render states: axial, sagittal, coronal
render three canvas-backed MPR viewports
handle MPR viewport interaction by directly updating MprRenderState
rerender affected viewport on the next animation frame
```

The first implementation deliberately supports only:

```text
NIfTI scalar volume input
3D scalar volumes
MPR rendering
three orthogonal MPR viewports
basic MPR viewport operations
direct MprRenderState updates
```

Labelmap segmentations, brush editing, non-volume data, annotation tools,
surfaces, contours, tensors, vector fields, multiple scene graphs, and generic
layer systems are out of scope for the MVP.

## Section 1.2 MVP Acceptance Criteria

The MVP is accepted when:

```text
one .nii or .nii.gz scalar volume can be loaded
the NIfTI voxel array, dimensions, spacing/orientation, and affine are preserved
voxel index and world coordinates follow NIfTI / medical-image conventions
voxel index coordinates refer to voxel centers
axial, sagittal, and coronal MPR viewports render simultaneously
viewport interactions can update the corresponding MprRenderState directly
render-state changes rerender only the affected viewport
unsupported WebGPU capabilities fail with an explicit error
GPU resources are created after the NIfTI-backed Scene is loaded
GPU resources are released when the Scene is destroyed
```

## Section 1.3 Design Goals

- Make `Scene` the long-lived source of truth for NIfTI-derived scalar volumes.
- Keep GPU resources outside `Scene`.
- Keep viewport canvas ownership separate from renderer-specific display state.
- Treat scene mutations as transactions that emit typed `SceneChangeSet` objects.
- Render through a small `Engine` that owns the scene, viewports, render states, prepared scene, and renderer.
- Avoid framework abstractions until the MVP has a working three-direction MPR viewing loop.

## Section 1.4 MVP Core Concepts

```text
Engine
Scene
ScalarVolumeData
SceneTransaction
SceneChangeSet
Viewport
MprRenderState
PreparedScene
PreparedScalarVolume
MprRenderer
InputRouter
```

Short definitions:

```text
Engine                       top-level owner of MVP lifecycle and render dispatch
Scene                        CPU-side data facts: NIfTI-derived scalar volumes
ScalarVolumeData             3D scalar array with NIfTI-derived index-to-world transform
SceneTransaction             controlled scene mutation scope
SceneChangeSet               typed journal of facts changed by one transaction
Viewport                     canvas-backed render target
MprRenderState               MPR plane, window/level, interpolation, and display state
PreparedScene                GPU cache derived from Scene
PreparedScalarVolume         uploaded scalar volume texture and metadata
MprRenderer                  WebGPU renderer for scalar MPR
InputRouter                  normalizes DOM input into viewport interaction events
```

## Section 1.5 MVP Flow

The public update path should stay narrow:

```ts
engine.applySceneChangeSet(changeSet)
engine.setRenderState(viewportId, state)
engine.requestRender(viewportId)
```

Internally:

```text
NIfTI load creates Scene and ScalarVolumeData
Engine creates axial, sagittal, and coronal MprRenderState objects
requestAnimationFrame flushes pending renders
MprRenderer prepares scalar volume GPU resources when needed
MprRenderer draws PreparedScene into Viewport using MprRenderState
MPR interaction computes and sets a complete next MprRenderState
Engine requests the affected viewport render
```

`Scene` is the CPU-side source of truth. `PreparedScene` is a disposable GPU
cache owned by `Engine`. The MVP resource lifetime starts when a NIfTI-backed
`Scene` is loaded and ends when that `Scene` is destroyed.

## Section 1.6 Future Extensions

These concepts are useful later, but should not be required for the MVP:

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
LabelmapSegmentationData
PreparedLabelmap
BrushTool
```

They should be introduced only when the implementation needs multiple scenes,
multiple renderer types, shared resource caches, segmentation editing, complex
viewport linking, or a plugin-like tool system.

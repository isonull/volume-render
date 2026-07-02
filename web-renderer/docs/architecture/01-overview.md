# Section 1. Overview

## Section 1.1 Design Goals

- Separate scene data facts, prepared GPU resources, viewport targets, renderer state, and rendering algorithms.
- Prepare shared renderer resources once per renderer/cache scope and reuse them across viewports and pipelines.
- Make `Scene` a long-lived data-fact container for scalar volumes and labelmap segmentations.
- Keep every non-volume and non-labelmap data type out of the first implementation.
- Treat `PreparedScene` as renderer-specific cache derived from `Scene`.
- Keep `PreparedScene` outside `Scene`; it is owned by the engine/cache layer.
- Keep rendering algorithms in renderers, pipelines, and passes.
- Keep viewport targets separate from renderer-specific render state.
- Treat scene mutations as transactions that emit typed `SceneChangeSet` objects.
- Invalidate prepared renderer caches from change sets, not from ad-hoc renderer scans.
- Schedule rendering through a frame-coalescing `RenderScheduler`.
- Support pipeline-specific prepared resources without duplicating source data.
- Provide explicit lifecycle management for scenes, viewports, prepared scenes, render state, tools, synchronization, volumes, and labelmap segmentations.

## Section 1.2 High-Level Model

Recommended core concepts:

```text
MedicalRenderingEngine
DataObject
Scene
ScalarVolumeData
LabelmapSegmentationData
SceneTransaction
SceneChangeSet
PreparedScene
Viewport
RenderState
Renderer
Pipeline
PreparedResource
SceneManager
ViewportManager
PreparedSceneCache
InputRouter
ToolController
CommandDispatcher
RenderStateLink
ToolRegistry
```

Short definitions:

```text
MedicalRenderingEngine       top-level owner of lifecycle, registries, render dispatch, and explicit release
DataObject                   CPU-side medical data and metadata
Scene                        long-lived data-fact container for volumes and labelmaps
ScalarVolumeData             3D scalar array with index-to-world transform
LabelmapSegmentationData     3D integer label array referencing a scalar volume
SceneTransaction             controlled scene mutation scope
SceneChangeSet               typed journal of facts changed by one scene transaction
PreparedScene                renderer-specific cache derived from Scene
Viewport                     render target: canvas or canvas region
RenderState                  renderer-specific state: camera/slice geometry, VOI, colormap, opacity, LUT, sampling
Renderer                     frame drawing implementation for a prepared scene
Pipeline                     concrete rendering technique, such as MPR slice plus labelmap overlay
PreparedResource             pipeline-specific derived GPU resource
SceneManager                 creates, stores, mutates, and destroys scenes
ViewportManager              creates, stores, resizes, and destroys viewports
PreparedSceneCache           explicit cache of renderer-specific PreparedScene objects
RenderStateStore             per-viewport renderer state storage
RenderScheduler              coalesces render requests onto animation frames
SceneViewportIndex           reverse index from scene/volume/labelmap to affected viewports
InputRouter                  normalizes DOM input into viewport interaction events
ToolController               dispatches interaction events to active/passive tools
CommandDispatcher            commits tool commands through the engine
RenderStateLink              propagates selected render-state patches across viewports
ToolRegistry                 global tool class registry
```

The central public render call should go through the engine, but most updates
enter through scene changes or render-state changes:

```ts
engine.applySceneChangeSet(changeSet)
engine.updateRenderState(viewportId, patch)
engine.render(sceneId, viewportId, renderState)
```

Internally:

```text
Scene transaction emits SceneChangeSet
PreparedSceneCache invalidates affected prepared resources
RenderScheduler requests affected viewport renders
Renderer prepares incrementally and draws PreparedScene into Viewport using RenderState
```

Renderer-level APIs may be lower-level:

```ts
renderer.render(preparedScene, viewport, renderState)
```

`Scene` is the source of truth. `PreparedScene` is a disposable renderer cache.

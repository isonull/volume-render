# Section 4. Renderer

## Section 4.1 Renderer

`Renderer` draws an already-prepared scene into a viewport.

```ts
interface Renderer {
  readonly id: string
  canRender(scene: Scene, viewport: Viewport, renderState: RenderState): boolean
  prepareScene(scene: Scene, previous?: PreparedScene): PreparedScene
  render(preparedScene: PreparedScene, viewport: Viewport, renderState: RenderState): void
  releasePreparedScene(preparedScene: PreparedScene): void
}
```

Application code should normally render through the engine:

```ts
engine.render(sceneId, viewportId, renderState)
```

The engine resolves scene/viewport/renderer and calls the renderer with a
`PreparedScene`.

## Section 4.2 RenderState

`RenderState` describes how one renderer should draw one scene into one
viewport. It combines geometric viewing state and display mapping state, and
its concrete shape is renderer-specific.

```ts
type RenderState =
  | MprRenderState
  | VolumeRenderState
```

Example MPR state:

```ts
interface MprRenderState {
  rendererKind: 'mpr'
  plane: {
    origin: Vec3
    right: Vec3
    up: Vec3
    pixelSize: number
  }
  image: {
    volumeId: string
    windowMin: number
    windowMax: number
    colormap?: ColorMap
    interpolation: 'nearest' | 'linear'
    slab?: {
      thickness: number
      mode: 'mean' | 'max' | 'min'
    }
  }
  labelmaps: {
    [labelmapId: string]: {
      colorLut: ColorLUT
      opacity: number
      outlineOnly: boolean
      visibleSegments?: Set<number>
      activeSegmentIndex?: number
    }
  }
}
```

Example 3D volume state:

```ts
interface VolumeRenderState {
  rendererKind: 'volume'
  volumeId: string
  camera: {
    position: Vec3
    target: Vec3
    up: Vec3
    fovY: number
  }
  transferFunction: TransferFunction
  sampling: {
    stepSize: number
    interpolation: 'nearest' | 'linear'
  }
}
```

Rules:

- `Scene` owns scalar volume facts and labelmap segmentation facts.
- `Viewport` owns the canvas-backed render target.
- `RenderState` owns renderer-specific viewing and display choices.
- Segment visibility, color LUT, opacity, and active segment live in `RenderState`.
- Renderer-specific GPU uniforms are derived from `RenderState`.
- Different renderers may define incompatible `RenderState` shapes.

## Section 4.3 PreparedScene

`PreparedScene` is renderer-specific cache derived from a `Scene`. It is not
business state and must not be stored on `Scene`.

```ts
class PreparedScene {
  readonly id: string
  readonly rendererId: string
  readonly sourceSceneId: string
  sourceVersion: number

  preparedVolumes: Map<string, PreparedScalarVolume>
  preparedLabelmaps: Map<string, PreparedLabelmap>
  pendingInvalidations: PreparedInvalidation[]
}
```

Typical cached content:

```text
uploaded scalar volume textures
uploaded labelmap textures
texture views
bind groups
uniform buffers
dirty-region upload metadata
```

`PreparedScene` is updated incrementally from `SceneChangeSet` invalidations.
`Scene.version` is useful for sanity checks, but it is not enough to decide
what can be updated incrementally.

## Section 4.4 PreparedResource

`PreparedResource` is a renderer/pipeline-specific GPU resource derived from a
scene data fact.

Examples:

```text
scalar volume texture
labelmap texture
histogram buffer
downsampled scalar volume pyramid
transfer function LUT
```

```ts
interface PreparedResource {
  readonly id: string
  readonly sourceDataObjectId: string
  readonly rendererId: string
  readonly pipelineKey: string
  version: number
  release(): void
}

class PreparedScalarVolume implements PreparedResource {
  readonly texture: GPUTexture
  readonly textureView: GPUTextureView
  readonly shape: Vec3
  readonly indexToWorld: Mat4
}

class PreparedLabelmap implements PreparedResource {
  readonly texture: GPUTexture
  readonly textureView: GPUTextureView
  readonly shape: Vec3
  readonly indexToWorld: Mat4
}
```

Prepared resources are caches. They must not be treated as duplicate source
data.

Prepared resources can carry pending invalidations:

```ts
type PreparedInvalidation =
  | { type: 'volumeTextureDirty'; volumeId: string; regions?: Box3i[] }
  | { type: 'labelmapTextureDirty'; labelmapId: string; regions?: Box3i[] }
  | { type: 'labelmapMetadataDirty'; labelmapId: string; segmentIndices?: number[] }
  | { type: 'preparedSceneStructureDirty' }
```

The renderer maps these invalidations to the cheapest safe update, such as
`queue.writeTexture` for a dirty labelmap box.

## Section 4.5 Pipeline

`Pipeline` implements a rendering technique over prepared volume and labelmap
resources.

Examples:

```text
MprSlicePipeline
LabelmapOverlayPipeline
VolumeRaymarchPipeline
```

```ts
interface RenderPipeline {
  prepare(scene: Scene, previous?: PreparedScene): PreparedScene
  draw(context: DrawContext, preparedScene: PreparedScene, renderState: RenderState): void
}
```

For the first implementation, a renderer may use one pipeline that draws the
scalar volume and labelmap overlay together. Splitting the labelmap overlay into
a separate pipeline is an implementation choice, not a `Scene` concern.

## Section 4.6 Render Flow

```text
Scene transaction
  -> SceneChangeSet
MedicalRenderingEngine.applySceneChangeSet(changeSet)
  -> PreparedSceneCache invalidates affected PreparedScene objects
  -> SceneViewportIndex resolves affected viewports
  -> RenderScheduler requests next-frame renders
RenderScheduler flush
  -> SceneManager resolves Scene
  -> ViewportManager resolves Viewport
  -> RenderStateStore resolves RenderState
  -> RendererRegistry selects Renderer
  -> PreparedSceneCache incrementally prepares or updates PreparedScene
  -> Renderer draws PreparedScene
Canvas output
```

Labelmap editing flow:

```text
BrushTool modifies LabelmapSegmentationData in Scene
Scene transaction emits labelmap.voxelsChanged(regions)
PreparedSceneCache marks prepared labelmap texture dirty
RenderScheduler requests renders for viewports displaying that labelmap
Next render uploads only dirty texture regions and reuses the scalar volume texture
```

Render-state editing flow:

```text
WindowLevelTool modifies MprRenderState.image.windowMin/windowMax
RenderStateStore updates the viewport state
RenderScheduler requests that viewport only
Next render updates uniforms and reuses PreparedScene
```

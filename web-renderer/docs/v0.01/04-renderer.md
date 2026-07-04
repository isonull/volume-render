# Section 4. Renderer

## Section 4.1 MprRenderer

The v0.01 renderer is a concrete `MprRenderer`, not a generic renderer/pipeline
framework.

```ts
class MprRenderer {
  prepareScene(scene: Scene, previous?: PreparedScene): PreparedScene
  render(preparedScene: PreparedScene, viewport: Viewport, state: MprRenderState): void
  releasePreparedScene(preparedScene: PreparedScene): void
}
```

`MprRenderer` is responsible for:

```text
creating scalar volume GPU textures
creating labelmap segmentation GPU textures
updating uniforms from MprRenderState
drawing scalar MPR image
compositing visible labelmap overlays
releasing prepared GPU resources
```

It should not mutate `Scene`.

v0.01 prepares segmentation GPU resources and composites visible labelmap
overlays when `MprRenderState` references a segmentation.

## Section 4.2 MprRenderState

`MprRenderState` describes how one viewport looks at the scene.

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
  overlay?: {
    segmentationId: string
    visible: boolean
  }
}
```

Rules:

- MPR plane, window/level, interpolation, and slab settings live in
  `MprRenderState`.
- v0.01 updates render state by replacing the complete `MprRenderState` for a
  viewport. It does not require a patch or deep-merge render-state API.
- The engine may expose direct helpers for common viewport operations, but the
  resulting state remains an explicit `MprRenderState`.
- Segmentation overlay visibility belongs in render state, not in `Viewport`.
- Segment facts and labelmap voxels belong in `Scene`, not in render state.

## Section 4.3 PreparedScene

`PreparedScene` is the GPU cache derived from `Scene`.

```ts
class PreparedScene {
  readonly sourceSceneId: string
  sourceVersion: number

  preparedVolumes: Map<string, PreparedScalarVolume>
  preparedSegmentations: Map<string, PreparedLabelmapSegmentation>
  pendingInvalidations: PreparedInvalidation[]
}
```

Typical cached content:

```text
scalar volume textures
labelmap segmentation textures
texture views
samplers
bind groups
uniform buffers
```

For v0.01, `PreparedScene` may be owned directly by `Engine`. A separate
`PreparedSceneCache` is unnecessary until there are multiple scenes or renderer
types.

## Section 4.4 Prepared Resources

```ts
class PreparedScalarVolume {
  readonly texture: GPUTexture
  readonly textureView: GPUTextureView
  readonly shape: Vec3
  readonly indexToWorld: Mat4
  release(): void
}

class PreparedLabelmapSegmentation {
  readonly texture: GPUTexture
  readonly textureView: GPUTextureView
  readonly shape: Vec3
  readonly indexToWorld: Mat4
  release(): void
}
```

Prepared resources are caches. They must not be treated as duplicate source
data.

```ts
type PreparedInvalidation =
  | { type: 'volumeTextureDirty'; volumeId: string; regions?: Box3i[] }
  | { type: 'segmentationTextureDirty'; segmentationId: string; regions?: Box3i[] }
  | { type: 'preparedSceneStructureDirty' }
```

## Section 4.5 WebGPU Capability Rules

v0.01 requires WebGPU support. If the browser, adapter, device, scalar volume
format, or required texture path is unsupported, initialization should fail with
an explicit error instead of silently falling back to a different renderer.

```text
WebGPU unavailable                  -> fail
required adapter missing            -> fail
required texture format unsupported -> fail
required shader path unsupported    -> fail
```

The first implementation may reject scalar voxel formats that cannot be uploaded
or sampled through the selected v0.01 texture path. CPU-side NIfTI loading may
still preserve the original typed array; renderer preparation decides whether it
is supported.

## Section 4.6 NIfTI Volume Sampling Rules

Sampling rules:

- Convert viewport canvas coordinates through the MPR plane into world space.
- Convert world coordinates to NIfTI voxel index coordinates using the inverse
  of `indexToWorld`.
- Voxel index coordinates are center-based.
- Use `nearest` or `linear` scalar interpolation according to `MprRenderState`.
- Samples outside the volume bounds produce the configured background color.

## Section 4.7 Labelmap Overlay Sampling Rules

Labelmap overlays are rendered in the same MPR pass as the scalar image:

- Convert viewport canvas coordinates through the MPR plane into world space.
- Convert world coordinates to the scalar volume index using the scalar
  volume's inverse `indexToWorld`.
- Convert the same world coordinates to segmentation index using the
  segmentation's inverse `indexToWorld`.
- For v0.01, imported segmentations must already have the same shape and affine
  as the source volume, but the renderer still treats the volume and
  segmentation transforms as explicit prepared facts.
- Sample labelmaps with nearest-neighbor lookup only. Label values are discrete
  IDs and must not be linearly interpolated.
- Label `0` is transparent background.
- Non-zero labels look up prepared segment color and opacity.

## Section 4.8 Render Flow

```text
NIfTI load
  -> Scene and ScalarVolumeData
Engine creates three MPR viewports and render states
requestAnimationFrame flush
  -> Engine resolves Viewport and MprRenderState
  -> MprRenderer prepares or updates PreparedScene
  -> MprRenderer draws scalar MPR and optional labelmap overlay
Canvas output
```

Render-state editing flow:

```text
MPR viewport interaction computes the next MprRenderState
Engine replaces the viewport's MprRenderState
Engine requests that viewport only
Next render updates uniforms and reuses PreparedScene
```

Segmentation scene-editing flow:

```text
Segmentation transaction changes Scene
SceneChangeSet includes segmentation.added / segmentation.changed / segmentation.removed
Engine invalidates prepared segmentation resources
Next render updates or recreates prepared labelmap resources
```

Scene lifetime flow:

```text
first NIfTI load creates Scene
later NIfTI loads add volumes to that Scene
First render creates PreparedScene GPU resources
closing a volume releases its prepared volume and dependent segmentation resources
Scene destroy releases PreparedScene GPU resources
```

## Section 4.9 Future Renderer Extensions

The following concepts are intentionally not part of the v0.01 renderer API:

```text
generic Renderer interface
Pipeline registry
VolumeRenderState
Surface or contour passes
shared PreparedSceneCache across renderer types
```

They can be added after the concrete three-direction MPR path is working.

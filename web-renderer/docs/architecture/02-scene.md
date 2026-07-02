# Section 2. Scene

`Scene` is the long-lived source of truth for the first implementation. For
now it only models scalar volumes and labelmap segmentations.

Scene owns:

```text
scalar volumes
labelmap segmentations
scene version
change journal
index-to-world transforms
```

Scene does not own:

```text
GPU textures
GPU buffers
bind groups
prepared draw lists
pipeline assignments
renderer-specific caches
viewport canvas/context
non-volume and non-labelmap data
```

Those belong to `PreparedScene`, `PreparedResource`, renderer preparation code,
or future extensions.

## Section 2.1 Data Facts

The first scene data model is intentionally narrow:

```ts
type DataObject =
  | ScalarVolumeData
  | LabelmapSegmentationData
```

Every data object should carry only facts:

```text
shape / dimensions
typed data buffer or external source reference
spatial transform
component layout
semantic type
metadata needed for interpretation
```

Derived values such as inverse transforms, intensity ranges, histograms, GPU
textures, GPU buffers, and acceleration structures are prepared elsewhere.

## Section 2.2 Scalar Volume

```ts
class ScalarVolumeData {
  readonly id: string
  readonly shape: Vec3
  readonly data: ScalarVoxelArray
  readonly indexToWorld: Mat4
}
```

Meaning:

- `shape`: voxel array shape `[nx, ny, nz]`.
- `data`: scalar voxel values, indexed as `x + nx * (y + ny * z)`.
- `indexToWorld`: affine transform from voxel index coordinates to world coordinates.

## Section 2.3 Labelmap Segmentation

A labelmap segmentation is a 3D integer array whose voxel value is the segment
index. Segment index `0` means background.

```ts
class LabelmapSegmentationData {
  readonly id: string
  readonly referenceVolumeId: string
  readonly shape: Vec3
  readonly labels: Uint8Array | Uint16Array | Uint32Array
  readonly indexToWorld: Mat4
  readonly segments: Map<number, Segment>
}

interface Segment {
  readonly segmentIndex: number
  label: string
  locked: boolean
  cachedStats?: Record<string, unknown>
}
```

Rules:

- Labelmap geometry should match the referenced scalar volume unless a future
  resampling step is added explicitly.
- Segment visibility, color LUT, opacity, and active segment are renderer/tool
  state, not labelmap data facts.
- Labelmap editing should mark dirty regions, not force full texture upload.
- Other segmentation representations are out of scope for the first
  implementation.

## Section 2.4 Scene Object

```ts
class Scene {
  readonly id: string
  readonly frameOfReferenceUID?: string

  version: number

  readonly volumes: Map<string, ScalarVolumeData>
  readonly labelmaps: Map<string, LabelmapSegmentationData>

  addVolume(volume: ScalarVolumeData): void
  removeVolume(volumeId: string): void

  addLabelmap(labelmap: LabelmapSegmentationData): void
  removeLabelmap(labelmapId: string): void

  transaction<T>(fn: (tx: SceneTransaction) => T): SceneChangeSet<T>

  volumeIndexToWorld(volumeId: string, index: Vec3): Vec3
  worldToVolumeIndex(volumeId: string, world: Vec3): Vec3
  labelmapIndexToWorld(labelmapId: string, index: Vec3): Vec3
  worldToLabelmapIndex(labelmapId: string, world: Vec3): Vec3
}
```

## Section 2.5 SceneChangeSet

Scene mutation should be explicit enough for incremental preparation:

```ts
interface SceneChangeSet<T = unknown> {
  readonly sceneId: string
  readonly versionBefore: number
  readonly versionAfter: number
  readonly result: T
  readonly changes: SceneChange[]
}

type SceneChange =
  | { type: 'volume.added' | 'volume.removed'; volumeId: string }
  | { type: 'volume.changed'; volumeId: string; regions?: Box3i[] }
  | { type: 'labelmap.added' | 'labelmap.removed'; labelmapId: string }
  | { type: 'labelmap.metadataChanged'; labelmapId: string; segmentIndices?: number[] }
  | {
      type: 'labelmap.voxelsChanged'
      labelmapId: string
      regions?: Box3i[]
      segmentIndices?: number[]
    }
```

`SceneChangeSet` is the contract between the authoritative model and renderer
caches. A scene should not call renderers directly.

Example brush edit:

```ts
const changeSet = scene.transaction(tx => {
  tx.updateLabelmapRegion({
    labelmapId,
    segmentIndex,
    regions: [dirtyBox],
    write(labels) {
      // mutate CPU labelmap values
    },
  })
})
```

The transaction records a `labelmap.voxelsChanged` change. The renderer cache
later decides whether that means a partial texture upload, a LUT update, or a
full prepared-resource rebuild.

```ts
interface SceneTransaction {
  addVolume(volume: ScalarVolumeData): void
  updateVolume(volumeId: string, regions?: Box3i[]): void
  addLabelmap(labelmap: LabelmapSegmentationData): void
  updateLabelmapMetadata(labelmapId: string, segmentIndices?: number[]): void
  updateLabelmapRegion(input: {
    labelmapId: string
    segmentIndex?: number
    regions?: Box3i[]
    write(labels: Uint8Array | Uint16Array | Uint32Array): void
  }): void
}
```

## Section 2.6 Render Order

For the first implementation, render order is fixed:

```text
1. Scalar volume
2. Labelmap overlay
```

This avoids introducing a general scene graph before the renderer needs it.
Future data types can add their own scene model extensions without changing the
basic `SceneChangeSet` pattern.

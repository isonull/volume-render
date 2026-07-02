# Section 2. Scene

`Scene` is the long-lived CPU-side source of truth for the first
implementation. For now it only models scalar volumes loaded from NIfTI files.

Scene owns:

```text
scalar volumes
scene version
change journal
NIfTI-derived index-to-world transforms
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
labelmap segmentations
non-volume data
```

Those belong to `PreparedScene`, renderer preparation code, or future
extensions.

## Section 2.1 Data Facts

The first scene data model is intentionally narrow:

```ts
type DataObject = ScalarVolumeData
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
  readonly source: {
    readonly kind: 'nifti'
    readonly uri?: string
  }
  readonly shape: Vec3
  readonly data: ScalarVoxelArray
  readonly indexToWorld: Mat4
}
```

Meaning:

- `shape`: voxel array shape `[nx, ny, nz]`.
- `data`: scalar voxel values, indexed as `x + nx * (y + ny * z)`.
- `indexToWorld`: affine transform from voxel index coordinates to world coordinates.

NIfTI rules for the MVP:

- The only required input format is `.nii` or `.nii.gz`.
- NIfTI header dimensions, voxel spacing, orientation, and affine metadata are
  preserved when creating `ScalarVolumeData`.
- Voxel index coordinates are center-based: integer index `[i, j, k]` refers to
  the center of that voxel.
- World coordinates follow the NIfTI / medical image coordinate convention
  expressed by the selected NIfTI affine.
- If the NIfTI image lacks usable affine information, the loader must either
  construct the documented fallback affine from spacing metadata or fail with an
  explicit loader error.

## Section 2.3 Scene Object

```ts
class Scene {
  readonly id: string
  readonly frameOfReferenceUID?: string

  version: number

  readonly volumes: Map<string, ScalarVolumeData>

  addVolume(volume: ScalarVolumeData): void
  removeVolume(volumeId: string): void

  transaction<T>(fn: (tx: SceneTransaction) => T): SceneChangeSet<T>

  volumeIndexToWorld(volumeId: string, index: Vec3): Vec3
  worldToVolumeIndex(volumeId: string, world: Vec3): Vec3
}
```

## Section 2.4 SceneChangeSet

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
```

`SceneChangeSet` is the contract between the authoritative model and renderer
caches. A scene should not call renderers directly.

```ts
interface SceneTransaction {
  addVolume(volume: ScalarVolumeData): void
  updateVolume(volumeId: string, regions?: Box3i[]): void
}
```

Transaction rules for the MVP:

- A transaction is synchronous.
- If the transaction callback throws, the scene should not emit a
  `SceneChangeSet`.
- A missing `regions` field means the whole referenced object is dirty.
- An empty `regions` array means no voxel region changed and should be avoided.
- Multiple dirty boxes in one transaction may be merged before GPU upload.

## Section 2.5 Lifetime

For the MVP, scene and GPU-resource lifetime are coupled to NIfTI loading:

```text
load NIfTI
  -> create Scene and ScalarVolumeData
  -> create PreparedScene GPU resources on first render
destroy Scene
  -> release all PreparedScene GPU resources derived from that Scene
```

`Scene` owns CPU data only. `Engine` owns prepared GPU resources and must release
them when the active scene is destroyed or replaced.

## Section 2.6 Render Order

For the first implementation, render order is fixed:

```text
1. Scalar volume MPR
```

This avoids introducing a general scene graph before the renderer needs it.
Future labelmap or surface data types can add their own scene model extensions
without changing the basic `SceneChangeSet` pattern.

## Section 2.7 Future Scene Extensions

The following concepts are intentionally out of scope for the MVP:

```text
LabelmapSegmentationData
segment metadata
labelmap voxel dirty regions
annotation objects
surface objects
multiple scene graphs
```

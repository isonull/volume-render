# Section 2. Scene

`Scene` is the long-lived CPU-side source of truth. v0.01 keeps scalar volumes
loaded from NIfTI files and adds labelmap segmentation data associated with
those scalar volumes.

Scene owns:

```text
scalar volumes
labelmap segmentations
segment metadata
scene version
change journal
NIfTI-derived index-to-world transforms
segmentation dirty voxel regions
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
non-volume data
```

Those belong to `PreparedScene`, renderer preparation code, or future
extensions.

## Section 2.1 Data Facts

The v0.01 scene data model is still narrow:

```ts
type DataObject = ScalarVolumeData | LabelmapSegmentationData
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
textures, GPU buffers, color lookup textures, and acceleration structures are
prepared elsewhere.

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

NIfTI rules for v0.01:

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

## Section 2.3 Labelmap Segmentation

Labelmap segmentation is a voxel label array in the same index space as its
referenced scalar volume. In v0.01, a segmentation is owned by its source
volume: application code must create `LabelmapSegmentationData` from a
`ScalarVolumeData`, not by passing an arbitrary `sourceVolumeId`, shape, and
affine.

```ts
class LabelmapSegmentationData {
  readonly id: string
  readonly sourceVolumeId: string
  readonly shape: Vec3
  readonly data: LabelmapVoxelArray
  readonly indexToWorld: Mat4
  readonly segments: Map<number, Segment>

  static createFromVolume(
    volume: ScalarVolumeData,
    options?: {
      id?: string
      data?: LabelmapVoxelArray
      segments?: Iterable<Segment>
    },
  ): LabelmapSegmentationData
}

type LabelmapVoxelArray = Uint8Array | Uint16Array | Uint32Array

interface Segment {
  readonly label: number
  name: string
  color: [number, number, number]
  opacity: number
  visible: boolean
  locked: boolean
}
```

Rules:

- `sourceVolumeId` references the scalar volume the segmentation annotates.
- `shape` must match the referenced scalar volume for v0.01.
- `indexToWorld` must match the referenced scalar volume for v0.01.
- `LabelmapSegmentationData` has one creation path: create from a source
  volume. This prevents free-floating segmentations from entering the scene.
- External NIfTI segmentation import must first select a source volume. If the
  imported NIfTI shape or affine does not exactly match that volume, import
  fails with an explicit error. v0.01 does not resample, flip, or reinterpret
  segmentation data during import.
- Label value `0` is background and should not be treated as an editable
  anatomical segment by default.
- Non-zero labels map to `Segment` metadata.
- Segment metadata is CPU-side scene data; renderer color lookup tables are
  prepared resources.
- Segmentation voxel data is indexed as `x + nx * (y + ny * z)`.

v0.01 allows multiple volumes in one `Scene`. It does not require multiple
segmentations per source volume, but the scene model allows it. The first UX may
replace the active segmentation for a selected source volume when importing a
new segmentation.

## Section 2.4 Scene Object

```ts
class Scene {
  readonly id: string
  readonly frameOfReferenceUID?: string

  version: number

  readonly volumes: Map<string, ScalarVolumeData>
  readonly segmentations: Map<string, LabelmapSegmentationData>

  addVolume(volume: ScalarVolumeData): void
  removeVolume(volumeId: string): void
  addSegmentation(segmentation: LabelmapSegmentationData): void
  removeSegmentation(segmentationId: string): void
  updateSegmentation(segmentationId: string, regions?: Box3i[]): void

  transaction<T>(fn: (tx: SceneTransaction) => T): SceneChangeSet<T>

  volumeIndexToWorld(volumeId: string, index: Vec3): Vec3
  worldToVolumeIndex(volumeId: string, world: Vec3): Vec3
  segmentationIndexToWorld(segmentationId: string, index: Vec3): Vec3
  worldToSegmentationIndex(segmentationId: string, world: Vec3): Vec3
}
```

Validation rules:

- A segmentation cannot be added if its `sourceVolumeId` is missing.
- A segmentation cannot be added if its `shape` differs from the source volume.
- A segmentation cannot be added if its `indexToWorld` differs from the source
  volume. v0.01 uses exact affine equality for imported NIfTI segmentations.
- Removing a source volume should remove dependent segmentations in the same
  transaction. Directly removing a volume while dependent segmentations remain
  should fail with an explicit error.

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
  | { type: 'segmentation.added' | 'segmentation.removed'; segmentationId: string }
  | { type: 'segmentation.changed'; segmentationId: string; regions?: Box3i[] }
```

`SceneChangeSet` is the contract between the authoritative model and renderer
caches. A scene should not call renderers directly.

```ts
interface SceneTransaction {
  addVolume(volume: ScalarVolumeData): void
  removeVolume(volumeId: string): void
  updateVolume(volumeId: string, regions?: Box3i[]): void
  addSegmentation(segmentation: LabelmapSegmentationData): void
  updateSegmentation(segmentationId: string, regions?: Box3i[]): void
  removeSegmentation(segmentationId: string): void
}
```

Transaction rules:

- A transaction is synchronous.
- If the transaction callback throws, the scene should not emit a
  `SceneChangeSet`.
- A missing `regions` field means the whole referenced object is dirty.
- An empty `regions` array means no voxel region changed and should be avoided.
- Multiple dirty boxes in one transaction may be merged before GPU upload.
- Segmentation voxel edits should include dirty `Box3i` regions whenever the
  affected region is known.
- Segment metadata edits may emit `segmentation.changed` without regions.

## Section 2.6 Lifetime

For v0.01, one `Scene` can hold multiple NIfTI-backed scalar volumes. GPU
resource lifetime is coupled to the Scene, while individual volume lifetime is
managed through scene transactions:

```text
open volume
  -> create Scene if needed
  -> add ScalarVolumeData
  -> create PreparedScene GPU resources on first render

open segmentation from a source volume
  -> validate shape and affine against that source volume
  -> create LabelmapSegmentationData from the source volume
  -> write imported label data and segment metadata

close volume
  -> remove dependent segmentations in the same transaction
  -> remove ScalarVolumeData

destroy Scene
  -> release all PreparedScene GPU resources derived from that Scene
```

`Scene` owns CPU data only. `Engine` owns prepared GPU resources and must release
them when the active scene is destroyed or replaced.

## Section 2.7 Render Order

v0.01 renders scalar MPR and can composite one visible labelmap overlay from the
current `MprRenderState`:

```text
1. Scalar volume MPR
2. Optional labelmap overlay MPR
```

The scene model should not introduce a general scene graph. Segmentation facts
remain in `Scene`; overlay visibility remains in `MprRenderState`.

## Section 2.8 v0.01 Implementation Plan

Recommended implementation order:

```text
1. Add LabelmapSegmentationData and Segment types.
2. Add Scene.segmentations map.
3. Add SceneTransaction methods for segmentation add/remove/change.
4. Extend SceneChange with segmentation added/removed/changed events.
5. Add validation that segmentation shape and indexToWorld match source volume.
6. Extend Engine.applySceneChangeSet to recognize segmentation changes.
7. Add PreparedScene invalidation entries for segmentation structure and texture data.
8. Add volume-owned segmentation import from the Scene browser.
9. Add labelmap overlay shader once the scene contract is stable.
10. Defer brush tools, export, and undo/redo.
```

The first code milestone can import a matching NIfTI labelmap for a selected
source volume and verify that adding, changing, and removing it produces the
expected `SceneChangeSet` entries.

## Section 2.9 Future Scene Extensions

The following concepts are intentionally out of scope for v0.01:

```text
annotation objects
surface objects
multiple scene graphs
multi-resolution labelmaps
sparse labelmaps
derived contours and meshes
segmentation provenance
segmentation export
voxel-edit command history
```

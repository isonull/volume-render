# Section 6. Segmentation Tools

v0.02 implements the first MVP segmentation editing path.

Current v0.02 implementation covers segmentation loading, closing, overlay
selection, source-volume validation through commands, active segmentation state,
brush configuration, dirty-region labelmap editing, world-space sphere brush
paint/erase, and viewport-local pending stroke preview.

## Section 6.1 Segmentation State

Segmentation tools need explicit active state:

```ts
interface SegmentationToolState {
  activeVolumeId?: string
  activeSegmentationId?: string
  activeSegmentLabel: number
  brushRadiusMm: number
  brushMode: 'paint' | 'erase'
}
```

`SegmentationService` currently owns `activeSegmentationId`,
`activeSegmentLabel`, `brushRadiusMm`, `brushMode`, `upsertSegment`, and
`editLabelmap`. The active segmentation must be one of the segmentations owned
by the active source volume. Imported segmentations must have matching shape and
affine with their source volume.

## Section 6.2 Current Segmentation Command Path

Implemented segmentation import path:

```text
Open Segmentation UI
  -> parse NIfTI in React entry
  -> scene.openSegmentation command
  -> SceneService.applyTransaction
  -> replace existing segmentations for the same source volume
  -> add LabelmapSegmentationData
  -> RenderService.applySceneChangeSet
  -> mpr.setOverlaySegmentation command
```

Implemented segmentation close path:

```text
scene.closeSegmentation
  -> SceneService.applyTransaction(removeSegmentation)
  -> RenderService.applySceneChangeSet
  -> mpr.setOverlaySegmentation visible=false when it was active
```

## Section 6.3 Implemented Labelmap Edit Command

The implemented labelmap edit command path is:

```text
segmentation.editLabelmap command
  -> SegmentationService.editLabelmap
  -> mutates LabelmapSegmentationData.data
  -> computes dirty Box3i region
  -> SceneTransaction.updateSegmentation
  -> RenderService.applySceneChangeSet
  -> MprRenderer uploads dirty segmentation texture region
```

`LabelmapSegmentationData` remains the data owner. `SegmentationBrushTool`
computes the voxel edits for a stroke, but the command performs the actual
mutation.

## Section 6.4 Implemented Brush Behavior

The implemented brush is a world-space sphere brush:

```text
Brush mode
  -> writes active segment label

Erase mode
  -> writes label 0

radius
  -> stored in millimeters

candidate voxel selection
  -> convert pointer point to world
  -> estimate index-space bounds from affine column spacing
  -> test each candidate voxel center in world space
  -> include voxels inside the sphere radius
```

This is intentionally a sphere rather than a 2D disk on the MPR plane. MPR
planes may be oblique to the IJK voxel axes, so the sphere keeps brush behavior
stable in world space.

A single drag gesture is accumulated in memory and committed once:

```text
drag start
  -> create pending stroke

drag move
  -> stamp sphere edits into a map keyed by voxel offset

drag end
  -> execute segmentation.editLabelmap once
```

This avoids repeated labelmap writes and repeated texture uploads while the
mouse is moving.

## Section 6.5 Dirty Regions

Every segmentation edit command should return a dirty region:

```ts
interface DirtySegmentationRegion {
  segmentationId: string
  min: Vec3n
  max: Vec3n
}
```

The current renderer already accepts dirty regions and uploads only the provided
segmentation texture boxes through `writeLabelmapTexture`.

## Section 6.6 Preview

Preview is temporary viewport UI state. It is not committed into
`LabelmapSegmentationData`.

```text
hover or drag
  -> tool-local preview information
  -> ToolContext.onBrushPreviewChanged
  -> React overlay inside the active viewport

accepted edit
  -> EditLabelmapCommand
  -> LabelmapSegmentationData mutation
```

The current preview is a viewport-local DOM ring. Its radius is derived from the
brush radius in millimeters and the current MPR plane pixel size.

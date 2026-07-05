import type { Vec3n } from 'wgpu-matrix'
import type { Box3i } from '../scene'
import type { LabelmapSegmentationData, Segment } from '../segmentation'
import type { SceneService } from './sceneService'

export interface LabelmapVoxelEdit {
  readonly index: Vec3n
  readonly label: number
}

export interface EditLabelmapOptions {
  readonly segmentationId: string
  readonly edits: LabelmapVoxelEdit[]
}

export type BrushMode = 'paint' | 'erase'

export class SegmentationService {
  private readonly sceneService: SceneService
  private activeSegmentationId: string | null = null
  private activeSegmentLabel = 1
  private brushRadiusMm = 3
  private brushMode: BrushMode = 'paint'

  constructor(sceneService: SceneService) {
    this.sceneService = sceneService
  }

  getActiveSegmentation(): LabelmapSegmentationData | null {
    if (!this.activeSegmentationId) {
      return null
    }
    return this.sceneService.scene?.segmentations.get(this.activeSegmentationId) ?? null
  }

  getActiveSegmentationId(): string | null {
    return this.activeSegmentationId
  }

  setActiveSegmentation(segmentationId: string | null): void {
    if (segmentationId) {
      this.requireSegmentation(segmentationId)
    }
    this.activeSegmentationId = segmentationId
  }

  getActiveSegmentLabel(): number {
    return this.activeSegmentLabel
  }

  setActiveSegmentLabel(label: number): void {
    if (!Number.isInteger(label) || label < 0) {
      throw new Error(`Segment label must be a non-negative integer: ${label}`)
    }
    this.activeSegmentLabel = label
  }

  getBrushRadiusMm(): number {
    return this.brushRadiusMm
  }

  setBrushRadiusMm(radiusMm: number): void {
    if (!Number.isFinite(radiusMm) || radiusMm <= 0) {
      throw new Error(`Brush radius must be a positive finite number: ${radiusMm}`)
    }
    this.brushRadiusMm = radiusMm
  }

  getBrushMode(): BrushMode {
    return this.brushMode
  }

  setBrushMode(mode: BrushMode): void {
    this.brushMode = mode
  }

  upsertSegment(segmentationId: string, segment: Segment): void {
    if (segment.label === 0) {
      throw new Error('Segment label 0 is reserved for background.')
    }
    this.requireSegmentation(segmentationId).segments.set(segment.label, segment)
  }

  editLabelmap(options: EditLabelmapOptions): Box3i[] {
    const segmentation = this.requireSegmentation(options.segmentationId)
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let changed = false

    for (const edit of options.edits) {
      const [x, y, z] = edit.index
      if (!isIntegerVoxel(edit.index) || !isInBounds(edit.index, segmentation.shape)) {
        continue
      }
      if (!Number.isInteger(edit.label) || edit.label < 0) {
        throw new Error(`Labelmap edit label must be a non-negative integer: ${edit.label}`)
      }
      const offset = voxelOffset(segmentation.shape, x, y, z)
      if (segmentation.data[offset] === edit.label) {
        continue
      }
      segmentation.data[offset] = edit.label
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      minZ = Math.min(minZ, z)
      maxX = Math.max(maxX, x + 1)
      maxY = Math.max(maxY, y + 1)
      maxZ = Math.max(maxZ, z + 1)
      changed = true
    }

    if (!changed) {
      return []
    }

    return [{
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    }]
  }

  private requireSegmentation(segmentationId: string): LabelmapSegmentationData {
    const segmentation = this.sceneService.scene?.segmentations.get(segmentationId)
    if (!segmentation) {
      throw new Error(`Segmentation not found: ${segmentationId}`)
    }
    return segmentation
  }
}

function voxelOffset(shape: Vec3n, x: number, y: number, z: number): number {
  return x + shape[0] * (y + shape[1] * z)
}

function isIntegerVoxel(index: Vec3n): boolean {
  return Number.isInteger(index[0]) && Number.isInteger(index[1]) && Number.isInteger(index[2])
}

function isInBounds(index: Vec3n, shape: Vec3n): boolean {
  return index[0] >= 0
    && index[1] >= 0
    && index[2] >= 0
    && index[0] < shape[0]
    && index[1] < shape[1]
    && index[2] < shape[2]
}

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

export interface ReplaceLabelmapRegionOptions {
  readonly segmentationId: string
  readonly min: Vec3n
  readonly shape: Vec3n
  readonly data: ArrayLike<number>
  readonly layout: 'web-x-fastest' | 'c-order-xyz'
}

export interface UpsertSegmentOptions {
  readonly segmentationId: string
  readonly segment: Segment
}

export interface DeleteSegmentOptions {
  readonly segmentationId: string
  readonly label: number
}

export interface ApplyBinarySegmentRegionOptions {
  readonly segmentationId: string
  readonly label: number
  readonly min: Vec3n
  readonly shape: Vec3n
  readonly data: ArrayLike<number>
  readonly layout: 'web-x-fastest' | 'c-order-xyz'
  readonly preserveOtherLabels?: boolean
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

  upsertSegment(options: UpsertSegmentOptions): void {
    const segmentation = this.requireSegmentation(options.segmentationId)
    validateSegmentLabel(options.segment.label, segmentation.data)
    segmentation.segments.set(options.segment.label, { ...options.segment })
  }

  deleteSegment(options: DeleteSegmentOptions): Box3i[] {
    const segmentation = this.requireSegmentation(options.segmentationId)
    validateSegmentLabel(options.label, segmentation.data)
    segmentation.segments.delete(options.label)
    return this.clearSegmentLabel(options.segmentationId, options.label)
  }

  clearSegmentLabel(segmentationId: string, label: number): Box3i[] {
    const segmentation = this.requireSegmentation(segmentationId)
    validateSegmentLabel(label, segmentation.data)
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let changed = false
    const [nx, ny, nz] = segmentation.shape

    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const offset = voxelOffset(segmentation.shape, x, y, z)
          if (segmentation.data[offset] !== label) {
            continue
          }
          segmentation.data[offset] = 0
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          minZ = Math.min(minZ, z)
          maxX = Math.max(maxX, x + 1)
          maxY = Math.max(maxY, y + 1)
          maxZ = Math.max(maxZ, z + 1)
          changed = true
        }
      }
    }

    return changed ? [{
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    }] : []
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

  replaceLabelmapRegion(options: ReplaceLabelmapRegionOptions): Box3i[] {
    const segmentation = this.requireSegmentation(options.segmentationId)
    const min: Vec3n = [
      Math.max(0, Math.trunc(options.min[0])),
      Math.max(0, Math.trunc(options.min[1])),
      Math.max(0, Math.trunc(options.min[2])),
    ]
    const shape: Vec3n = [
      Math.max(0, Math.trunc(options.shape[0])),
      Math.max(0, Math.trunc(options.shape[1])),
      Math.max(0, Math.trunc(options.shape[2])),
    ]
    const max: Vec3n = [
      Math.min(segmentation.shape[0], min[0] + shape[0]),
      Math.min(segmentation.shape[1], min[1] + shape[1]),
      Math.min(segmentation.shape[2], min[2] + shape[2]),
    ]
    if (max[0] <= min[0] || max[1] <= min[1] || max[2] <= min[2]) {
      return []
    }

    let changed = false
    for (let z = min[2]; z < max[2]; z += 1) {
      for (let y = min[1]; y < max[1]; y += 1) {
        for (let x = min[0]; x < max[0]; x += 1) {
          const sourceOffset = options.layout === 'web-x-fastest'
            ? (x - min[0]) + shape[0] * ((y - min[1]) + shape[1] * (z - min[2]))
            : ((x - min[0]) * shape[1] + (y - min[1])) * shape[2] + (z - min[2])
          const label = options.data[sourceOffset]
          if (!Number.isInteger(label) || label < 0) {
            throw new Error(`Labelmap region label must be a non-negative integer: ${label}`)
          }
          const targetOffset = voxelOffset(segmentation.shape, x, y, z)
          if (segmentation.data[targetOffset] === label) {
            continue
          }
          segmentation.data[targetOffset] = label
          changed = true
        }
      }
    }

    return changed ? [{ min, max }] : []
  }

  applyBinarySegmentRegion(options: ApplyBinarySegmentRegionOptions): Box3i[] {
    const segmentation = this.requireSegmentation(options.segmentationId)
    validateSegmentLabel(options.label, segmentation.data)
    const min: Vec3n = [
      Math.max(0, Math.trunc(options.min[0])),
      Math.max(0, Math.trunc(options.min[1])),
      Math.max(0, Math.trunc(options.min[2])),
    ]
    const shape: Vec3n = [
      Math.max(0, Math.trunc(options.shape[0])),
      Math.max(0, Math.trunc(options.shape[1])),
      Math.max(0, Math.trunc(options.shape[2])),
    ]
    const max: Vec3n = [
      Math.min(segmentation.shape[0], min[0] + shape[0]),
      Math.min(segmentation.shape[1], min[1] + shape[1]),
      Math.min(segmentation.shape[2], min[2] + shape[2]),
    ]
    if (max[0] <= min[0] || max[1] <= min[1] || max[2] <= min[2]) {
      return []
    }

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let minZ = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    let maxZ = Number.NEGATIVE_INFINITY
    let changed = false
    for (let z = min[2]; z < max[2]; z += 1) {
      for (let y = min[1]; y < max[1]; y += 1) {
        for (let x = min[0]; x < max[0]; x += 1) {
          const sourceOffset = sourceRegionOffset(options.layout, shape, x - min[0], y - min[1], z - min[2])
          const maskValue = options.data[sourceOffset]
          if (!Number.isInteger(maskValue) || maskValue < 0) {
            throw new Error(`Binary segment patch value must be a non-negative integer: ${maskValue}`)
          }
          const targetOffset = voxelOffset(segmentation.shape, x, y, z)
          const current = segmentation.data[targetOffset]
          const next = maskValue > 0
            ? (options.preserveOtherLabels && current !== 0 && current !== options.label ? current : options.label)
            : (current === options.label ? 0 : current)
          if (current === next) {
            continue
          }
          segmentation.data[targetOffset] = next
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          minZ = Math.min(minZ, z)
          maxX = Math.max(maxX, x + 1)
          maxY = Math.max(maxY, y + 1)
          maxZ = Math.max(maxZ, z + 1)
          changed = true
        }
      }
    }

    return changed ? [{
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    }] : []
  }

  clearLabelmap(segmentationId: string): Box3i[] {
    const segmentation = this.requireSegmentation(segmentationId)
    let changed = false
    for (let index = 0; index < segmentation.data.length; index += 1) {
      if (segmentation.data[index] !== 0) {
        segmentation.data[index] = 0
        changed = true
      }
    }
    return changed ? [{ min: [0, 0, 0], max: segmentation.shape }] : []
  }

  private requireSegmentation(segmentationId: string): LabelmapSegmentationData {
    const segmentation = this.sceneService.scene?.segmentations.get(segmentationId)
    if (!segmentation) {
      throw new Error(`Segmentation not found: ${segmentationId}`)
    }
    return segmentation
  }
}

function validateSegmentLabel(label: number, data: LabelmapSegmentationData['data']): void {
  if (!Number.isInteger(label) || label <= 0) {
    throw new Error(`Segment label must be a positive integer: ${label}`)
  }
  const max = labelMax(data)
  if (label > max) {
    throw new Error(`Segment label ${label} exceeds ${data.constructor.name} maximum ${max}.`)
  }
}

function labelMax(data: LabelmapSegmentationData['data']): number {
  if (data instanceof Uint8Array) {
    return 0xff
  }
  if (data instanceof Uint16Array) {
    return 0xffff
  }
  return 0xffffffff
}

function voxelOffset(shape: Vec3n, x: number, y: number, z: number): number {
  return x + shape[0] * (y + shape[1] * z)
}

function sourceRegionOffset(
  layout: ReplaceLabelmapRegionOptions['layout'],
  shape: Vec3n,
  x: number,
  y: number,
  z: number,
): number {
  return layout === 'web-x-fastest'
    ? x + shape[0] * (y + shape[1] * z)
    : (x * shape[1] + y) * shape[2] + z
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

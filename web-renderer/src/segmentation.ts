import { mat4 } from 'wgpu-matrix'
import type { Mat4, Vec3n } from 'wgpu-matrix'
import type { Box3i } from './scene'
import type { ScalarVolume } from './volume'

export type LabelmapVoxelArray = Uint8Array | Uint16Array | Uint32Array

export interface Segment {
  readonly label: number
  name: string
  color: [number, number, number]
  opacity: number
  visible: boolean
  locked: boolean
}

export class LabelmapSegmentationData {
  readonly id: string
  readonly sourceVolumeId: string
  readonly shape: Vec3n
  readonly data: LabelmapVoxelArray
  readonly indexToWorld: Mat4
  readonly segments: Map<number, Segment>

  private constructor(
    sourceVolumeId: string,
    shape: Vec3n,
    data: LabelmapVoxelArray,
    indexToWorld: Mat4,
    options: {
      id?: string
      segments?: Iterable<Segment>
    } = {},
  ) {
    const voxelCount = shape[0] * shape[1] * shape[2]
    if (data.length !== voxelCount) {
      throw new Error(`Labelmap data length ${data.length} does not match shape voxel count ${voxelCount}.`)
    }

    this.id = options.id ?? `${sourceVolumeId}-labelmap`
    this.sourceVolumeId = sourceVolumeId
    this.shape = shape
    this.data = data
    this.indexToWorld = indexToWorld
    this.segments = new Map()

    for (const segment of options.segments ?? []) {
      if (segment.label === 0) {
        throw new Error('Segment label 0 is reserved for background.')
      }
      this.segments.set(segment.label, segment)
    }
  }

  static createFromVolume(
    volume: ScalarVolume,
    options: {
      id?: string
      data?: LabelmapVoxelArray
      segments?: Iterable<Segment>
    } = {},
  ): LabelmapSegmentationData {
    const shape: Vec3n = [volume.shape[0], volume.shape[1], volume.shape[2]]
    const data = options.data ?? new Uint8Array(shape[0] * shape[1] * shape[2])
    return new LabelmapSegmentationData(
      volume.id,
      shape,
      data,
      mat4.clone(volume.indexToWorld),
      {
        id: options.id,
        segments: options.segments,
      },
    )
  }
}

export function createLabelmapGPUTexture(device: GPUDevice, segmentation: LabelmapSegmentationData): GPUTexture {
  const format = labelmapTextureFormat(segmentation.data)
  const texture = device.createTexture({
    label: `Labelmap texture ${segmentation.id}`,
    size: segmentation.shape,
    dimension: '3d',
    format,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })

  writeLabelmapTexture(device, texture, segmentation)
  return texture
}

export function writeLabelmapTexture(
  device: GPUDevice,
  texture: GPUTexture,
  segmentation: LabelmapSegmentationData,
  regions?: Box3i[],
): void {
  const uploadRegions = regions?.length ? regions : [{ min: [0, 0, 0], max: segmentation.shape }]

  for (const region of uploadRegions) {
    writeLabelmapRegion(device, texture, segmentation, region)
  }
}

function writeLabelmapRegion(
  device: GPUDevice,
  texture: GPUTexture,
  segmentation: LabelmapSegmentationData,
  region: Box3i,
): void {
  const min: Vec3n = [
    Math.max(0, region.min[0]),
    Math.max(0, region.min[1]),
    Math.max(0, region.min[2]),
  ]
  const max: Vec3n = [
    Math.min(segmentation.shape[0], region.max[0]),
    Math.min(segmentation.shape[1], region.max[1]),
    Math.min(segmentation.shape[2], region.max[2]),
  ]
  const width = max[0] - min[0]
  const height = max[1] - min[1]
  const depth = max[2] - min[2]

  if (width <= 0 || height <= 0 || depth <= 0) {
    return
  }

  const bytesPerVoxel = segmentation.data.BYTES_PER_ELEMENT
  const bytesPerRow = alignTo(width * bytesPerVoxel, 256)
  const rowStride = bytesPerRow / bytesPerVoxel
  const UploadArray = segmentation.data.constructor as new (length: number) => LabelmapVoxelArray
  const padded = new UploadArray(rowStride * height * depth)
  const [nx, ny] = segmentation.shape

  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      const sourceOffset = min[0] + nx * (min[1] + y + ny * (min[2] + z))
      const targetOffset = rowStride * (y + height * z)
      padded.set(segmentation.data.subarray(sourceOffset, sourceOffset + width), targetOffset)
    }
  }

  device.queue.writeTexture(
    { texture, origin: min },
    padded,
    { bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: depth },
  )
}

function labelmapTextureFormat(data: LabelmapVoxelArray): GPUTextureFormat {
  if (data instanceof Uint8Array) {
    return 'r8uint'
  }
  if (data instanceof Uint16Array) {
    return 'r16uint'
  }
  return 'r32uint'
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

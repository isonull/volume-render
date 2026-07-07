import { mat4 } from 'wgpu-matrix'
import type { Mat4, Vec3n } from 'wgpu-matrix'

const MAX_TEXTURE_UPLOAD_BYTES = 32 * 1024 * 1024

export type ScalarVoxelArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array

export class ScalarVolume {
  readonly id: string
  readonly source?: {
    readonly kind: 'nifti'
    readonly uri?: string
  }
  readonly shape: Vec3n
  readonly data: ScalarVoxelArray
  readonly indexToWorld: Mat4

  constructor(
    shape: Vec3n,
    data: ScalarVoxelArray,
    indexToWorld: Mat4,
    options: {
      id?: string
      source?: {
        readonly kind: 'nifti'
        readonly uri?: string
      }
    } = {},
  ) {
    this.id = options.id ?? 'volume'
    this.source = options.source
    this.shape = shape
    this.data = data
    this.indexToWorld = indexToWorld
  }
}

export function indexToTexByShape(shape: Vec3n): Mat4 {
  const [dx, dy, dz] = shape
  return mat4.set(
    1 / dx, 0, 0, 0,
    0, 1 / dy, 0, 0,
    0, 0, 1 / dz, 0,
    0.5 / dx, 0.5 / dy, 0.5 / dz, 1,
  )
}

export function createGPUTexture(device: GPUDevice, volume: ScalarVolume): GPUTexture {
  const maxDim = device.limits.maxTextureDimension3D
  if (volume.shape.some(dim => dim > maxDim)) {
    throw new Error(`Volume dimensions ${volume.shape.join(' x ')} exceed WebGPU maxTextureDimension3D ${maxDim}.`)
  }

  const texture = device.createTexture({
    size: volume.shape,
    dimension: '3d',
    format: 'r32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const { shape, data } = volume
  const bytesPerVoxel = 4
  const bytesPerRow = alignTo(shape[0] * bytesPerVoxel, 256)
  const rowsPerImage = shape[1]
  const floatsPerRow = bytesPerRow / bytesPerVoxel
  const bytesPerSlice = bytesPerRow * rowsPerImage
  const slicesPerUpload = Math.max(1, Math.floor(MAX_TEXTURE_UPLOAD_BYTES / bytesPerSlice))

  for (let zStart = 0; zStart < shape[2]; zStart += slicesPerUpload) {
    const depth = Math.min(slicesPerUpload, shape[2] - zStart)
    const padded = new Float32Array(floatsPerRow * rowsPerImage * depth)
    for (let localZ = 0; localZ < depth; localZ += 1) {
      const z = zStart + localZ
      for (let y = 0; y < shape[1]; y += 1) {
        const sourceOffset = shape[0] * (y + shape[1] * z)
        const targetOffset = floatsPerRow * (y + rowsPerImage * localZ)
        for (let x = 0; x < shape[0]; x += 1) {
          padded[targetOffset + x] = data[sourceOffset + x]
        }
      }
    }

    device.queue.writeTexture(
      { texture, origin: [0, 0, zStart] },
      padded,
      { bytesPerRow, rowsPerImage },
      [shape[0], shape[1], depth],
    )
    device.queue.submit([])
  }

  return texture
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

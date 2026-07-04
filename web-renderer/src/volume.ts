import { mat4 } from 'wgpu-matrix'
import type { Mat4, Vec3n } from 'wgpu-matrix'

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
  const padded = new Float32Array((bytesPerRow / bytesPerVoxel) * shape[1] * shape[2])

  for (let z = 0; z < shape[2]; z += 1) {
    for (let y = 0; y < shape[1]; y += 1) {
      const sourceOffset = shape[0] * (y + shape[1] * z)
      const targetOffset = (bytesPerRow / bytesPerVoxel) * (y + shape[1] * z)
      for (let x = 0; x < shape[0]; x += 1) {
        padded[targetOffset + x] = data[sourceOffset + x]
      }
    }
  }

  device.queue.writeTexture(
    { texture },
    padded,
    { bytesPerRow, rowsPerImage: shape[1] },
    shape,
  )

  return texture
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

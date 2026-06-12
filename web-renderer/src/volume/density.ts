import type { DensityVolume, NiftiVolume, Vec3 } from './volumeData'

export interface DensityOptions {
  windowMin: number
  windowMax: number
  maxDim?: number
}

export function createDensityVolume(
  volume: NiftiVolume,
  options: DensityOptions,
): DensityVolume {
  const maxDim = options.maxDim ?? 128
  const sourceDims = volume.dims
  const sourceMax = Math.max(...sourceDims)
  const factor = sourceMax > maxDim ? maxDim / sourceMax : 1
  const dims: Vec3 = [
    Math.max(1, Math.round(sourceDims[0] * factor)),
    Math.max(1, Math.round(sourceDims[1] * factor)),
    Math.max(1, Math.round(sourceDims[2] * factor)),
  ]
  const spacing: Vec3 = [
    volume.spacing[0] * (sourceDims[0] / dims[0]),
    volume.spacing[1] * (sourceDims[1] / dims[1]),
    volume.spacing[2] * (sourceDims[2] / dims[2]),
  ]
  const density = new Float32Array(dims[0] * dims[1] * dims[2])
  const range = Math.max(1e-6, options.windowMax - options.windowMin)

  for (let z = 0; z < dims[2]; z += 1) {
    const sourceZ = Math.min(sourceDims[2] - 1, Math.floor((z / dims[2]) * sourceDims[2]))
    for (let y = 0; y < dims[1]; y += 1) {
      const sourceY = Math.min(sourceDims[1] - 1, Math.floor((y / dims[1]) * sourceDims[1]))
      for (let x = 0; x < dims[0]; x += 1) {
        const sourceX = Math.min(sourceDims[0] - 1, Math.floor((x / dims[0]) * sourceDims[0]))
        const sourceIndex = sourceX + sourceDims[0] * (sourceY + sourceDims[1] * sourceZ)
        const targetIndex = x + dims[0] * (y + dims[1] * z)
        density[targetIndex] = clamp01((volume.data[sourceIndex] - options.windowMin) / range)
      }
    }
  }

  return { dims, spacing, density }
}

export function packDensityR8(volume: DensityVolume): Uint8Array {
  const out = new Uint8Array(volume.density.length)
  for (let i = 0; i < volume.density.length; i += 1) {
    out[i] = Math.max(0, Math.min(255, Math.round(volume.density[i] * 255)))
  }
  return out
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

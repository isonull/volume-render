import type { Vec3n } from 'wgpu-matrix'
import type { DensityVolume, MajorantGrid } from './types'
import { DEFAULT_VOLUME_BOUNDS } from './types'

export function buildMajorantGrid(volume: DensityVolume, res: Vec3n = [16, 16, 16]): MajorantGrid {
  const voxels = new Float32Array(res[0] * res[1] * res[2])
  let globalMaxDensity = 0

  for (let z = 0; z < volume.dims[2]; z += 1) {
    const cellZ = Math.min(res[2] - 1, Math.floor((z / volume.dims[2]) * res[2]))
    for (let y = 0; y < volume.dims[1]; y += 1) {
      const cellY = Math.min(res[1] - 1, Math.floor((y / volume.dims[1]) * res[1]))
      for (let x = 0; x < volume.dims[0]; x += 1) {
        const cellX = Math.min(res[0] - 1, Math.floor((x / volume.dims[0]) * res[0]))
        const density = volume.density[x + volume.dims[0] * (y + volume.dims[1] * z)]
        const cellIndex = cellX + res[0] * (cellY + res[1] * cellZ)
        voxels[cellIndex] = Math.max(voxels[cellIndex], density)
        globalMaxDensity = Math.max(globalMaxDensity, density)
      }
    }
  }

  return { bounds: DEFAULT_VOLUME_BOUNDS, res, voxels, globalMaxDensity }
}

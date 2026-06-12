import * as nifti from 'nifti-reader-js'
import { NIFTI1 } from 'nifti-reader-js'
import type { NiftiVolume, Vec3 } from '../volume/volumeData'

type NiftiHeader = ReturnType<typeof nifti.readHeader>

export async function loadNiftiFile(file: File): Promise<NiftiVolume> {
  const source = await file.arrayBuffer()
  const data = nifti.isCompressed(source) ? nifti.decompress(source) : source
  const buffer = toArrayBuffer(data)

  if (!nifti.isNIFTI(buffer)) {
    throw new Error('Selected file is not a NIfTI .nii or .nii.gz volume.')
  }

  const header = nifti.readHeader(buffer)
  const image = nifti.readImage(header, buffer)
  const dims: Vec3 = [
    Math.max(1, header.dims[1] ?? 1),
    Math.max(1, header.dims[2] ?? 1),
    Math.max(1, header.dims[3] ?? 1),
  ]
  const spacing: Vec3 = [
    Math.abs(header.pixDims[1] || 1),
    Math.abs(header.pixDims[2] || 1),
    Math.abs(header.pixDims[3] || 1),
  ]

  const voxelCount = dims[0] * dims[1] * dims[2]
  const raw = convertImageToFloat32(header, image, voxelCount)
  const slope = header.scl_slope === 0 ? 1 : header.scl_slope || 1
  const intercept = header.scl_inter || 0

  let intensityMin = Number.POSITIVE_INFINITY
  let intensityMax = Number.NEGATIVE_INFINITY
  for (let i = 0; i < raw.length; i += 1) {
    const value = raw[i] * slope + intercept
    raw[i] = value
    intensityMin = Math.min(intensityMin, value)
    intensityMax = Math.max(intensityMax, value)
  }

  return { dims, spacing, data: raw, intensityMin, intensityMax }
}

function convertImageToFloat32(
  header: NiftiHeader,
  image: ArrayBuffer,
  voxelCount: number,
): Float32Array {
  const view = new DataView(image)
  const out = new Float32Array(voxelCount)
  const littleEndian = header.littleEndian

  for (let i = 0; i < voxelCount; i += 1) {
    out[i] = readVoxel(view, i, header.datatypeCode, littleEndian)
  }

  return out
}

function readVoxel(
  view: DataView,
  index: number,
  datatypeCode: number,
  littleEndian: boolean,
): number {
  switch (datatypeCode) {
    case NIFTI1.TYPE_UINT8:
      return view.getUint8(index)
    case NIFTI1.TYPE_INT8:
      return view.getInt8(index)
    case NIFTI1.TYPE_INT16:
      return view.getInt16(index * 2, littleEndian)
    case NIFTI1.TYPE_UINT16:
      return view.getUint16(index * 2, littleEndian)
    case NIFTI1.TYPE_INT32:
      return view.getInt32(index * 4, littleEndian)
    case NIFTI1.TYPE_UINT32:
      return view.getUint32(index * 4, littleEndian)
    case NIFTI1.TYPE_FLOAT32:
      return view.getFloat32(index * 4, littleEndian)
    case NIFTI1.TYPE_FLOAT64:
      return view.getFloat64(index * 8, littleEndian)
    default:
      throw new Error(`Unsupported NIfTI datatype code: ${datatypeCode}`)
  }
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferLike): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data
  }
  return new Uint8Array(data).slice().buffer
}

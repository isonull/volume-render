import * as nifti from 'nifti-reader-js'
import { NIFTI1 } from 'nifti-reader-js'
import { mat4, vec3, type Mat4, type Vec3, type Vec3n } from 'wgpu-matrix'
import { LabelmapSegmentationData } from '../segmentation'
import type { LabelmapVoxelArray, Segment } from '../segmentation'
import { ScalarVolume } from '../volume'
import type { ScalarVoxelArray } from '../volume'

type NiftiHeader = ReturnType<typeof nifti.readHeader>

type NiftiDataKind =
  | 'scalar-volume'
  | 'labelmap'
  | 'rgb-volume'
  | 'time-series'
  | 'multi-channel'
  | 'vector-field'
  | 'tensor'
  | 'complex'
  | 'unsupported'

interface NiftiLayout {
  dimCount: number
  spatialRank: 1 | 2 | 3
  spatialShape: Vec3n
  extraShape: number[]
  voxelComponents: number
  voxelCount: number
}

export interface NiftiFile {
  header: NiftiHeader
  image: ArrayBuffer
}

const NIFTI_INTENT_LABEL = 1002
const NIFTI_INTENT_SYMMATRIX = 1005
const NIFTI_INTENT_VECTOR = 1007

export async function loadNiftiFile(file: File): Promise<NiftiFile> {
  const source = await file.arrayBuffer()
  const data = nifti.isCompressed(source) ? nifti.decompress(source) : source
  const buffer = toArrayBuffer(data)

  if (!nifti.isNIFTI(buffer)) {
    throw new Error('Selected file is not a NIfTI .nii or .nii.gz file.')
  }

  const header = nifti.readHeader(buffer)
  const image = nifti.readImage(header, buffer)

  return {
    header,
    image,
  }
}

export function scalarVolumeFromNiftiFile(niftiFile: NiftiFile, fileName?: string): ScalarVolume {
  const { header, image } = niftiFile
  const layout = parseNiftiLayout(header)
  const kind = classifyNifti(header, layout)

  if (layout.spatialRank !== 3) {
    throw new Error(`Cannot convert ${layout.spatialRank}D spatial NIfTI to ScalarVolume.`)
  }

  if (layout.extraShape.some(dim => dim > 1)) {
    throw new Error(
      `Cannot convert NIfTI with extra dimensions (${layout.extraShape.join(' x ')}) to a single ScalarVolume. Select a frame/channel first.`,
    )
  }

  if (kind !== 'scalar-volume') {
    throw new Error(`Cannot convert ${kind} NIfTI to ScalarVolume.`)
  }

  if (!isScalarDatatype(header.datatypeCode)) {
    throw new Error(`Cannot convert datatype ${describeDatatype(header.datatypeCode)} to ScalarVolume.`)
  }

  const dims = layout.spatialShape
  const indexToWorld = getIndexToWorld(header, dims)
  const voxelCount = dims[0] * dims[1] * dims[2]
  const slope = header.scl_slope === 0 ? 1 : header.scl_slope || 1
  const intercept = header.scl_inter || 0
  const data = convertImageToScalarArray(header, image, voxelCount, slope, intercept)

  return new ScalarVolume(dims, data, indexToWorld, {
    id: volumeIdFromFileName(fileName),
    source: {
      kind: 'nifti',
      uri: fileName,
    },
  })
}

function volumeIdFromFileName(fileName?: string): string {
  if (!fileName) {
    return 'volume'
  }
  const base = fileName
    .replace(/\.nii(?:\.gz)?$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base ? `volume-${base}` : 'volume'
}

export function indexToWorldFromNiftiFile(niftiFile: NiftiFile): Mat4 {
  const layout = parseNiftiLayout(niftiFile.header)
  return getIndexToWorld(niftiFile.header, layout.spatialShape)
}

export function labelmapSegmentationFromNiftiFile(
  niftiFile: NiftiFile,
  sourceVolume: ScalarVolume,
  fileName?: string,
): LabelmapSegmentationData {
  const { header, image } = niftiFile
  const layout = parseNiftiLayout(header)
  const kind = classifyNifti(header, layout)

  if (layout.spatialRank !== 3) {
    throw new Error(`Cannot convert ${layout.spatialRank}D spatial NIfTI to LabelmapSegmentationData.`)
  }

  if (layout.extraShape.some(dim => dim > 1)) {
    throw new Error(
      `Cannot convert NIfTI segmentation with extra dimensions (${layout.extraShape.join(' x ')}) to a single labelmap.`,
    )
  }

  if (kind !== 'labelmap' && kind !== 'scalar-volume') {
    throw new Error(`Cannot convert ${kind} NIfTI to LabelmapSegmentationData.`)
  }

  const indexToWorld = getIndexToWorld(header, layout.spatialShape)
  if (!sameShape(layout.spatialShape, sourceVolume.shape)) {
    throw new Error(
      `Segmentation shape ${layout.spatialShape.join(' x ')} does not match image shape ${sourceVolume.shape.join(' x ')}.`,
    )
  }
  if (!sameMat4(indexToWorld, sourceVolume.indexToWorld)) {
    throw new Error('Segmentation affine does not exactly match image affine.')
  }

  const labels = convertImageToLabelmapArray(header, image, layout.voxelCount)
  return LabelmapSegmentationData.createFromVolume(sourceVolume, {
    id: segmentationIdFromFileName(sourceVolume.id, fileName),
    data: labels,
    segments: createSegments(labels, fileName),
  })
}

function segmentationIdFromFileName(sourceVolumeId: string, fileName?: string): string {
  if (!fileName) {
    return `${sourceVolumeId}-segmentation`
  }
  const base = fileName
    .replace(/\.nii(?:\.gz)?$/i, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base ? `${sourceVolumeId}-segmentation-${base}` : `${sourceVolumeId}-segmentation`
}

function sameShape(a: Vec3n, b: Vec3n): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

function sameMat4(a: Mat4, b: Mat4): boolean {
  return a.every((value, index) => value === b[index])
}

function parseNiftiLayout(header: NiftiHeader): NiftiLayout {
  const dimCount = Math.max(0, header.dims[0] ?? 0)
  const spatialShape: Vec3n = [
    Math.max(1, header.dims[1] ?? 1),
    Math.max(1, header.dims[2] ?? 1),
    Math.max(1, header.dims[3] ?? 1),
  ]
  const spatialRank =
    dimCount >= 3 && spatialShape[2] > 1 ? 3 :
      dimCount >= 2 && spatialShape[1] > 1 ? 2 :
        1

  const extraShape: number[] = []
  for (let axis = 4; axis <= dimCount; axis += 1) {
    const size = Math.max(1, header.dims[axis] ?? 1)
    if (size > 1) {
      extraShape.push(size)
    }
  }

  const voxelComponents = header.datatypeCode === NIFTI1.TYPE_RGB24 ? 3 : 1
  const voxelCount = spatialShape[0] * spatialShape[1] * spatialShape[2]

  return {
    dimCount,
    spatialRank,
    spatialShape,
    extraShape,
    voxelComponents,
    voxelCount,
  }
}

function convertImageToLabelmapArray(
  header: NiftiHeader,
  image: ArrayBuffer,
  voxelCount: number,
): LabelmapVoxelArray {
  if (!isScalarDatatype(header.datatypeCode)) {
    throw new Error(`Cannot convert datatype ${describeDatatype(header.datatypeCode)} to labelmap.`)
  }

  const view = new DataView(image)
  const littleEndian = header.littleEndian
  let maxLabel = 0
  const values = new Uint32Array(voxelCount)

  for (let i = 0; i < voxelCount; i += 1) {
    const value = readVoxel(view, i, header.datatypeCode, littleEndian)
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Labelmap voxel ${i} has non-integer or negative label value ${value}.`)
    }
    if (value > 0xffffffff) {
      throw new Error(`Labelmap voxel ${i} label value ${value} exceeds Uint32 range.`)
    }
    values[i] = value
    maxLabel = Math.max(maxLabel, value)
  }

  if (maxLabel <= 0xff) {
    return new Uint8Array(values)
  }
  if (maxLabel <= 0xffff) {
    return new Uint16Array(values)
  }
  return values
}

function createSegments(data: LabelmapVoxelArray, fileName?: string): Segment[] {
  const labels = new Set<number>()
  for (const label of data) {
    if (label > 0) {
      labels.add(label)
    }
  }

  return [...labels].sort((a, b) => a - b).map(label => ({
    label,
    name: `${fileName ?? 'Segmentation'} label ${label}`,
    color: segmentColor(label),
    opacity: 0.55,
    visible: true,
    locked: false,
  }))
}

function segmentColor(label: number): [number, number, number] {
  const hue = (label * 0.61803398875) % 1
  const [r, g, b] = hsvToRgb(hue, 0.72, 0.95)
  return [r, g, b]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)

  switch (i % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}

function classifyNifti(header: NiftiHeader, layout: NiftiLayout): NiftiDataKind {
  if (isComplexDatatype(header.datatypeCode)) {
    return 'complex'
  }

  if (header.datatypeCode === NIFTI1.TYPE_RGB24) {
    return 'rgb-volume'
  }

  if (header.intent_code === NIFTI_INTENT_VECTOR) {
    return 'vector-field'
  }

  if (header.intent_code === NIFTI_INTENT_SYMMATRIX) {
    return 'tensor'
  }

  if (header.intent_code === NIFTI_INTENT_LABEL) {
    return 'labelmap'
  }

  if (layout.extraShape.length === 0) {
    return 'scalar-volume'
  }

  if (layout.extraShape.length === 1) {
    const extra = layout.extraShape[0]
    if (extra === 3 || extra === 4) {
      return 'multi-channel'
    }
    return 'time-series'
  }

  return 'unsupported'
}

function convertImageToScalarArray(
  header: NiftiHeader,
  image: ArrayBuffer,
  voxelCount: number,
  slope: number,
  intercept: number,
): ScalarVoxelArray {
  const view = new DataView(image)
  const shouldScale = slope !== 1 || intercept !== 0
  const out = shouldScale
    ? new Float32Array(voxelCount)
    : createScalarArray(header.datatypeCode, voxelCount)
  const littleEndian = header.littleEndian

  for (let i = 0; i < voxelCount; i += 1) {
    const value = readVoxel(view, i, header.datatypeCode, littleEndian)
    out[i] = shouldScale ? value * slope + intercept : value
  }

  return out
}

function createScalarArray(datatypeCode: number, voxelCount: number): ScalarVoxelArray {
  switch (datatypeCode) {
    case NIFTI1.TYPE_UINT8:
      return new Uint8Array(voxelCount)
    case NIFTI1.TYPE_INT8:
      return new Int8Array(voxelCount)
    case NIFTI1.TYPE_INT16:
      return new Int16Array(voxelCount)
    case NIFTI1.TYPE_UINT16:
      return new Uint16Array(voxelCount)
    case NIFTI1.TYPE_INT32:
      return new Int32Array(voxelCount)
    case NIFTI1.TYPE_UINT32:
      return new Uint32Array(voxelCount)
    case NIFTI1.TYPE_FLOAT32:
      return new Float32Array(voxelCount)
    case NIFTI1.TYPE_FLOAT64:
      return new Float64Array(voxelCount)
    default:
      throw new Error(`Unsupported scalar NIfTI datatype code: ${datatypeCode}`)
  }
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
      throw new Error(`Unsupported scalar NIfTI datatype code: ${datatypeCode}`)
  }
}

function isScalarDatatype(datatypeCode: number): boolean {
  return [
    NIFTI1.TYPE_UINT8,
    NIFTI1.TYPE_INT8,
    NIFTI1.TYPE_INT16,
    NIFTI1.TYPE_UINT16,
    NIFTI1.TYPE_INT32,
    NIFTI1.TYPE_UINT32,
    NIFTI1.TYPE_FLOAT32,
    NIFTI1.TYPE_FLOAT64,
  ].includes(datatypeCode)
}

function isComplexDatatype(datatypeCode: number): boolean {
  return [
    NIFTI1.TYPE_COMPLEX64,
    NIFTI1.TYPE_COMPLEX128,
    NIFTI1.TYPE_COMPLEX256,
  ].includes(datatypeCode)
}

function describeDatatype(datatypeCode: number): string {
  switch (datatypeCode) {
    case NIFTI1.TYPE_NONE:
      return 'none'
    case NIFTI1.TYPE_BINARY:
      return 'binary/bit-packed'
    case NIFTI1.TYPE_COMPLEX64:
      return 'complex64'
    case NIFTI1.TYPE_COMPLEX128:
      return 'complex128'
    case NIFTI1.TYPE_COMPLEX256:
      return 'complex256'
    case NIFTI1.TYPE_RGB24:
      return 'RGB24'
    case NIFTI1.TYPE_FLOAT128:
      return 'float128'
    default:
      return String(datatypeCode)
  }
}

function getSpacing(header: NiftiHeader): Vec3 {
  return vec3.create(
    Math.abs(header.pixDims[1] || 1),
    Math.abs(header.pixDims[2] || 1),
    Math.abs(header.pixDims[3] || 1),
  )
}

function getIndexToWorld(header: NiftiHeader, spatialShape: Vec3n): Mat4 {
  if (header.affine?.length === 4 && header.affine.every(row => row.length === 4)) {
    return niftiAffineRowsToMat4(header.affine)
  }

  const spacing = getSpacing(header)
  const center = vec3.create(
    -0.5 * (spatialShape[0] - 1) * spacing[0],
    -0.5 * (spatialShape[1] - 1) * spacing[1],
    -0.5 * (spatialShape[2] - 1) * spacing[2],
  )

  return mat4.set(
    spacing[0], 0, 0, 0,
    0, spacing[1], 0, 0,
    0, 0, spacing[2], 0,
    center[0], center[1], center[2], 1,
  )
}

function niftiAffineRowsToMat4(rows: number[][]): Mat4 {
  const rowMajorAffine = mat4.set(
    rows[0][0], rows[0][1], rows[0][2], rows[0][3],
    rows[1][0], rows[1][1], rows[1][2], rows[1][3],
    rows[2][0], rows[2][1], rows[2][2], rows[2][3],
    rows[3][0], rows[3][1], rows[3][2], rows[3][3],
  )
  return mat4.transpose(rowMajorAffine)
}

function toArrayBuffer(data: ArrayBuffer | ArrayBufferLike): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data
  }
  return new Uint8Array(data).slice().buffer
}

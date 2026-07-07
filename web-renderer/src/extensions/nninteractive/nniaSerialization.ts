export type NniaTypedArray =
  | Uint8Array
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | Float32Array
  | Float64Array

export interface NniaArray {
  readonly shape: number[]
  readonly dtype: string
  readonly data: NniaTypedArray
}

export interface ExternalBlosc2Codec {
  compress(
    input: Uint8Array,
    options: {
      codec: 'zstd' | 'lz4'
      clevel: number
      typesize: number
      filters: 'nofilter' | 'shuffle'
    },
  ): Promise<Uint8Array>
  decompress(input: Uint8Array, expectedBytes: number): Promise<Uint8Array>
}

export interface Blosc2Codec {
  readonly available: boolean
  compress(input: Uint8Array, typesize: number, filters: 'nofilter' | 'shuffle'): Promise<Uint8Array>
  decompress(input: Uint8Array, expectedBytes: number): Promise<Uint8Array>
}

const MAGIC = 'NNIA'
const VERSION = 1
const CODEC_ZSTD = 1
const CHUNK_SIZE = 1 << 30

declare global {
  // Optional integration hook for an application-provided browser Blosc2 WASM codec.
  // The web-renderer repo intentionally does not vendor a raw Blosc2 codec.
  var nnInteractiveBlosc2Codec: ExternalBlosc2Codec | undefined
}

export function createBrowserBlosc2Codec(): Blosc2Codec {
  return {
    get available() {
      return Boolean(globalThis.nnInteractiveBlosc2Codec)
    },
    async compress(input, typesize, filters) {
      const codec = globalThis.nnInteractiveBlosc2Codec
      if (!codec) {
        throw new Error(blosc2UnavailableMessage())
      }
      return codec.compress(input, {
        codec: 'zstd',
        clevel: 3,
        typesize,
        filters,
      })
    },
    async decompress(input, expectedBytes) {
      const codec = globalThis.nnInteractiveBlosc2Codec
      if (!codec) {
        throw new Error(blosc2UnavailableMessage())
      }
      return codec.decompress(input, expectedBytes)
    },
  }
}

export async function packNniaArray(
  array: NniaArray,
  codec: Blosc2Codec,
  filters: 'nofilter' | 'shuffle' = 'shuffle',
): Promise<Uint8Array> {
  const dtype = dtypeName(array.data)
  const dtypeBytes = ascii(dtype)
  if (dtypeBytes.length > 255) {
    throw new Error(`dtype name too long: ${dtype}`)
  }
  const raw = bytesOf(array.data)
  const chunks: { uncompressedLength: number; compressed: Uint8Array }[] = []
  for (let offset = 0; offset < raw.byteLength; offset += CHUNK_SIZE) {
    const end = Math.min(offset + CHUNK_SIZE, raw.byteLength)
    const chunk = raw.subarray(offset, end)
    chunks.push({
      uncompressedLength: chunk.byteLength,
      compressed: await codec.compress(chunk, array.data.BYTES_PER_ELEMENT, filters),
    })
  }

  const headerLength = 8 + dtypeBytes.length + array.shape.length * 8 + 4
  const chunksLength = chunks.reduce((sum, chunk) => sum + 16 + chunk.compressed.byteLength, 0)
  const out = new Uint8Array(headerLength + chunksLength)
  const view = new DataView(out.buffer)
  let offset = 0
  out.set(ascii(MAGIC), offset)
  offset += 4
  view.setUint8(offset, VERSION)
  offset += 1
  view.setUint8(offset, CODEC_ZSTD)
  offset += 1
  view.setUint8(offset, array.shape.length)
  offset += 1
  view.setUint8(offset, dtypeBytes.length)
  offset += 1
  out.set(dtypeBytes, offset)
  offset += dtypeBytes.length
  for (const dim of array.shape) {
    view.setBigInt64(offset, BigInt(dim), true)
    offset += 8
  }
  view.setUint32(offset, chunks.length, true)
  offset += 4
  for (const chunk of chunks) {
    view.setBigUint64(offset, BigInt(chunk.uncompressedLength), true)
    offset += 8
    view.setBigUint64(offset, BigInt(chunk.compressed.byteLength), true)
    offset += 8
    out.set(chunk.compressed, offset)
    offset += chunk.compressed.byteLength
  }
  return out
}

export async function unpackNniaArray(buffer: ArrayBuffer, codec: Blosc2Codec): Promise<NniaArray> {
  const bytes = new Uint8Array(buffer)
  if (bytes.byteLength < 8) {
    throw new Error('Packed nnInteractive array is too short.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic = text(bytes.subarray(0, 4))
  if (magic !== MAGIC) {
    throw new Error(`Bad nnInteractive array magic: ${magic}`)
  }
  const version = view.getUint8(4)
  if (version !== VERSION) {
    throw new Error(`Unsupported nnInteractive array version: ${version}`)
  }
  const codecId = view.getUint8(5)
  if (codecId !== CODEC_ZSTD && codecId !== 2) {
    throw new Error(`Unsupported nnInteractive array codec id: ${codecId}`)
  }
  const ndim = view.getUint8(6)
  const dtypeLength = view.getUint8(7)
  let offset = 8
  const dtype = text(bytes.subarray(offset, offset + dtypeLength))
  offset += dtypeLength
  const shape: number[] = []
  for (let axis = 0; axis < ndim; axis += 1) {
    shape.push(Number(view.getBigInt64(offset, true)))
    offset += 8
  }
  const chunkCount = view.getUint32(offset, true)
  offset += 4
  const totalBytes = shape.reduce((product, dim) => product * dim, 1) * dtypeBytes(dtype)
  const raw = new Uint8Array(totalBytes)
  let written = 0
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const uncompressedLength = Number(view.getBigUint64(offset, true))
    offset += 8
    const compressedLength = Number(view.getBigUint64(offset, true))
    offset += 8
    const compressed = bytes.subarray(offset, offset + compressedLength)
    offset += compressedLength
    const chunk = await codec.decompress(compressed, uncompressedLength)
    if (chunk.byteLength !== uncompressedLength) {
      throw new Error(`Decoded chunk size mismatch: expected ${uncompressedLength}, got ${chunk.byteLength}.`)
    }
    raw.set(chunk, written)
    written += chunk.byteLength
  }
  if (written !== raw.byteLength) {
    throw new Error(`Decoded payload size mismatch: expected ${raw.byteLength}, got ${written}.`)
  }
  return {
    shape,
    dtype,
    data: typedArrayFromBytes(dtype, raw),
  }
}

export function blosc2UnavailableMessage(): string {
  return 'Browser Blosc2 codec is unavailable. Provide globalThis.nnInteractiveBlosc2Codec or use a same-origin proxy that translates nnInteractive payloads.'
}

export function dtypeName(data: NniaTypedArray): string {
  if (data instanceof Uint8Array) {
    return 'uint8'
  }
  if (data instanceof Int8Array) {
    return 'int8'
  }
  if (data instanceof Uint16Array) {
    return 'uint16'
  }
  if (data instanceof Int16Array) {
    return 'int16'
  }
  if (data instanceof Uint32Array) {
    return 'uint32'
  }
  if (data instanceof Int32Array) {
    return 'int32'
  }
  if (data instanceof Float32Array) {
    return 'float32'
  }
  return 'float64'
}

function dtypeBytes(dtype: string): number {
  switch (dtype) {
    case 'uint8':
    case 'int8':
      return 1
    case 'uint16':
    case 'int16':
      return 2
    case 'uint32':
    case 'int32':
    case 'float32':
      return 4
    case 'float64':
      return 8
    default:
      throw new Error(`Unsupported nnInteractive dtype: ${dtype}`)
  }
}

export function typedArrayFromBytes(dtype: string, bytes: Uint8Array): NniaTypedArray {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  switch (dtype) {
    case 'uint8':
      return new Uint8Array(buffer)
    case 'int8':
      return new Int8Array(buffer)
    case 'uint16':
      return new Uint16Array(buffer)
    case 'int16':
      return new Int16Array(buffer)
    case 'uint32':
      return new Uint32Array(buffer)
    case 'int32':
      return new Int32Array(buffer)
    case 'float32':
      return new Float32Array(buffer)
    case 'float64':
      return new Float64Array(buffer)
    default:
      throw new Error(`Unsupported nnInteractive dtype: ${dtype}`)
  }
}

export function bytesOf(data: NniaTypedArray): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function text(value: Uint8Array): string {
  return new TextDecoder('ascii').decode(value)
}

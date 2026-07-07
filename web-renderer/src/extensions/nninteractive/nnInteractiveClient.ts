import {
  bytesOf,
  createBrowserBlosc2Codec,
  dtypeName,
  packNniaArray,
  typedArrayFromBytes,
  unpackNniaArray,
} from './nniaSerialization'
import type { Blosc2Codec, NniaArray } from './nniaSerialization'

const META_HEADER = 'X-Meta'
const LEASE_HEADER = 'X-Lease-Token'

export type NnInteractiveCapabilities = {
  readonly supported_interactions?: Record<string, unknown>
  readonly preferred_scribble_thickness?: number | readonly number[]
  readonly supports_undo?: boolean
  readonly license?: string | null
}

export type NnInteractiveBbox = [[number, number], [number, number], [number, number]]

export type PredictionPatch = {
  readonly bbox: NnInteractiveBbox
  readonly shape: [number, number, number]
  readonly data: ArrayLike<number>
}

export type ScribbleMask = {
  readonly bbox: NnInteractiveBbox
  readonly shape: [number, number, number]
  readonly data: Uint8Array
}

export type InitialSegmentationMask = {
  readonly shape: [number, number, number]
  readonly data: Uint8Array
}

export class NnInteractiveHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export class NnInteractiveClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly codec: Blosc2Codec
  private readonly useRawProxyWire: boolean
  private leaseToken: string | null = null
  private heartbeatId: number | null = null

  constructor(options: { serverUrl: string; apiKey?: string; codec?: Blosc2Codec; useRawProxyWire?: boolean }) {
    this.baseUrl = options.serverUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey ?? ''
    this.codec = options.codec ?? createBrowserBlosc2Codec()
    this.useRawProxyWire = options.useRawProxyWire ?? shouldUseRawProxyWire(options.serverUrl)
  }

  get codecAvailable(): boolean {
    return this.useRawProxyWire || this.codec.available
  }

  async verifyTransport(): Promise<void> {
    if (!this.useRawProxyWire) {
      if (!this.codec.available) {
        throw new Error('Browser Blosc2 codec is unavailable for direct nnInteractive server access. Use the same-origin raw proxy or provide globalThis.nnInteractiveBlosc2Codec.')
      }
      return
    }
    let info: { features?: unknown } | null = null
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/__raw_proxy_info`, {
        method: 'GET',
        headers: this.headers(),
      }, 5000)
      if (response.ok) {
        info = await response.json() as { features?: unknown }
      }
    } catch {
      // Fall through to the actionable error below.
    }
    const features = Array.isArray(info?.features) ? info.features : []
    if (!features.includes('raw_mask_interactions') || !features.includes('raw_initial_segmentation')) {
      throw new Error('The configured nnInteractive endpoint is not the updated raw proxy. Restart npm run nninteractive:proxy or nninteractive-proxy/dist/win-x64/nninteractive-proxy.exe, and keep the panel Server value as /nninteractive.')
    }
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/healthz`, { method: 'GET' }, 5000)
      return response.ok
    } catch {
      return false
    }
  }

  async claim(): Promise<NnInteractiveCapabilities> {
    const claim = await this.postJson<{ lease_token: string; liveness_timeout_seconds?: number }>('/claim', {})
    this.leaseToken = claim.lease_token
    const heartbeatSeconds = Math.max(5, (claim.liveness_timeout_seconds ?? 60) / 2)
    this.heartbeatId = window.setInterval(() => {
      void this.postJson('/heartbeat', {}).catch(() => undefined)
    }, heartbeatSeconds * 1000)
    return this.getJson<NnInteractiveCapabilities>('/capabilities')
  }

  async setImage(image: NniaArray): Promise<void> {
    if (this.useRawProxyWire) {
      await this.postBinary('/set_image', {
        image_properties: {},
        shape: image.shape,
        dtype: dtypeName(image.data),
        encoding: 'raw-c-order',
      }, bytesOf(image.data), 600000)
      return
    }
    const body = await packNniaArray(image, this.codec)
    await this.postBinary('/set_image', { image_properties: {} }, body, 600000)
  }

  async setTargetBuffer(shape: [number, number, number], dtype = 'uint8'): Promise<void> {
    await this.postJson('/set_target_buffer', { shape, dtype })
  }

  async setInitialSegmentation(mask: InitialSegmentationMask, runPrediction = false): Promise<PredictionPatch | null> {
    const meta = {
      run_prediction: runPrediction,
      shape: mask.shape,
      dtype: 'uint8',
      encoding: 'raw-c-order',
    }
    if (this.useRawProxyWire) {
      const response = await this.postBinary('/add_initial_seg_interaction', meta, mask.data, 600000)
      return this.predictionPatchFromResponse(response)
    }

    const body = await packNniaArray({
      shape: mask.shape,
      dtype: 'uint8',
      data: mask.data,
    }, this.codec, 'nofilter')
    const response = await this.postBinary('/add_initial_seg_interaction', {
      run_prediction: runPrediction,
    }, body, 600000)
    return this.predictionPatchFromResponse(response)
  }

  async addPoint(
    coordinates: [number, number, number],
    includeInteraction: boolean,
  ): Promise<PredictionPatch | null> {
    const response = await this.postJsonResponse('/add_point_interaction', {
      coordinates,
      include_interaction: includeInteraction,
      run_prediction: true,
    })
    return this.predictionPatchFromResponse(response)
  }

  async addScribble(mask: ScribbleMask, includeInteraction: boolean): Promise<PredictionPatch | null> {
    const meta = {
      include_interaction: includeInteraction,
      run_prediction: true,
      interaction_bbox: mask.bbox,
    }
    if (this.useRawProxyWire) {
      const response = await this.postBinary('/add_scribble_interaction', {
        ...meta,
        shape: mask.shape,
        dtype: 'uint8',
        encoding: 'raw-c-order',
      }, mask.data, 600000)
      return this.predictionPatchFromResponse(response)
    }

    const body = await packNniaArray({
      shape: mask.shape,
      dtype: 'uint8',
      data: mask.data,
    }, this.codec, 'nofilter')
    const response = await this.postBinary('/add_scribble_interaction', meta, body, 600000)
    return this.predictionPatchFromResponse(response)
  }

  async resetInteractions(): Promise<void> {
    await this.postJson('/reset_interactions', {})
  }

  async undo(): Promise<PredictionPatch | null> {
    const response = await this.postJsonResponse('/undo', {})
    return this.predictionPatchFromResponse(response)
  }

  async close(): Promise<void> {
    if (this.heartbeatId !== null) {
      window.clearInterval(this.heartbeatId)
      this.heartbeatId = null
    }
    if (!this.leaseToken) {
      return
    }
    try {
      await this.postJson('/release', {})
    } catch {
      // Best effort release; server may already be gone or the lease may have expired.
    }
    this.leaseToken = null
  }

  private async predictionPatchFromResponse(response: Response): Promise<PredictionPatch | null> {
    const metaRaw = response.headers.get(META_HEADER)
    if (!metaRaw) {
      return null
    }
    const meta = JSON.parse(metaRaw) as {
      ran_prediction?: boolean
      bbox?: NnInteractiveBbox | null
      shape?: [number, number, number]
    }
    if (!meta.ran_prediction || !meta.bbox || !meta.shape || response.headers.get('content-length') === '0') {
      return null
    }
    const body = await response.arrayBuffer()
    if (body.byteLength === 0) {
      return null
    }
    if (this.useRawProxyWire) {
      if (!meta.shape) {
        return null
      }
      const dtype = typeof (meta as { dtype?: unknown }).dtype === 'string'
        ? (meta as { dtype: string }).dtype
        : 'uint8'
      return {
        bbox: meta.bbox,
        shape: meta.shape,
        data: typedArrayFromBytes(dtype, new Uint8Array(body)),
      }
    }
    const decoded = await unpackNniaArray(body, this.codec)
    return {
      bbox: meta.bbox,
      shape: meta.shape,
      data: decoded.data,
    }
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers(),
    })
    await raiseForStatus(response)
    return response.json() as Promise<T>
  }

  private async postJson<T>(path: string, payload: unknown): Promise<T> {
    const response = await this.postJsonResponse(path, payload)
    return response.json() as Promise<T>
  }

  private async postJsonResponse(path: string, payload: unknown): Promise<Response> {
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    await raiseForStatus(response)
    return response
  }

  private async postBinary(path: string, meta: unknown, body: Uint8Array, timeoutMs = 120000): Promise<Response> {
    const payload = new ArrayBuffer(body.byteLength)
    new Uint8Array(payload).set(body)
    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        [META_HEADER]: JSON.stringify(meta),
        'Content-Type': 'application/octet-stream',
      },
      body: payload,
    }, timeoutMs)
    await raiseForStatus(response)
    return response
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    if (this.leaseToken) {
      headers[LEASE_HEADER] = this.leaseToken
    }
    return headers
  }
}

function shouldUseRawProxyWire(serverUrl: string): boolean {
  return serverUrl.startsWith('/')
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function raiseForStatus(response: Response): Promise<void> {
  if (response.ok) {
    return
  }
  let detail = response.statusText
  try {
    const body = await response.json() as { detail?: string }
    detail = body.detail ?? detail
  } catch {
    // Keep statusText.
  }
  throw new NnInteractiveHttpError(response.status, detail)
}

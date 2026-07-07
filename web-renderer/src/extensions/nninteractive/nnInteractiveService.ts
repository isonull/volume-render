import type { Vec3n } from 'wgpu-matrix'
import type { ScalarVolume, ScalarVoxelArray } from '../../volume'
import { NnInteractiveClient } from './nnInteractiveClient'
import type { InitialSegmentationMask, NnInteractiveCapabilities, PredictionPatch, ScribbleMask } from './nnInteractiveClient'
import type { NniaArray, NniaTypedArray } from './nniaSerialization'
import { blosc2UnavailableMessage } from './nniaSerialization'

export const NNINTERACTIVE_SERVICE_ID = 'nninteractive.service'

export type NnInteractiveStatus =
  | 'idle'
  | 'testing'
  | 'starting'
  | 'ready'
  | 'predicting'
  | 'error'
  | 'unavailable'

export interface NnInteractiveState {
  readonly status: NnInteractiveStatus
  readonly serverUrl: string
  readonly apiKey: string
  readonly activeVolumeId: string | null
  readonly segmentationId: string | null
  readonly targetSegmentLabel: number | null
  readonly message: string
  readonly positivePoints: number
  readonly negativePoints: number
  readonly positiveScribbles: number
  readonly negativeScribbles: number
  readonly supportsScribble: boolean
  readonly preferredScribbleThickness: Vec3n
  readonly supportsUndo: boolean
  readonly codecAvailable: boolean
}

type StateListener = () => void

export class NnInteractiveService {
  private state: NnInteractiveState = {
    status: 'idle',
    serverUrl: '/nninteractive',
    apiKey: '',
    activeVolumeId: null,
    segmentationId: null,
    targetSegmentLabel: null,
    message: 'Not connected.',
    positivePoints: 0,
    negativePoints: 0,
    positiveScribbles: 0,
    negativeScribbles: 0,
    supportsScribble: false,
    preferredScribbleThickness: [2, 2, 2],
    supportsUndo: false,
    codecAvailable: isTransportAvailable('/nninteractive'),
  }
  private client: NnInteractiveClient | null = null
  private capabilities: NnInteractiveCapabilities | null = null
  private readonly listeners = new Set<StateListener>()

  getState(): NnInteractiveState {
    return this.state
  }

  subscribe(listener: StateListener): { dispose(): void } {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }

  setConfig(config: { serverUrl?: string; apiKey?: string }): void {
    this.setState({
      serverUrl: config.serverUrl ?? this.state.serverUrl,
      apiKey: config.apiKey ?? this.state.apiKey,
    })
  }

  async testConnection(): Promise<boolean> {
    this.setState({ status: 'testing', message: 'Testing nnInteractive server...' })
    const client = this.createClient()
    const ok = await client.ping()
    const codecAvailable = client.codecAvailable
    let transportMessage: string | null = null
    if (ok && codecAvailable) {
      try {
        await client.verifyTransport()
      } catch (error) {
        transportMessage = errorMessage(error)
      }
    }
    this.setState({
      status: ok ? (codecAvailable && !transportMessage ? 'idle' : 'unavailable') : 'error',
      message: ok
        ? (codecAvailable && !transportMessage ? 'Server is reachable.' : transportMessage ?? `Server is reachable. ${blosc2UnavailableMessage()}`)
        : 'Server is not reachable.',
      codecAvailable: codecAvailable && !transportMessage,
    })
    return ok && codecAvailable && !transportMessage
  }

  setTarget(target: { segmentationId: string; segmentLabel: number } | null): void {
    this.setState({
      segmentationId: target?.segmentationId ?? null,
      targetSegmentLabel: target?.segmentLabel ?? null,
    })
  }

  async startSession(
    volume: ScalarVolume,
    target?: { segmentationId: string; segmentLabel: number; initialSegmentation?: InitialSegmentationMask | null },
  ): Promise<string> {
    const client = this.createClient()
    if (!client.codecAvailable) {
      const message = blosc2UnavailableMessage()
      this.setState({
        status: 'unavailable',
        message,
        activeVolumeId: null,
        segmentationId: null,
        targetSegmentLabel: null,
        codecAvailable: false,
      })
      throw new Error(message)
    }
    try {
      await client.verifyTransport()
    } catch (error) {
      const message = errorMessage(error)
      this.setState({
        status: 'unavailable',
        message,
        activeVolumeId: null,
        segmentationId: null,
        targetSegmentLabel: null,
        codecAvailable: false,
      })
      throw new Error(message)
    }
    await this.release()
    const segmentationId = target?.segmentationId ?? nnInteractiveSegmentationId(volume.id)
    const targetSegmentLabel = target?.segmentLabel ?? 1
    this.client = client
    this.setState({
      status: 'starting',
      activeVolumeId: volume.id,
      segmentationId,
      targetSegmentLabel,
      message: `Starting nnInteractive session for ${volume.source?.uri ?? volume.id}...`,
      positivePoints: 0,
      negativePoints: 0,
      positiveScribbles: 0,
      negativeScribbles: 0,
      codecAvailable: client.codecAvailable,
    })
    try {
      this.capabilities = await client.claim()
      await client.setImage(volumeToNniaImage(volume))
      await client.setTargetBuffer([volume.shape[0], volume.shape[1], volume.shape[2]], 'uint8')
      if (target?.initialSegmentation) {
        this.setState({ message: 'Initializing nnInteractive from existing segment...' })
        await client.setInitialSegmentation(target.initialSegmentation, false)
      }
      const supportsScribble = Boolean(this.capabilities.supported_interactions?.scribble)
      this.setState({
        status: 'ready',
        message: target?.initialSegmentation
          ? 'nnInteractive session ready with existing segment history.'
          : 'nnInteractive session ready.',
        supportsUndo: Boolean(this.capabilities.supports_undo),
        supportsScribble,
        preferredScribbleThickness: normalizeScribbleThickness(this.capabilities.preferred_scribble_thickness),
      })
      return segmentationId
    } catch (error) {
      await client.close()
      this.client = null
      this.setState({
        status: client.codecAvailable ? 'error' : 'unavailable',
        message: errorMessage(error),
        activeVolumeId: null,
        segmentationId: null,
        targetSegmentLabel: null,
        codecAvailable: client.codecAvailable,
      })
      throw error
    }
  }

  async addPoint(voxel: Vec3n, includeInteraction: boolean): Promise<PredictionPatch | null> {
    const client = this.requireClient()
    this.setState({
      status: 'predicting',
      message: includeInteraction ? 'Running positive point prediction...' : 'Running negative point prediction...',
      codecAvailable: client.codecAvailable,
    })
    try {
      const patch = await client.addPoint([voxel[0], voxel[1], voxel[2]], includeInteraction)
      this.setState({
        status: 'ready',
        message: patch ? 'Prediction applied.' : 'Prediction completed with no changed region.',
        positivePoints: this.state.positivePoints + (includeInteraction ? 1 : 0),
        negativePoints: this.state.negativePoints + (includeInteraction ? 0 : 1),
      })
      return patch
    } catch (error) {
      this.setState({ status: 'error', message: errorMessage(error) })
      throw error
    }
  }

  async addScribble(mask: ScribbleMask, includeInteraction: boolean): Promise<PredictionPatch | null> {
    const client = this.requireClient()
    if (!this.state.supportsScribble) {
      throw new Error('The current nnInteractive server/model does not advertise scribble support.')
    }
    this.setState({
      status: 'predicting',
      message: includeInteraction ? 'Running positive scribble prediction...' : 'Running negative scribble prediction...',
      codecAvailable: client.codecAvailable,
    })
    try {
      const patch = await client.addScribble(mask, includeInteraction)
      this.setState({
        status: 'ready',
        message: patch ? 'Scribble prediction applied.' : 'Scribble prediction completed with no changed region.',
        positiveScribbles: this.state.positiveScribbles + (includeInteraction ? 1 : 0),
        negativeScribbles: this.state.negativeScribbles + (includeInteraction ? 0 : 1),
      })
      return patch
    } catch (error) {
      this.setState({ status: 'error', message: errorMessage(error) })
      throw error
    }
  }

  async resetInteractions(): Promise<void> {
    const client = this.requireClient()
    this.setState({ status: 'predicting', message: 'Resetting nnInteractive interactions...' })
    await client.resetInteractions()
    this.setState({
      status: 'ready',
      message: 'Interactions reset.',
      positivePoints: 0,
      negativePoints: 0,
      positiveScribbles: 0,
      negativeScribbles: 0,
    })
  }

  async undo(): Promise<PredictionPatch | null> {
    const client = this.requireClient()
    this.setState({ status: 'predicting', message: 'Undoing last nnInteractive interaction...' })
    const patch = await client.undo()
    this.setState({
      status: 'ready',
      message: patch ? 'Undo applied.' : 'Nothing to undo.',
    })
    return patch
  }

  async release(): Promise<void> {
    const client = this.client
    this.client = null
    if (client) {
      await client.close()
    }
    this.capabilities = null
    this.setState({
      status: 'idle',
      activeVolumeId: null,
      segmentationId: null,
      targetSegmentLabel: null,
      message: 'Session released.',
      positivePoints: 0,
      negativePoints: 0,
      positiveScribbles: 0,
      negativeScribbles: 0,
      supportsScribble: false,
      preferredScribbleThickness: [2, 2, 2],
      supportsUndo: false,
    })
  }

  isBusy(): boolean {
    return this.state.status === 'testing' || this.state.status === 'starting' || this.state.status === 'predicting'
  }

  private createClient(): NnInteractiveClient {
    return new NnInteractiveClient({
      serverUrl: this.state.serverUrl,
      apiKey: this.state.apiKey,
    })
  }

  private requireClient(): NnInteractiveClient {
    if (!this.client || this.state.status === 'idle') {
      throw new Error('Start an nnInteractive session before adding points.')
    }
    return this.client
  }

  private setState(next: Partial<NnInteractiveState>): void {
    const serverUrl = next.serverUrl ?? this.state.serverUrl
    const codecAvailable = next.codecAvailable ?? isTransportAvailable(serverUrl)
    this.state = {
      ...this.state,
      ...next,
      codecAvailable,
    }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export function nnInteractiveSegmentationId(volumeId: string): string {
  return `${volumeId}-nninteractive`
}

function volumeToNniaImage(volume: ScalarVolume): NniaArray {
  const [nx, ny, nz] = volume.shape
  const data = createLike(volume.data, nx * ny * nz)
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let z = 0; z < nz; z += 1) {
        data[(x * ny + y) * nz + z] = volume.data[x + nx * (y + ny * z)]
      }
    }
  }
  return {
    shape: [1, nx, ny, nz],
    dtype: dtypeName(data),
    data: withLeadingChannel(data),
  }
}

function withLeadingChannel(data: NniaTypedArray): NniaTypedArray {
  return data
}

function createLike(source: ScalarVoxelArray, length: number): NniaTypedArray {
  if (source instanceof Uint8Array) {
    return new Uint8Array(length)
  }
  if (source instanceof Int8Array) {
    return new Int8Array(length)
  }
  if (source instanceof Uint16Array) {
    return new Uint16Array(length)
  }
  if (source instanceof Int16Array) {
    return new Int16Array(length)
  }
  if (source instanceof Uint32Array) {
    return new Uint32Array(length)
  }
  if (source instanceof Int32Array) {
    return new Int32Array(length)
  }
  if (source instanceof Float32Array) {
    return new Float32Array(length)
  }
  return new Float64Array(length)
}

function dtypeName(data: NniaTypedArray): string {
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

function normalizeScribbleThickness(value: NnInteractiveCapabilities['preferred_scribble_thickness']): Vec3n {
  if (typeof value === 'number') {
    const thickness = normalizeThicknessValue(value)
    return [thickness, thickness, thickness]
  }
  if (Array.isArray(value)) {
    return [
      normalizeThicknessValue(value[0]),
      normalizeThicknessValue(value[1]),
      normalizeThicknessValue(value[2]),
    ]
  }
  return [2, 2, 2]
}

function normalizeThicknessValue(value: unknown): number {
  const thickness = Number(value)
  return Number.isFinite(thickness) && thickness > 0 ? thickness : 2
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTransportAvailable(serverUrl: string): boolean {
  return serverUrl.startsWith('/') || Boolean(globalThis.nnInteractiveBlosc2Codec)
}

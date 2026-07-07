import type { LabelmapSegmentationData } from '../segmentation'
import type { ScalarVolume } from '../volume'

export interface Disposable {
  dispose(): void
}

export type RuntimeEventMap = {
  'app.dispose': undefined
  'scene.changed': { reason: string }
  'volume.removed': { volumeId: string }
  'segmentation.removed': { segmentationId: string }
  'activeVolume.changed': { volume: ScalarVolume | null }
  'activeSegmentation.changed': { segmentation: LabelmapSegmentationData | null }
  'interactionMode.changed': { modeId: string }
}

export type RuntimeEventType = keyof RuntimeEventMap

type RuntimeEventHandler<TType extends RuntimeEventType> = (payload: RuntimeEventMap[TType]) => void

export class RuntimeEventBus {
  private readonly handlers = new Map<RuntimeEventType, Set<(payload: unknown) => void>>()

  on<TType extends RuntimeEventType>(type: TType, handler: RuntimeEventHandler<TType>): Disposable {
    let handlers = this.handlers.get(type)
    if (!handlers) {
      handlers = new Set()
      this.handlers.set(type, handlers)
    }
    handlers.add(handler as (payload: unknown) => void)
    return {
      dispose: () => {
        handlers?.delete(handler as (payload: unknown) => void)
      },
    }
  }

  emit<TType extends RuntimeEventType>(type: TType, payload: RuntimeEventMap[TType]): void {
    for (const handler of this.handlers.get(type) ?? []) {
      handler(payload)
    }
  }

  clear(): void {
    this.handlers.clear()
  }
}

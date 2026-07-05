import { Viewport } from '../viewport'
import type { MprRenderState } from '../mpr/mprState'

export class ViewportService {
  readonly viewports = new Map<string, Viewport>()
  readonly renderStates = new Map<string, MprRenderState>()
  private readonly device: GPUDevice
  private readonly format: GPUTextureFormat

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device
    this.format = format
  }

  createViewport(canvas: HTMLCanvasElement, id: string): Viewport {
    if (this.viewports.has(id)) {
      throw new Error(`Viewport already exists: ${id}`)
    }
    const viewport = new Viewport(id, canvas, this.device, this.format)
    this.viewports.set(id, viewport)
    return viewport
  }

  destroyViewport(viewportId: string): void {
    this.viewports.delete(viewportId)
    this.renderStates.delete(viewportId)
  }

  hasViewport(viewportId: string): boolean {
    return this.viewports.has(viewportId)
  }

  getViewport(viewportId: string): Viewport | undefined {
    return this.viewports.get(viewportId)
  }

  getRenderState(viewportId: string): MprRenderState | undefined {
    return this.renderStates.get(viewportId)
  }

  setRenderState(viewportId: string, state: MprRenderState): void {
    if (!this.viewports.has(viewportId)) {
      throw new Error(`Viewport not found: ${viewportId}`)
    }
    this.renderStates.set(viewportId, state)
  }

  clearRenderStates(): void {
    this.renderStates.clear()
  }

  clearViewports(): void {
    for (const viewport of this.viewports.values()) {
      viewport.clear()
    }
  }

  destroy(): void {
    this.renderStates.clear()
    this.viewports.clear()
  }
}

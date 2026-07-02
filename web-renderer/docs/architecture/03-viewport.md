# Section 3. Viewport

## Section 3.1 Viewport

`Viewport` means where rendering happens. It owns the canvas-backed render
target, not the medical data and not renderer-specific camera or display state.

```ts
class Viewport {
  readonly id: string
  readonly canvas: HTMLCanvasElement
  readonly context: GPUCanvasContext
  readonly format: GPUTextureFormat
  width: number
  height: number
  pixelRatio: number

  resize(width: number, height: number, pixelRatio: number): void
  getCurrentTextureView(): GPUTextureView
  clientToCanvas(point: Vec2): Vec2
  canvasToClient(point: Vec2): Vec2
}
```

Viewport owns render target state:

```text
canvas/context
size
pixel ratio
surface format
current output texture
optional viewport rectangle for tiled layouts
client-to-canvas coordinate conversion
```

Viewport should not own medical data, `Scene`, `PreparedScene`, or
renderer-specific `RenderState`; the same viewport can be reused with different
renderers and different render states.

import './style.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { mat4 } from 'wgpu-matrix'
import { Engine } from './engine'
import { cloneMprState, createInitialMprState, valueRange } from './mpr/mprState'
import type { MprOrientation, MprRenderState } from './mpr/mprState'
import type { Vec2 } from './types'
import type { ScalarVolume, Vec3 } from './volume'

const VIEWPORTS: { id: MprOrientation; label: string }[] = [
  { id: 'axial', label: 'Axial' },
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' },
]

type DragState = {
  viewportId: MprOrientation
  previous: Vec2
  mode: 'pan' | 'window'
}

type VolumeInfo = {
  volume: string
  source: string
  intensity?: string
  centerIndex?: string
}

type CursorInfo = {
  viewport: string
  voxel: string
  world: string
  inBounds: boolean
}

function MprApp() {
  const canvasRefs = useRef(new Map<MprOrientation, HTMLCanvasElement>())
  const engineRef = useRef<Engine | null>(null)
  const activeVolumeRef = useRef<ScalarVolume | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const windowMinRef = useRef('0')
  const windowMaxRef = useRef('0')

  const [status, setStatus] = useState('Initializing WebGPU...')
  const [controlsEnabled, setControlsEnabled] = useState(false)
  const [windowMin, setWindowMinState] = useState('0')
  const [windowMax, setWindowMaxState] = useState('0')
  const [volumeInfo, setVolumeInfo] = useState<VolumeInfo>({
    volume: 'No NIfTI loaded',
    source: 'Waiting for .nii or .nii.gz',
  })
  const [cursorInfo, setCursorInfo] = useState<CursorInfo | null>(null)

  const setWindowMin = useCallback((value: string) => {
    windowMinRef.current = value
    setWindowMinState(value)
  }, [])

  const setWindowMax = useCallback((value: string) => {
    windowMaxRef.current = value
    setWindowMaxState(value)
  }, [])

  const setCanvasRef = useCallback((id: MprOrientation) => (canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      canvasRefs.current.set(id, canvas)
    } else {
      canvasRefs.current.delete(id)
    }
  }, [])

  const currentState = useCallback((viewportId: MprOrientation): MprRenderState | null => {
    return engineRef.current?.renderStates.get(viewportId) ?? null
  }, [])

  const resetView = useCallback((viewportId: MprOrientation) => {
    const engine = engineRef.current
    const activeVolume = activeVolumeRef.current
    if (!engine || !activeVolume) {
      return
    }
    const viewport = engine.viewports.get(viewportId)
    if (!viewport) {
      return
    }
    viewport.resizeFromClient()
    const canvasPixels = Math.min(viewport.width, viewport.height)
    const state = createInitialMprState(activeVolume, viewportId, canvasPixels)
    const min = Number.parseFloat(windowMinRef.current)
    const max = Number.parseFloat(windowMaxRef.current)
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      state.image.windowMin = min
      state.image.windowMax = max
    }
    engine.setRenderState(viewportId, state)
  }, [])

  const resetViews = useCallback(() => {
    if (!engineRef.current || !activeVolumeRef.current) {
      return
    }
    for (const viewport of VIEWPORTS) {
      resetView(viewport.id)
    }
  }, [resetView])

  const applyWindowToAllViews = useCallback(() => {
    const engine = engineRef.current
    if (!engine) {
      return
    }
    const min = Number.parseFloat(windowMinRef.current)
    const max = Number.parseFloat(windowMaxRef.current)
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
      setStatus('Window max must be greater than window min.')
      return
    }
    for (const [viewportId, state] of engine.renderStates) {
      const next = cloneMprState(state)
      next.image.windowMin = min
      next.image.windowMax = max
      engine.setRenderState(viewportId, next)
    }
  }, [])

  const updateCursorInfo = useCallback((viewportId: MprOrientation, clientPoint: Vec2) => {
    const engine = engineRef.current
    const activeVolume = activeVolumeRef.current
    const state = currentState(viewportId)
    const viewport = engine?.viewports.get(viewportId)
    if (!engine || !activeVolume || !state || !viewport) {
      setCursorInfo(null)
      return
    }

    viewport.resizeFromClient()
    const canvasPoint = viewport.clientToCanvas(clientPoint)
    const world = canvasToWorld(canvasPoint, viewport.width, viewport.height, state)
    const index = worldToIndex(world, activeVolume)
    const voxel: Vec3 = [
      Math.round(index[0]),
      Math.round(index[1]),
      Math.round(index[2]),
    ]
    setCursorInfo({
      viewport: VIEWPORTS.find(item => item.id === viewportId)?.label ?? viewportId,
      voxel: voxel.map(value => String(value)).join(', '),
      world: world.map(formatCoordinate).join(', '),
      inBounds: isVoxelInBounds(voxel, activeVolume),
    })
  }, [currentState])

  const pan = useCallback((viewportId: MprOrientation, delta: Vec2) => {
    const state = currentState(viewportId)
    const engine = engineRef.current
    if (!state || !engine) {
      return
    }
    const next = cloneMprState(state)
    next.plane.origin = add(
      next.plane.origin,
      addScaled(next.plane.right, -delta[0] * next.plane.pixelSize),
    )
    next.plane.origin = add(
      next.plane.origin,
      addScaled(next.plane.up, delta[1] * next.plane.pixelSize),
    )
    engine.setRenderState(viewportId, next)
  }, [currentState])

  const scroll = useCallback((viewportId: MprOrientation, deltaY: number) => {
    const state = currentState(viewportId)
    const engine = engineRef.current
    const activeVolume = activeVolumeRef.current
    const direction = Math.sign(deltaY)
    if (!state || !engine || !activeVolume || direction === 0) {
      return
    }
    const next = cloneMprState(state)
    const normal = normalize(cross(next.plane.right, next.plane.up))
    next.plane.origin = add(next.plane.origin, addScaled(normal, direction * sliceStepSize(normal, activeVolume)))
    engine.setRenderState(viewportId, next)
  }, [currentState])

  const zoom = useCallback((viewportId: MprOrientation, deltaY: number) => {
    const state = currentState(viewportId)
    const engine = engineRef.current
    if (!state || !engine) {
      return
    }
    const next = cloneMprState(state)
    next.plane.pixelSize = Math.max(1e-6, next.plane.pixelSize * Math.exp(deltaY * 0.001))
    engine.setRenderState(viewportId, next)
  }, [currentState])

  const updateWindow = useCallback((viewportId: MprOrientation, delta: Vec2) => {
    const state = currentState(viewportId)
    const engine = engineRef.current
    if (!state || !engine) {
      return
    }
    const next = cloneMprState(state)
    const width = Math.max(1e-6, next.image.windowMax - next.image.windowMin)
    const center = (next.image.windowMax + next.image.windowMin) * 0.5
    const nextCenter = center + delta[0] * width * 0.005
    const nextWidth = Math.max(1e-6, width * Math.exp(delta[1] * 0.005))
    next.image.windowMin = nextCenter - nextWidth * 0.5
    next.image.windowMax = nextCenter + nextWidth * 0.5
    engine.setRenderState(viewportId, next)
    setWindowMin(formatInput(next.image.windowMin))
    setWindowMax(formatInput(next.image.windowMax))
  }, [currentState, setWindowMax, setWindowMin])

  const loadSelectedFile = useCallback(async (file: File | undefined) => {
    const engine = engineRef.current
    if (!file || !engine) {
      return
    }

    try {
      setStatus(`Loading ${file.name}...`)
      const { loadNiftiFile, scalarVolumeFromNiftiFile } = await import('./io/nifti')
      const volume = scalarVolumeFromNiftiFile(await loadNiftiFile(file), file.name)
      activeVolumeRef.current = volume
      setCursorInfo(null)
      engine.loadVolume(volume)
      const [min, max] = valueRange(volume)
      const range = max - min
      setWindowMin(formatInput(min + range * 0.05))
      setWindowMax(formatInput(max))
      setVolumeInfo(createVolumeInfo(volume, file.name))
      setControlsEnabled(true)
      for (const viewport of VIEWPORTS) {
        resetView(viewport.id)
      }
      setStatus(`${file.name} loaded.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }, [resetView, setWindowMax, setWindowMin])

  useEffect(() => {
    let cancelled = false
    let engine: Engine | null = null

    async function boot(): Promise<void> {
      try {
        engine = await Engine.create()
        if (cancelled) {
          engine.destroy()
          return
        }
        for (const viewport of VIEWPORTS) {
          const canvas = canvasRefs.current.get(viewport.id)
          if (!canvas) {
            throw new Error(`Missing ${viewport.label} canvas.`)
          }
          engine.createViewport(canvas, viewport.id)
        }
        engineRef.current = engine
        setStatus('WebGPU ready. Load a NIfTI scalar volume.')
      } catch (error) {
        setStatus(errorMessage(error))
      }
    }

    void boot()

    return () => {
      cancelled = true
      engineRef.current = null
      engine?.destroy()
    }
  }, [])

  useEffect(() => {
    function handleResize(): void {
      const engine = engineRef.current
      if (!engine) {
        return
      }
      for (const viewportId of engine.renderStates.keys()) {
        engine.requestRender(viewportId)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <main className="mpr-shell">
      <section className="mpr-grid" aria-label="Three direction MPR viewports">
        {VIEWPORTS.map(viewport => (
          <section className="mpr-viewport" data-viewport={viewport.id} key={viewport.id}>
            <canvas
              ref={setCanvasRef(viewport.id)}
              aria-label={`${viewport.label} MPR viewport`}
              onContextMenu={event => event.preventDefault()}
              onDoubleClick={() => resetView(viewport.id)}
              onPointerCancel={() => {
                dragRef.current = null
              }}
              onPointerDown={event => {
                if (!activeVolumeRef.current) {
                  return
                }
                event.currentTarget.setPointerCapture(event.pointerId)
                dragRef.current = {
                  viewportId: viewport.id,
                  previous: [event.clientX, event.clientY],
                  mode: event.shiftKey || event.button === 2 ? 'window' : 'pan',
                }
              }}
              onPointerMove={event => {
                const drag = dragRef.current
                if (!drag || drag.viewportId !== viewport.id) {
                  updateCursorInfo(viewport.id, [event.clientX, event.clientY])
                  return
                }
                const current: Vec2 = [event.clientX, event.clientY]
                const delta: Vec2 = [current[0] - drag.previous[0], current[1] - drag.previous[1]]
                drag.previous = current
                if (drag.mode === 'window') {
                  updateWindow(viewport.id, delta)
                } else {
                  pan(viewport.id, delta)
                }
                updateCursorInfo(viewport.id, current)
              }}
              onPointerUp={() => {
                dragRef.current = null
              }}
              onPointerLeave={() => {
                setCursorInfo(null)
              }}
              onWheel={event => {
                if (!activeVolumeRef.current) {
                  return
                }
                event.preventDefault()
                if (event.ctrlKey) {
                  zoom(viewport.id, event.deltaY)
                } else {
                  scroll(viewport.id, event.deltaY)
                }
                updateCursorInfo(viewport.id, [event.clientX, event.clientY])
              }}
            />
            <div className="viewport-label">{viewport.label}</div>
          </section>
        ))}
        <section className="mpr-empty" aria-label="Empty viewport slot" />
      </section>
      <aside className="controls">
        <div className="title-block">
          <h1>NIfTI MPR</h1>
          <p>{status}</p>
        </div>
        <label className="file-picker">
          <span>NIfTI volume</span>
          <input
            type="file"
            accept=".nii,.nii.gz"
            onChange={event => {
              void loadSelectedFile(event.currentTarget.files?.[0])
            }}
          />
        </label>
        <div className="control-grid">
          <label>
            Window min
            <input
              type="number"
              step="1"
              disabled={!controlsEnabled}
              value={windowMin}
              onChange={event => setWindowMin(event.currentTarget.value)}
            />
          </label>
          <label>
            Window max
            <input
              type="number"
              step="1"
              disabled={!controlsEnabled}
              value={windowMax}
              onChange={event => setWindowMax(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="button-row">
          <button type="button" disabled={!controlsEnabled} onClick={applyWindowToAllViews}>
            Apply Window
          </button>
          <button type="button" disabled={!controlsEnabled} onClick={resetViews}>
            Reset Views
          </button>
        </div>
        <dl className="info">
          <div><dt>Volume</dt><dd>{volumeInfo.volume}</dd></div>
          <div><dt>Source</dt><dd>{volumeInfo.source}</dd></div>
          {volumeInfo.intensity ? <div><dt>Intensity</dt><dd>{volumeInfo.intensity}</dd></div> : null}
          {volumeInfo.centerIndex ? <div><dt>Center index</dt><dd>{volumeInfo.centerIndex}</dd></div> : null}
          <div><dt>Cursor</dt><dd>{cursorInfo ? cursorInfo.viewport : 'Move over a loaded view'}</dd></div>
          <div><dt>Voxel</dt><dd>{cursorInfo ? cursorInfo.voxel : 'n/a'}</dd></div>
          <div>
            <dt>World</dt>
            <dd>{cursorInfo ? `${cursorInfo.world}${cursorInfo.inBounds ? '' : ' (outside)'}` : 'n/a'}</dd>
          </div>
        </dl>
      </aside>
    </main>
  )
}

function createVolumeInfo(volume: ScalarVolume, source: string): VolumeInfo {
  const [min, max] = valueRange(volume)
  const centerIndex: Vec3 = [
    (volume.shape[0] - 1) * 0.5,
    (volume.shape[1] - 1) * 0.5,
    (volume.shape[2] - 1) * 0.5,
  ]
  return {
    volume: volume.shape.join(' x '),
    source,
    intensity: `${formatNumber(min)} to ${formatNumber(max)}`,
    centerIndex: centerIndex.map(formatNumber).join(', '),
  }
}

function canvasToWorld(point: Vec2, width: number, height: number, state: MprRenderState): Vec3 {
  const dx = point[0] - 0.5 * width
  const dy = point[1] - 0.5 * height
  return add(
    add(state.plane.origin, addScaled(state.plane.right, dx * state.plane.pixelSize)),
    addScaled(state.plane.up, -dy * state.plane.pixelSize),
  )
}

function worldToIndex(world: Vec3, volume: ScalarVolume): Vec3 {
  const worldToIndexMatrix = mat4.inverse(volume.indexToWorld)
  return [
    worldToIndexMatrix[0] * world[0] + worldToIndexMatrix[4] * world[1] + worldToIndexMatrix[8] * world[2] + worldToIndexMatrix[12],
    worldToIndexMatrix[1] * world[0] + worldToIndexMatrix[5] * world[1] + worldToIndexMatrix[9] * world[2] + worldToIndexMatrix[13],
    worldToIndexMatrix[2] * world[0] + worldToIndexMatrix[6] * world[1] + worldToIndexMatrix[10] * world[2] + worldToIndexMatrix[14],
  ]
}

function sliceStepSize(worldNormal: Vec3, volume: ScalarVolume): number {
  const worldToIndexMatrix = mat4.inverse(volume.indexToWorld)
  const indexDirection = [
    worldToIndexMatrix[0] * worldNormal[0] + worldToIndexMatrix[4] * worldNormal[1] + worldToIndexMatrix[8] * worldNormal[2],
    worldToIndexMatrix[1] * worldNormal[0] + worldToIndexMatrix[5] * worldNormal[1] + worldToIndexMatrix[9] * worldNormal[2],
    worldToIndexMatrix[2] * worldNormal[0] + worldToIndexMatrix[6] * worldNormal[1] + worldToIndexMatrix[10] * worldNormal[2],
  ]
  const indexUnitsPerWorldUnit = Math.hypot(indexDirection[0], indexDirection[1], indexDirection[2])
  return indexUnitsPerWorldUnit > 0 ? 1 / indexUnitsPerWorldUnit : 1
}

function isVoxelInBounds(voxel: Vec3, volume: ScalarVolume): boolean {
  return voxel.every((value, axis) => value >= 0 && value < volume.shape[axis])
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function addScaled(v: Vec3, scale: number): Vec3 {
  return [v[0] * scale, v[1] * scale, v[2] * scale]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0]
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : 'n/a'
}

function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a'
}

function formatInput(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toPrecision(6))) : '0'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
  throw new Error('Missing #app root.')
}

createRoot(app).render(<MprApp />)

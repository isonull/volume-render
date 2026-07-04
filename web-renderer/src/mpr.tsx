import './style.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { mat4, vec3 } from 'wgpu-matrix'
import { Engine } from './engine'
import { cloneMprState, createInitialMprState, valueRange } from './mpr/mprState'
import type { MprOrientation, MprRenderState } from './mpr/mprState'
import type { Mat4, Vec2n, Vec3, Vec3n } from 'wgpu-matrix'
import type { ScalarVolume } from './volume'
import type { MouseEvent } from 'react'

const VIEWPORTS: { id: MprOrientation; label: string }[] = [
  { id: 'axial', label: 'Axial' },
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' },
]

type DragState = {
  viewportId: MprOrientation
  previous: Vec2n
  mode: 'pan' | 'window'
}

type VolumeInfo = {
  volume: string
  source: string
  affine?: string
  intensity?: string
  centerIndex?: string
}

type SegmentationInfo = {
  source: string
  labels: string
  dtype: string
  affine: string
}

type SceneBrowserItem =
  | { kind: 'volume'; id: string; label: string; shape: string; source?: string; segmentations: SceneBrowserItem[] }
  | { kind: 'segmentation'; id: string; label: string; sourceVolumeId: string; labels: string; dtype: string }

type ContextMenuState = {
  x: number
  y: number
  item: { kind: 'volume' | 'segmentation'; id: string }
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
  const activeSegmentationIdRef = useRef<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const segmentationInputRef = useRef<HTMLInputElement | null>(null)
  const segmentationTargetVolumeIdRef = useRef<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const windowMinRef = useRef('0')
  const windowMaxRef = useRef('0')

  const [status, setStatus] = useState('Initializing WebGPU...')
  const [controlsEnabled, setControlsEnabled] = useState(false)
  const [windowMin, setWindowMinState] = useState('0')
  const [windowMax, setWindowMaxState] = useState('0')
  const [sceneBrowserVersion, setSceneBrowserVersion] = useState(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [volumeInfo, setVolumeInfo] = useState<VolumeInfo>({
    volume: 'No NIfTI loaded',
    source: 'Waiting for .nii or .nii.gz',
  })
  const [segmentationInfo, setSegmentationInfo] = useState<SegmentationInfo | null>(null)
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
    if (activeSegmentationIdRef.current) {
      state.overlay = {
        segmentationId: activeSegmentationIdRef.current,
        visible: true,
      }
    }
    engine.setRenderState(viewportId, state)
  }, [])

  const centerVolume = useCallback((volumeId: string) => {
    const engine = engineRef.current
    const volume = engine?.scene?.volumes.get(volumeId)
    if (!engine || !volume) {
      return
    }
    activeVolumeRef.current = volume
    const [min, max] = valueRange(volume)
    const range = max - min
    setWindowMin(formatInput(min + range * 0.05))
    setWindowMax(formatInput(max))
    setVolumeInfo(createVolumeInfo(volume, volume.source?.uri ?? volume.id, volume.indexToWorld))
    setControlsEnabled(true)
    for (const viewport of VIEWPORTS) {
      const canvas = canvasRefs.current.get(viewport.id)
      const viewportView = engine.viewports.get(viewport.id)
      if (!canvas || !viewportView) {
        continue
      }
      viewportView.resizeFromClient()
      const canvasPixels = Math.min(viewportView.width, viewportView.height)
      const state = createInitialMprState(volume, viewport.id, canvasPixels)
      const activeSegmentationId = activeSegmentationIdRef.current
      if (activeSegmentationId && engine.scene?.segmentations.get(activeSegmentationId)?.sourceVolumeId === volume.id) {
        state.overlay = {
          segmentationId: activeSegmentationId,
          visible: true,
        }
      }
      engine.setRenderState(viewport.id, state)
    }
    setStatus(`Centered ${volume.source?.uri ?? volume.id}.`)
  }, [setWindowMax, setWindowMin])

  const centerSceneItem = useCallback((item: ContextMenuState['item']) => {
    const engine = engineRef.current
    if (!engine?.scene) {
      return
    }
    if (item.kind === 'volume') {
      centerVolume(item.id)
      return
    }
    const segmentation = engine.scene.segmentations.get(item.id)
    if (segmentation) {
      activeSegmentationIdRef.current = segmentation.id
      centerVolume(segmentation.sourceVolumeId)
    }
  }, [centerVolume])

  const openSegmentationForVolume = useCallback((volumeId: string) => {
    const engine = engineRef.current
    if (!engine?.scene?.volumes.has(volumeId)) {
      return
    }
    segmentationTargetVolumeIdRef.current = volumeId
    const input = segmentationInputRef.current
    if (input) {
      input.value = ''
      input.click()
    }
  }, [])

  const closeSceneItem = useCallback((item: ContextMenuState['item']) => {
    const engine = engineRef.current
    if (!engine?.scene) {
      return
    }
    if (item.kind === 'volume') {
      const volume = engine.scene.volumes.get(item.id)
      if (!volume) {
        return
      }
      const removedSegmentationIds = [...engine.scene.segmentations.values()]
        .filter(segmentation => segmentation.sourceVolumeId === item.id)
        .map(segmentation => segmentation.id)
      engine.applySceneTransaction(tx => {
        for (const segmentationId of removedSegmentationIds) {
          tx.removeSegmentation(segmentationId)
        }
        tx.removeVolume(item.id)
      })
      if (activeSegmentationIdRef.current && removedSegmentationIds.includes(activeSegmentationIdRef.current)) {
        activeSegmentationIdRef.current = null
        setSegmentationInfo(null)
      }
      const nextVolume = [...engine.scene.volumes.values()][0]
      if (nextVolume) {
        centerVolume(nextVolume.id)
      } else {
        activeVolumeRef.current = null
        activeSegmentationIdRef.current = null
        setControlsEnabled(false)
        setCursorInfo(null)
        setSegmentationInfo(null)
        setVolumeInfo({
          volume: 'No NIfTI loaded',
          source: 'Waiting for .nii or .nii.gz',
        })
        engine.destroyScene()
      }
      setStatus(`Volume ${volume.source?.uri ?? volume.id} closed.`)
    } else {
      engine.applySceneTransaction(tx => tx.removeSegmentation(item.id))
      if (activeSegmentationIdRef.current === item.id) {
        activeSegmentationIdRef.current = null
        setSegmentationInfo(null)
        for (const [viewportId, state] of engine.renderStates) {
          const next = cloneMprState(state)
          next.overlay = undefined
          engine.setRenderState(viewportId, next)
        }
      }
      setStatus('Segmentation closed.')
    }
    setSceneBrowserVersion(version => version + 1)
  }, [centerVolume])

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

  const updateCursorInfo = useCallback((viewportId: MprOrientation, clientPoint: Vec2n) => {
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
    const voxel: Vec3n = [
      Math.round(index[0]),
      Math.round(index[1]),
      Math.round(index[2]),
    ]
    setCursorInfo({
      viewport: VIEWPORTS.find(item => item.id === viewportId)?.label ?? viewportId,
      voxel: voxel.map(value => String(value)).join(', '),
      world: Array.from(world, formatCoordinate).join(', '),
      inBounds: isVoxelInBounds(voxel, activeVolume),
    })
  }, [currentState])

  const pan = useCallback((viewportId: MprOrientation, delta: Vec2n) => {
    const state = currentState(viewportId)
    const engine = engineRef.current
    if (!state || !engine) {
      return
    }
    const next = cloneMprState(state)
    next.plane.origin = vec3.addScaled(
      next.plane.origin,
      next.plane.right,
      -delta[0] * next.plane.pixelSize,
    )
    next.plane.origin = vec3.addScaled(
      next.plane.origin,
      next.plane.up,
      delta[1] * next.plane.pixelSize,
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
    const normal = vec3.normalize(vec3.cross(next.plane.right, next.plane.up))
    next.plane.origin = vec3.addScaled(next.plane.origin, normal, direction * sliceStepSize(normal, activeVolume))
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

  const updateWindow = useCallback((viewportId: MprOrientation, delta: Vec2n) => {
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

  const loadImageFile = useCallback(async (file: File | undefined) => {
    const engine = engineRef.current
    if (!file || !engine) {
      return
    }

    try {
      setStatus(`Loading ${file.name}...`)
      const { indexToWorldFromNiftiFile, loadNiftiFile, scalarVolumeFromNiftiFile } = await import('./io/nifti')
      const niftiFile = await loadNiftiFile(file)
      const volume = scalarVolumeFromNiftiFile(niftiFile, file.name)
      activeVolumeRef.current = volume
      activeSegmentationIdRef.current = null
      setCursorInfo(null)
      setSegmentationInfo(null)
      engine.loadVolume(volume)
      setSceneBrowserVersion(version => version + 1)
      const [min, max] = valueRange(volume)
      const range = max - min
      setWindowMin(formatInput(min + range * 0.05))
      setWindowMax(formatInput(max))
      setVolumeInfo(createVolumeInfo(volume, file.name, indexToWorldFromNiftiFile(niftiFile)))
      setControlsEnabled(true)
      for (const viewport of VIEWPORTS) {
        resetView(viewport.id)
      }
      setStatus(`${file.name} loaded.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }, [resetView, setWindowMax, setWindowMin])

  const loadSegmentationFile = useCallback(async (file: File | undefined, sourceVolumeId?: string | null) => {
    const engine = engineRef.current
    if (!file || !engine) {
      return
    }
    const activeVolume = sourceVolumeId
      ? engine.scene?.volumes.get(sourceVolumeId) ?? null
      : activeVolumeRef.current
    if (!activeVolume) {
      setStatus('Choose a source volume before loading a segmentation.')
      return
    }

    try {
      setStatus(`Loading segmentation ${file.name}...`)
      const { indexToWorldFromNiftiFile, labelmapSegmentationFromNiftiFile, loadNiftiFile } = await import('./io/nifti')
      const niftiFile = await loadNiftiFile(file)
      const rawIndexToWorld = indexToWorldFromNiftiFile(niftiFile)
      const segmentation = labelmapSegmentationFromNiftiFile(niftiFile, activeVolume, file.name)
      engine.applySceneTransaction(tx => {
        for (const [segmentationId, existing] of engine.scene!.segmentations) {
          if (existing.sourceVolumeId !== activeVolume.id) {
            continue
          }
          tx.removeSegmentation(segmentationId)
        }
        tx.addSegmentation(segmentation)
      })
      setSceneBrowserVersion(version => version + 1)
      activeSegmentationIdRef.current = segmentation.id
      activeVolumeRef.current = activeVolume
      for (const [viewportId, state] of engine.renderStates) {
        if (state.image.volumeId !== activeVolume.id) {
          continue
        }
        const next = cloneMprState(state)
        next.overlay = {
          segmentationId: segmentation.id,
          visible: true,
        }
        engine.setRenderState(viewportId, next)
      }
      setSegmentationInfo({
        source: file.name,
        labels: segmentation.segments.size === 0 ? 'background only' : `${segmentation.segments.size} non-zero label${segmentation.segments.size === 1 ? '' : 's'}`,
        dtype: segmentation.data.constructor.name,
        affine: formatMat4Rows(rawIndexToWorld),
      })
      setStatus(`Segmentation ${file.name} loaded for ${activeVolume.source?.uri ?? activeVolume.id}.`)
    } catch (error) {
      setStatus(errorMessage(error))
    }
  }, [])

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

  useEffect(() => {
    if (!contextMenu) {
      return
    }

    function closeMenu(): void {
      setContextMenu(null)
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', closeMenu)
    }
  }, [contextMenu])

  const sceneItems = createSceneBrowserItems(engineRef.current?.scene ?? null, sceneBrowserVersion)

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
                const current: Vec2n = [event.clientX, event.clientY]
                const delta: Vec2n = [current[0] - drag.previous[0], current[1] - drag.previous[1]]
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
        <div className="file-actions">
          <button
            type="button"
            onClick={() => {
              const input = imageInputRef.current
              if (input) {
                input.value = ''
                input.click()
              }
            }}
          >
            Open Volume
          </button>
          <input
            ref={imageInputRef}
            className="hidden-file-input"
            type="file"
            accept=".nii,.nii.gz"
            onChange={event => {
              void loadImageFile(event.currentTarget.files?.[0])
            }}
          />
          <input
            ref={segmentationInputRef}
            className="hidden-file-input"
            type="file"
            accept=".nii,.nii.gz"
            onChange={event => {
              void loadSegmentationFile(event.currentTarget.files?.[0], segmentationTargetVolumeIdRef.current)
              segmentationTargetVolumeIdRef.current = null
            }}
          />
        </div>
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
        <section className="scene-browser" aria-label="Scene browser">
          <h2>Scene</h2>
          {sceneItems.length === 0 ? (
            <p>No volumes loaded</p>
          ) : (
            <ul>
              {sceneItems.map(item => (
                <SceneBrowserNode
                  item={item}
                  key={item.id}
                  onContextMenu={(event, menuItem) => {
                    event.preventDefault()
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      item: menuItem,
                    })
                  }}
                />
              ))}
            </ul>
          )}
        </section>
        <dl className="info">
          <div><dt>Volume</dt><dd>{volumeInfo.volume}</dd></div>
          <div><dt>Source</dt><dd>{volumeInfo.source}</dd></div>
          {volumeInfo.affine ? <div className="matrix-row"><dt>Volume affine</dt><dd><pre>{volumeInfo.affine}</pre></dd></div> : null}
          <div><dt>Seg</dt><dd>{segmentationInfo ? segmentationInfo.source : 'none'}</dd></div>
          {segmentationInfo ? <div><dt>Labels</dt><dd>{`${segmentationInfo.labels} (${segmentationInfo.dtype})`}</dd></div> : null}
          {segmentationInfo ? <div className="matrix-row"><dt>Segment affine</dt><dd><pre>{segmentationInfo.affine}</pre></dd></div> : null}
          {volumeInfo.intensity ? <div><dt>Intensity</dt><dd>{volumeInfo.intensity}</dd></div> : null}
          {volumeInfo.centerIndex ? <div><dt>Center index</dt><dd>{volumeInfo.centerIndex}</dd></div> : null}
          <div><dt>Cursor</dt><dd>{cursorInfo ? cursorInfo.viewport : 'Move over a loaded view'}</dd></div>
          <div><dt>Voxel</dt><dd>{cursorInfo ? cursorInfo.voxel : 'n/a'}</dd></div>
          <div>
            <dt>World</dt>
            <dd>{cursorInfo ? `${cursorInfo.world}${cursorInfo.inBounds ? '' : ' (outside)'}` : 'n/a'}</dd>
          </div>
        </dl>
        {contextMenu ? (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                centerSceneItem(contextMenu.item)
                setContextMenu(null)
              }}
            >
              Center
            </button>
            {contextMenu.item.kind === 'volume' ? (
              <button
                type="button"
                onClick={() => {
                  openSegmentationForVolume(contextMenu.item.id)
                  setContextMenu(null)
                }}
              >
                Open Segmentation
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                closeSceneItem(contextMenu.item)
                setContextMenu(null)
              }}
            >
              Close
            </button>
          </div>
        ) : null}
      </aside>
    </main>
  )
}

function SceneBrowserNode({
  item,
  onContextMenu,
}: {
  item: SceneBrowserItem
  onContextMenu: (event: MouseEvent, item: ContextMenuState['item']) => void
}) {
  if (item.kind === 'segmentation') {
    return (
      <li>
        <button
          type="button"
          className="scene-item scene-item-segmentation"
          onContextMenu={event => onContextMenu(event, { kind: 'segmentation', id: item.id })}
        >
          <span>{item.label}</span>
          <small>{`${item.labels} · ${item.dtype}`}</small>
        </button>
      </li>
    )
  }

  return (
    <li>
      <details open>
        <summary
          className="scene-item scene-item-volume"
          onContextMenu={event => onContextMenu(event, { kind: 'volume', id: item.id })}
        >
          <span>{item.label}</span>
          <small>{item.shape}</small>
        </summary>
        {item.segmentations.length > 0 ? (
          <ul>
            {item.segmentations.map(segmentation => (
              <SceneBrowserNode item={segmentation} key={segmentation.id} onContextMenu={onContextMenu} />
            ))}
          </ul>
        ) : null}
      </details>
    </li>
  )
}

function createSceneBrowserItems(scene: Engine['scene'], _version: number): SceneBrowserItem[] {
  if (!scene) {
    return []
  }
  return [...scene.volumes.values()].map(volume => {
    const segmentations: SceneBrowserItem[] = [...scene.segmentations.values()]
      .filter(segmentation => segmentation.sourceVolumeId === volume.id)
      .map(segmentation => ({
        kind: 'segmentation',
        id: segmentation.id,
        label: segmentation.id,
        sourceVolumeId: segmentation.sourceVolumeId,
        labels: segmentation.segments.size === 0 ? 'background only' : `${segmentation.segments.size} labels`,
        dtype: segmentation.data.constructor.name,
      }))

    return {
      kind: 'volume',
      id: volume.id,
      label: volume.source?.uri ?? volume.id,
      source: volume.source?.uri,
      shape: volume.shape.join(' x '),
      segmentations,
    }
  })
}

function createVolumeInfo(volume: ScalarVolume, source: string, affine: Mat4): VolumeInfo {
  const [min, max] = valueRange(volume)
  const centerIndex = vec3.create(
    (volume.shape[0] - 1) * 0.5,
    (volume.shape[1] - 1) * 0.5,
    (volume.shape[2] - 1) * 0.5,
  )
  return {
    volume: volume.shape.join(' x '),
    source,
    affine: formatMat4Rows(affine),
    intensity: `${formatNumber(min)} to ${formatNumber(max)}`,
    centerIndex: Array.from(centerIndex, formatNumber).join(', '),
  }
}

function formatMat4Rows(matrix: Mat4): string {
  return [
    [matrix[0], matrix[4], matrix[8], matrix[12]],
    [matrix[1], matrix[5], matrix[9], matrix[13]],
    [matrix[2], matrix[6], matrix[10], matrix[14]],
    [matrix[3], matrix[7], matrix[11], matrix[15]],
  ].map(row => `[${row.map(formatAffineValue).join(', ')}]`).join('\n')
}

function formatAffineValue(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a'
  }
  const normalized = Math.abs(value) < 5e-7 ? 0 : value
  return normalized.toFixed(6).padStart(11, ' ')
}

function canvasToWorld(point: Vec2n, width: number, height: number, state: MprRenderState): Vec3 {
  const dx = point[0] - 0.5 * width
  const dy = point[1] - 0.5 * height
  return vec3.add(
    vec3.addScaled(state.plane.origin, state.plane.right, dx * state.plane.pixelSize),
    vec3.scale(state.plane.up, -dy * state.plane.pixelSize),
  )
}

function worldToIndex(world: Vec3, volume: ScalarVolume): Vec3 {
  const worldToIndexMatrix = mat4.inverse(volume.indexToWorld)
  return vec3.create(
    worldToIndexMatrix[0] * world[0] + worldToIndexMatrix[4] * world[1] + worldToIndexMatrix[8] * world[2] + worldToIndexMatrix[12],
    worldToIndexMatrix[1] * world[0] + worldToIndexMatrix[5] * world[1] + worldToIndexMatrix[9] * world[2] + worldToIndexMatrix[13],
    worldToIndexMatrix[2] * world[0] + worldToIndexMatrix[6] * world[1] + worldToIndexMatrix[10] * world[2] + worldToIndexMatrix[14],
  )
}

function sliceStepSize(worldNormal: Vec3, volume: ScalarVolume): number {
  const worldToIndexMatrix = mat4.inverse(volume.indexToWorld)
  const indexDirection = vec3.create(
    worldToIndexMatrix[0] * worldNormal[0] + worldToIndexMatrix[4] * worldNormal[1] + worldToIndexMatrix[8] * worldNormal[2],
    worldToIndexMatrix[1] * worldNormal[0] + worldToIndexMatrix[5] * worldNormal[1] + worldToIndexMatrix[9] * worldNormal[2],
    worldToIndexMatrix[2] * worldNormal[0] + worldToIndexMatrix[6] * worldNormal[1] + worldToIndexMatrix[10] * worldNormal[2],
  )
  const indexUnitsPerWorldUnit = vec3.length(indexDirection)
  return indexUnitsPerWorldUnit > 0 ? 1 / indexUnitsPerWorldUnit : 1
}

function isVoxelInBounds(voxel: Vec3n, volume: ScalarVolume): boolean {
  return voxel.every((value, axis) => value >= 0 && value < volume.shape[axis])
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

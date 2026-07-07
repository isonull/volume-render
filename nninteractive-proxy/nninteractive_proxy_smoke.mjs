const proxyUrl = (process.env.NNINTERACTIVE_PROXY_URL ?? 'http://127.0.0.1:1528').replace(/\/+$/, '')
const metaHeader = 'X-Meta'
const leaseHeader = 'X-Lease-Token'

const nx = 32
const ny = 32
const nz = 32

let leaseToken = null

try {
  const proxyInfo = await getJson('/__raw_proxy_info')
  if (!Array.isArray(proxyInfo.features) || !proxyInfo.features.includes('raw_mask_interactions') || !proxyInfo.features.includes('raw_initial_segmentation')) {
    throw new Error('Proxy does not advertise the expected raw mask features.')
  }

  const claim = await postJson('/claim', {})
  leaseToken = claim.lease_token
  if (!leaseToken) {
    throw new Error('Claim response did not include lease_token.')
  }

  const image = new Float32Array(nx * ny * nz)
  const cx = (nx - 1) / 2
  const cy = (ny - 1) / 2
  const cz = (nz - 1) / 2
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let z = 0; z < nz; z += 1) {
        const radius = Math.hypot(x - cx, y - cy, z - cz)
        image[(x * ny + y) * nz + z] = radius < 8 ? 1 : 0
      }
    }
  }

  await postBinary('/set_image', {
    image_properties: {},
    shape: [1, nx, ny, nz],
    dtype: 'float32',
    encoding: 'raw-c-order',
  }, new Uint8Array(image.buffer))
  await postJson('/set_target_buffer', { shape: [nx, ny, nz], dtype: 'uint8' })

  const initialSegmentation = new Uint8Array(nx * ny * nz)
  for (let x = 0; x < nx; x += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let z = 0; z < nz; z += 1) {
        const radius = Math.hypot(x - cx, y - cy, z - cz)
        initialSegmentation[(x * ny + y) * nz + z] = radius < 5 ? 1 : 0
      }
    }
  }
  const initialResponse = await postBinary('/add_initial_seg_interaction', {
    shape: [nx, ny, nz],
    dtype: 'uint8',
    encoding: 'raw-c-order',
    run_prediction: false,
  }, initialSegmentation)
  const initialPatch = await parsePredictionResponse(initialResponse)

  const pointResponse = await postJsonResponse('/add_point_interaction', {
    coordinates: [Math.floor(nx / 2), Math.floor(ny / 2), Math.floor(nz / 2)],
    include_interaction: true,
    run_prediction: true,
  })
  const pointPatch = await parsePredictionResponse(pointResponse)

  const scribble = new Uint8Array(8 * 8)
  for (let i = 0; i < 8; i += 1) {
    scribble[i * 8 + i] = 1
    if (i + 1 < 8) {
      scribble[i * 8 + i + 1] = 1
    }
  }
  const scribbleResponse = await postBinary('/add_scribble_interaction', {
    shape: [8, 8, 1],
    dtype: 'uint8',
    encoding: 'raw-c-order',
    include_interaction: false,
    run_prediction: true,
    interaction_bbox: [[12, 20], [12, 20], [16, 17]],
  }, scribble)
  const scribblePatch = await parsePredictionResponse(scribbleResponse)

  console.log(JSON.stringify({
    proxyUrl,
    proxyVersion: proxyInfo.version ?? null,
    initial: initialPatch,
    point: pointPatch,
    scribble: scribblePatch,
  }, null, 2))
} finally {
  if (leaseToken) {
    try {
      await postJson('/release', {})
    } catch (error) {
      console.warn(`Release failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function postJson(path, payload) {
  const response = await postJsonResponse(path, payload)
  return response.json()
}

async function getJson(path) {
  const response = await checkedFetch(path, {
    method: 'GET',
    headers: leaseHeaders(),
  })
  return response.json()
}

async function postJsonResponse(path, payload) {
  return checkedFetch(path, {
    method: 'POST',
    headers: {
      ...leaseHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

async function postBinary(path, meta, body) {
  return checkedFetch(path, {
    method: 'POST',
    headers: {
      ...leaseHeaders(),
      [metaHeader]: JSON.stringify(meta),
      'Content-Type': 'application/octet-stream',
    },
    body,
  })
}

async function parsePredictionResponse(response) {
  const metaRaw = response.headers.get(metaHeader)
  const meta = metaRaw ? JSON.parse(metaRaw) : {}
  const data = new Uint8Array(await response.arrayBuffer())
  const expectedBytes = meta.shape
    ? meta.shape.reduce((product, dim) => product * dim, 1) * dtypeBytes(meta.dtype ?? 'uint8')
    : 0

  if (meta.ran_prediction && data.byteLength !== expectedBytes) {
    throw new Error(`Raw patch size mismatch: got ${data.byteLength}, expected ${expectedBytes}.`)
  }

  return {
    ranPrediction: Boolean(meta.ran_prediction),
    bbox: meta.bbox ?? null,
    shape: meta.shape ?? null,
    dtype: meta.dtype ?? null,
    bytes: data.byteLength,
  }
}

async function checkedFetch(path, init) {
  const response = await fetch(`${proxyUrl}${path}`, init)
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.text()
      detail = body || detail
    } catch {
      // Keep statusText.
    }
    throw new Error(`${init.method ?? 'GET'} ${path} failed with ${response.status}: ${detail}`)
  }
  return response
}

function leaseHeaders() {
  return leaseToken ? { [leaseHeader]: leaseToken } : {}
}

function dtypeBytes(dtype) {
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
      throw new Error(`Unsupported dtype in smoke response: ${dtype}`)
  }
}

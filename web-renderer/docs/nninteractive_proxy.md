# nnInteractive Raw Proxy

`web-renderer` defaults the nnInteractive panel URL to `/nninteractive`. In Vite
development that same-origin path is proxied to a local raw-array proxy on
`http://127.0.0.1:1528`, and the raw proxy forwards to the real
`nninteractive-server` on `http://127.0.0.1:1527`.

This keeps NNIA header parsing and Blosc2 compression/decompression in Python:

```text
browser
  -> /nninteractive        raw C-order array bytes
  -> Python raw proxy      NNIA + blosc2 encode/decode
  -> nninteractive-server  native server wire format
```

The proxy is a standalone sidecar under:

```text
../nninteractive-proxy
```

Run the proxy from `web-renderer`:

```powershell
npm run nninteractive:proxy -- --target http://127.0.0.1:1527
```

Or run it directly from `volume-render/nninteractive-proxy`:

```powershell
.\scripts\run.ps1 --target http://127.0.0.1:1527
```

The proxy script creates and uses its own `.venv`. It prefers a bundled Python
runtime at `runtime/python/win-x64/python.exe`, then falls back to `uv`,
`py -3.11`, or `python` only for first-time bootstrap.

To build a Windows exe:

```powershell
cd ..\nninteractive-proxy
.\scripts\build-exe.ps1
.\dist\win-x64\nninteractive-proxy.exe --target http://127.0.0.1:1527
```

The proxy can also be configured with environment variables:

| Variable | Default |
| --- | --- |
| `NNINTERACTIVE_PROXY_HOST` | `127.0.0.1` |
| `NNINTERACTIVE_PROXY_PORT` | `1528` |
| `NNINTERACTIVE_SERVER_URL` | `http://127.0.0.1:1527` |

Vite forwards `/nninteractive` to `http://127.0.0.1:1528` by default. Override
that only when the raw proxy is listening elsewhere:

```powershell
$env:VITE_NNINTERACTIVE_PROXY_TARGET = "http://127.0.0.1:1530"
```

The browser client automatically treats relative server URLs, including the
default `/nninteractive`, as raw-proxy transport. Absolute URLs still require an
application-provided `globalThis.nnInteractiveBlosc2Codec`.

With the real server and raw proxy running, verify the binary route without
starting Vite:

```powershell
npm run nninteractive:proxy:smoke
```

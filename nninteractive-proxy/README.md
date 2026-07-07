# nnInteractive Proxy

Standalone raw-array proxy for `nninteractive-server`.

The browser-facing web renderer talks to `/nninteractive` with raw C-order
array bytes. This proxy translates those requests to the NNIA + Blosc2 wire
format expected by `nninteractive-server`, and decodes prediction patches back
to raw bytes for the browser.

## Run from source

From `volume-render/nninteractive-proxy`:

```powershell
.\scripts\run.ps1 --target http://127.0.0.1:1527
```

The run script creates a local `.venv` on first use and installs
`requirements.txt`. It prefers a bundled interpreter at:

```text
runtime/python/win-x64/python.exe
```

If that interpreter is not present, the script falls back to `uv`, `py -3.11`,
or `python` for bootstrap. Runtime execution always uses the proxy-local venv
once it exists.

## Build Windows exe

From `volume-render/nninteractive-proxy`:

```powershell
.\scripts\build-exe.ps1
```

The output is:

```text
dist/win-x64/nninteractive-proxy.exe
```

Run the packaged proxy:

```powershell
.\dist\win-x64\nninteractive-proxy.exe --target http://127.0.0.1:1527
```

If a previous build left a stale venv stamp, rerun the same build command. The
script verifies that `numpy`, `blosc2`, and `PyInstaller` can actually be
imported before it trusts the dependency stamp.

## Smoke test

With `nninteractive-server` and this proxy already running:

```powershell
node .\nninteractive_proxy_smoke.mjs
```

The smoke test uses `NNINTERACTIVE_PROXY_URL` when provided, otherwise it
targets `http://127.0.0.1:1528`.

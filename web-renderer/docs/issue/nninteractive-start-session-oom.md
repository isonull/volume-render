# nnInteractive Start Session OOM

## Summary

Starting an nnInteractive session can intermittently fail during the `Start`
workflow. Restarting `nninteractive-server` and clicking `Start` again may make
the same workflow succeed.

The observed failure is not a proxy discovery problem and not a lease claim
failure. The server successfully claims a session, then fails while processing
`/set_image`.

## Observed Flow

The server log shows:

```text
claimed session ... (1/3 active)
POST /claim 200 OK
GET /capabilities 200 OK
Initialize interactions with dense torch.Tensor (auto)
POST /set_image 500 Internal Server Error
RuntimeError: CUDA error: out of memory
released session ... (0/3 active)
```

The frontend start sequence is:

```text
claim
get capabilities
set_image
set_target_buffer
```

The failure happens before `set_target_buffer`.

## Diagnosis

The server is using:

```text
--interactions-storage auto
```

For the failing image, `auto` selected:

```text
dense torch.Tensor
```

The failing stack is inside server-side interaction initialization:

```text
session._finish_preprocessing_and_initialize_interactions()
_initialize_interactions()
_new_interactions_array()
torch.zeros(shape, dtype=torch.float16, device="cpu", pin_memory=pin)
RuntimeError: CUDA error: out of memory
```

This means the server failed while allocating the interaction tensor for the
current session. The error can appear even when `nvidia-smi` shows available
VRAM, because the failing allocation uses pinned host memory through PyTorch's
CUDA path and may also reflect CUDA allocator state, fragmentation, or an
asynchronous CUDA error.

Restarting the server clears:

```text
PyTorch/CUDA allocator state
session state
pinned-memory state
model/runtime caches
```

This explains why the same operation can succeed after a server restart.

## Current Mitigation

For local development and single-user testing, start the server with compact
interaction storage and one session:

```bash
sudo docker run --rm --gpus all -p 1527:1527 ghcr.io/mic-dkfz/nninteractive-server:latest \
  --host 0.0.0.0 \
  --port 1527 \
  --device cuda:0 \
  --no-torch-compile \
  --interactions-storage blosc2 \
  --max-sessions 1
```

Rationale:

```text
--interactions-storage blosc2
  Avoids dense pinned torch interaction storage.

--max-sessions 1
  Prevents multiple concurrent sessions from each holding image, target buffer,
  and interaction state.

--no-torch-compile
  Reduces compile-related runtime memory pressure and startup complexity.
```

This may be slower than dense tensor interaction storage, but it should be more
stable for large 3D volumes or constrained GPU/host-memory environments.

## Frontend Behavior

The frontend currently releases the claimed client session on start failure.
The server log confirms release in the observed case:

```text
released session ... (0/3 active)
```

So this issue is not currently suspected to be a frontend session leak.

## Follow-Up

Potential improvements:

1. Surface a clearer frontend error when `/set_image` fails with server-side
   OOM.
2. Add documentation near nnInteractive setup recommending
   `--interactions-storage blosc2 --max-sessions 1` for large local volumes.
3. Consider adding a server diagnostic panel field showing the configured
   interaction storage mode if the server exposes it.
4. Consider adding a preflight warning based on volume voxel count and active
   server capabilities.
5. Re-test with server `--interactions-storage blosc2` to confirm the failure
   disappears for the same volume.


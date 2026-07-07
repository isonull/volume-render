# nnInteractive Fact Divergence

## Problem

The current nnInteractive integration maps a server-side binary object workflow
onto a local multi-label segmentation.

The server session owns:

```text
image
target_buffer        # binary/current-object prediction
interactions         # point/scribble/prev_seg prompt channels
undo snapshot        # previous binary target_buffer + interactions
```

The web renderer owns:

```text
Scene
LabelmapSegmentationData
multiple segment labels in one labelmap
```

These two states are not equivalent. The server does not know that a voxel may
belong to another local segment label.

## Current Protection

When applying nnInteractive prediction patches to a local labelmap, the web
renderer preserves other segment labels:

```text
server foreground -> target label only if local voxel is background or target label
server foreground -> ignored if local voxel already belongs to another label
server background -> clears only the target label
```

This prevents nnInteractive from destructively overwriting existing local
segments.

## Possible Divergence

This protection can intentionally create a divergence:

```text
server target_buffer / prev_seg:
  current object includes voxel V

local LabelmapSegmentationData:
  voxel V remains label N because label N is not the active target label
```

The next nnInteractive prediction may still use the server-side `prev_seg`
channel where voxel V is part of the current object. The local renderer will
continue to protect label N when applying the next patch.

This is safer than overwriting label N, but it means the server's binary object
state and the local multi-label segmentation state can temporarily disagree.

## Undo Implication

Server undo restores only the previous server-side binary state:

```text
target_buffer
interactions
```

It cannot restore overwritten local multi-label data unless the web renderer
keeps its own multi-label edit history.

The current protection prevents new overwrites of other labels, so server undo
does not need to recover them. It cannot repair overwrites that happened before
the protection existed.

## Desired Future Design

The long-term integration should make this boundary explicit:

```text
nnInteractive server session = single active binary object
web-renderer segmentation = authoritative multi-label scene fact
```

Possible follow-ups:

1. Track a local nnInteractive edit transaction history so undo can restore
   exact multi-label voxels, not just server binary target state.
2. Maintain a protected-label mask for all non-target labels and expose it in
   the UI.
3. Consider sending protected regions as negative prompts when that improves
   model behavior.
4. Consider per-segment nnInteractive sessions or session reset when switching
   target segment.
5. Add a visible status warning when a patch is clipped by protected labels.
6. Add tests for:
   - target label writing into background
   - target label refinement clearing only itself
   - foreground prediction overlapping another label
   - undo after protected overlap

## Current Recommendation

Keep the non-destructive local protection as the default behavior.

Do not allow a server-side binary prediction to overwrite another local segment
label unless the user explicitly chooses an overwrite mode and the local app can
record a reversible multi-label transaction.


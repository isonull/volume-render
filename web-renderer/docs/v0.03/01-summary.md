# Section 1. Summary

v0.03 is the nnInteractive and extension-runtime update.

v0.02 completed the local tool/command/service foundation. v0.03 keeps that
foundation and adds a compile-time extension layer so workflow features can be
registered without directly expanding the React entry point.

The main result is that nnInteractive is no longer treated as a special case in
`mpr.tsx`. It is a first-party workflow extension with its own service,
commands, tools, UI contribution, server transport adapter, and lifecycle
cleanup.

## Section 1.1 Goals

v0.03 goals:

```text
Introduce an extension host before adding external AI workflow logic.
Move built-in MPR and segmentation capabilities into a core extension.
Add nnInteractive as the first external workflow extension.
Support positive and negative point prompts.
Support positive and negative scribble prompts.
Keep Scene and labelmap mutation behind commands, services, and transactions.
Use dirty bbox patch updates rather than full labelmap rewrites for prediction results.
Improve viewport usability and segmentation workflow entry points.
```

## Section 1.2 Non-Goals

v0.03 does not attempt to provide:

```text
remote plugin loading
third-party plugin marketplace or ABI stability
multi-session nnInteractive session pool
multiple simultaneous overlay segmentations in one viewport
formal workbench UI layout
full undo/redo command history
new renderer or shader extension points
new medical data model extension points
```

## Section 1.3 Major Changes

Major code areas added or changed:

```text
src/extensions/*
src/extensions/core/*
src/extensions/nninteractive/*
../nninteractive-proxy/nninteractive_proxy.py
../nninteractive-proxy/nninteractive_proxy_smoke.mjs
../nninteractive-proxy/requirements.txt
../nninteractive-proxy/scripts/*
src/commands/segmentationCommands.ts
src/commands/sceneCommands.ts
src/commands/mprCommands.ts
src/services/segmentationService.ts
src/mpr/mprTools.ts
src/mpr.tsx
src/style.css
vite.config.ts
package.json
docs/architecture.md
```

## Section 1.4 Architectural Direction

v0.03 strengthens the existing boundaries:

```text
Extension contributes capability.
Tool interprets user input.
Command coordinates durable mutation.
Service owns long-lived runtime state.
Scene remains the CPU-side source of truth.
Renderer only derives GPU cache from Scene and MPR render state.
```

The nnInteractive integration follows this rule:

```text
nnInteractiveService may own server session state.
It may not directly patch Scene data or GPU resources.
Prediction results are applied through SegmentationService inside Scene transactions.
```

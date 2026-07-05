# Web Renderer Architecture

| Field           | Value                                              |
| --------------- | -------------------------------------------------- |
| Document status | Active                                             |
| Audience        | Contributors and reviewers of `web-renderer`       |
| Scope           | Module boundaries, ownership rules, change flow    |
| Out of scope    | Tool feature specifications, shader implementation  |

## Table of Contents

- [Web Renderer Architecture](#web-renderer-architecture)
  - [Table of Contents](#table-of-contents)
  - [1. Overview](#1-overview)
    - [1.1 Purpose](#11-purpose)
    - [1.2 Audience](#12-audience)
    - [1.3 Reading Guide](#13-reading-guide)
  - [2. Architectural Goals](#2-architectural-goals)
    - [Core Principle](#core-principle)
  - [3. System Layers](#3-system-layers)
  - [4. Main Data Flow](#4-main-data-flow)
    - [4.1 Invariants](#41-invariants)
  - [5. Architecture Decisions](#5-architecture-decisions)
    - [ADR-01 Scene Is the CPU-Side Source of Truth](#adr-01-scene-is-the-cpu-side-source-of-truth)
    - [ADR-02 Scene Mutations Must Go Through Transactions](#adr-02-scene-mutations-must-go-through-transactions)
    - [ADR-03 GPU Resources Are Derived Cache](#adr-03-gpu-resources-are-derived-cache)
    - [ADR-04 Viewport State Is Separate from Scene Data](#adr-04-viewport-state-is-separate-from-scene-data)
    - [ADR-05 Commands Are the Mutation Boundary](#adr-05-commands-are-the-mutation-boundary)
    - [ADR-06 Tools Interpret Input but Do Not Own Data](#adr-06-tools-interpret-input-but-do-not-own-data)
    - [ADR-07 Services Replace the Former God Object](#adr-07-services-replace-the-former-god-object)
    - [ADR-08 Rendering Is Request-Based, Not Continuous](#adr-08-rendering-is-request-based-not-continuous)
    - [ADR-09 Imported Labelmaps Must Match Their Source Volume](#adr-09-imported-labelmaps-must-match-their-source-volume)
    - [ADR-10 WebGPU Type Constraints Stay at the Boundary](#adr-10-webgpu-type-constraints-stay-at-the-boundary)
  - [6. Module Overview](#6-module-overview)
    - [6.1 Entry and UI](#61-entry-and-ui)
    - [6.2 Scene Model](#62-scene-model)
    - [6.3 IO Layer](#63-io-layer)
    - [6.4 Services](#64-services)
    - [6.5 Commands](#65-commands)
    - [6.6 Tool and Input Framework](#66-tool-and-input-framework)
    - [6.7 Viewport Model](#67-viewport-model)
    - [6.8 MPR Renderer Module](#68-mpr-renderer-module)
    - [6.9 PBR Renderer Module](#69-pbr-renderer-module)
  - [7. Ownership Rules](#7-ownership-rules)
    - [7.1 What Each Layer Owns](#71-what-each-layer-owns)
    - [7.2 Ownership That Is Intentionally Avoided](#72-ownership-that-is-intentionally-avoided)
  - [8. Change Propagation](#8-change-propagation)
    - [8.1 Scene-Level Change](#81-scene-level-change)
    - [8.2 Viewport Render-State Change](#82-viewport-render-state-change)
    - [8.3 Input-Driven Change](#83-input-driven-change)
  - [9. Extension Guidelines](#9-extension-guidelines)
    - [9.1 Anti-Patterns](#91-anti-patterns)
  - [10. Glossary](#10-glossary)
  - [11. Current Non-Goals](#11-current-non-goals)

---

## 1. Overview

`web-renderer` is a browser-based medical image rendering application built on
React and WebGPU. This document is the authoritative reference for its
architecture: it captures the layering, ownership boundaries, and change
propagation rules that the codebase is expected to follow.

### 1.1 Purpose

The document answers four questions for every layer of the system:

- What does this layer own?
- Who is allowed to mutate it?
- How do mutations propagate?
- Where do new features belong?

### 1.2 Audience

This document is written for engineers contributing to or reviewing
`web-renderer`. It assumes familiarity with React, WebGPU, and common medical
imaging concepts (volumes, segmentations, labelmaps, affines).

### 1.3 Reading Guide

If you are **adding a feature**, read [#9 Extension Guidelines](#9-extension-guidelines)
first.

If you are **reviewing a change**, start with
[#7 Ownership Rules](#7-ownership-rules) and
[#8 Change Propagation](#8-change-propagation).

If you are **understanding the system end-to-end**, read sections
[2](#2-architectural-goals) through [6](#6-module-overview) in order.

---

## 2. Architectural Goals

The goal of `web-renderer` is to split the medical image rendering application
into several stable responsibilities, each with a single owner and a well-defined
mutation boundary:

| Layer               | Responsibility                                |
| ------------------- | --------------------------------------------- |
| Data facts          | CPU-side medical data and metadata            |
| Runtime services    | Application state ownership and lifecycle     |
| Commands            | Explicit mutation boundary                    |
| Tools and input     | User input interpretation                     |
| Renderers           | GPU resources and drawing                     |
| React entry         | UI composition and wiring                     |

### Core Principle

> Medical data facts, interaction intent, state changes, and GPU rendering must
> not be mixed into the same object.

This separation allows new data types, interaction tools, rendering backends, or
plugin systems to be added later without rewriting the entry point.

---

## 3. System Layers

```text
+-------------------------------------------------------------+
|  React Entry (UI composition, DOM wiring)                   |
+-------------------------------------------------------------+
                          |
                          v
+-------------------------------------------------------------+
|  Input Router  ->  Tool Controller  ->  Selected Tool       |
+-------------------------------------------------------------+
                          |
                          v
+-------------------------------------------------------------+
|  Command Dispatcher (the only mutation boundary)            |
+-------------------------------------------------------------+
                          |
                          v
+-------------------------------------------------------------+
|  Services:  Scene  |  Viewport  |  Render  |  Segmentation |
+-------------------------------------------------------------+
                          |
              +-----------+-----------+
              v                       v
+----------------------+   +--------------------------+
|  Scene (data facts)  |   |  Render State (view)     |
+----------------------+   +--------------------------+
              |                       |
              +-----------+-----------+
                          v
+-------------------------------------------------------------+
|  Renderer  ->  PreparedScene  ->  GPU resources / canvas    |
+-------------------------------------------------------------+
```

Layers above only call layers below. Layers below never call back into layers
above.

---

## 4. Main Data Flow

The end-to-end flow from user input to a rendered pixel is:

```text
React UI or DOM input
  -> InputRouter / UI callback
  -> ToolController or direct command execution
  -> CommandDispatcher
  -> SceneService / ViewportService / SegmentationService
  -> SceneChangeSet or render-state update
  -> RenderService
  -> Renderer
  -> GPU resources and canvas output
```

### 4.1 Invariants

The flow has two invariants that all code must respect:

1. **The UI must not directly modify the `Scene`, GPU textures, or the renderer
   cache.** All mutations go through a service, typically via a command.
2. **The Renderer does not own medical data facts.** It only derives GPU
   resources from the `Scene` and viewport render state.

Violations of these invariants cause stale GPU caches and undefined behavior
during invalidation. They are caught in code review.

---

## 5. Architecture Decisions

Each decision is recorded as an Architecture Decision Record (ADR) with a
stable ID, status, and explicit consequences.

### ADR-01 Scene Is the CPU-Side Source of Truth

| Field        | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| ID           | ADR-01                                                         |
| Status       | Accepted                                                       |
| Affects      | Scene model, all renderers                                     |

**Context.** Medical data has long lifetimes and may be observed by several
viewports simultaneously. Render resources, by contrast, are cheap to recreate
and may be invalidated at any time. Mixed ownership makes invalidation unsafe.

**Decision.** `Scene` is the long-lived CPU-side container for data facts. It
holds volumes, segmentations, and their spatial metadata. It does not hold
canvas, GPU textures, DOM state, or transient tool state.

**Consequences.**

- Medical data has stable ownership; render resources can be freely recreated.
- Scene mutations are described as typed `SceneChangeSet` records.
- Multiple viewports may observe the same `Scene` without copying voxel data.

### ADR-02 Scene Mutations Must Go Through Transactions

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| ID           | ADR-02                                               |
| Status       | Accepted                                             |
| Affects      | Scene API, RenderService                             |

**Context.** Implicit mutations make it impossible to invalidate renderer caches
efficiently and to observe what changed.

**Decision.** `Scene.transaction` produces a `SceneChangeSet`. Mutations are
not implicit; they are recorded as semantic events such as `volume.added`,
`volume.changed`, and `segmentation.changed`.

**Consequences.**

- The renderer can perform incremental invalidation based on the change set
  instead of assuming every GPU resource must be rebuilt.
- Subscribers can react to specific change kinds.
- It is impossible to mutate `Scene` data without producing an observable
  record.

### ADR-03 GPU Resources Are Derived Cache

| Field        | Value                              |
| ------------ | ---------------------------------- |
| ID           | ADR-03                             |
| Status       | Accepted                           |
| Affects      | Renderer, PreparedScene            |

**Context.** If the canvas holds GPU caches whose lifecycle is decoupled from
the underlying data, stale pixels can persist after the data is replaced or
closed.

**Decision.** GPU objects such as `PreparedScene` and textures are caches
derived from the `Scene`. They can be released and rebuilt, and are not the
owners of medical facts.

**Consequences.**

- The correct path is: mutate the `Scene` first, then have the `RenderService`
  translate the change into renderer invalidation.
- The renderer can be destroyed at any time without losing data.
- GPU caches must be invalidated through `SceneChangeSet`; they must not be
  updated behind the renderer's back.

### ADR-04 Viewport State Is Separate from Scene Data

| Field        | Value                                              |
| ------------ | -------------------------------------------------- |
| ID           | ADR-04                                             |
| Status       | Accepted                                           |
| Affects      | Viewport model, render state                       |

**Context.** "What the data is" and "how it is viewed" are different concerns.
Coupling them prevents multiple viewports from sharing the same volume with
different cameras, windowing, or overlays.

**Decision.** The Viewport and render state describe "how to view the data,"
not "what the data is." The camera, plane, windowing, and overlay selection
belong to view state, not to the `Scene`.

**Consequences.**

- Multiple viewports may share the same volume with different view parameters.
- View state changes do not emit `SceneChangeSet` events; they trigger a
  `requestRender` on the affected viewport only.

### ADR-05 Commands Are the Mutation Boundary

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| ID           | ADR-05                                               |
| Status       | Accepted                                             |
| Affects      | CommandDispatcher, all services                      |

**Context.** When UI handlers, tools, and future automation all mutate services
directly, mutation logic becomes duplicated and untestable.

**Decision.** `CommandDispatcher` is the unified entry point for application
state mutations. Tools, menus, and buttons express user intent; commands perform
the actual mutations.

**Consequences.**

- The same operation can be triggered from the UI, a tool, or future automation.
- Mutation logic stays testable and discoverable in one place.
- Services are injected explicitly through `CommandContext`.
- Command history and undo/redo can be added around command execution without
  changing callers.

### ADR-06 Tools Interpret Input but Do Not Own Data

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| ID           | ADR-06                                               |
| Status       | Accepted                                             |
| Affects      | Tool framework, InputRouter                          |

**Context.** DOM events, Scene mutations, and renderer APIs are three different
abstractions. Coupling them inside a tool makes new interaction models hard to
add.

**Decision.** The Tool layer interprets pointer, wheel, and keyboard events
into application intent. A tool may read context, dispatch commands, and update
transient UI state, but does not directly own medical data or GPU resources.

**Consequences.**

- Interaction logic can be extended without touching `Scene` or the renderer.
- Tool bindings and gesture lifecycles are testable in isolation.
- Tools may not bypass `CommandDispatcher` to mutate services.

### ADR-07 Services Replace the Former God Object

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| ID           | ADR-07                                               |
| Status       | Accepted                                             |
| Affects      | Top-level application composition                    |

**Context.** A single object that owns facts, caches, viewports, and rendering
scheduling hides dependencies and creates cyclic imports.

**Decision.** The project is split into multiple services, each owning a single
category of responsibility. The responsibilities are not allowed to be merged
back together.

**Consequences.**

| Service             | Owns                                                        |
| ------------------- | ----------------------------------------------------------- |
| `SceneService`      | The active `Scene` reference; creates scenes and applies transactions. |
| `ViewportService`   | Viewport objects and render-state objects; lookup and lifecycle. |
| `RenderService`     | Renderer instance and prepared-scene cache; translates `SceneChangeSet` to invalidation; batches render requests. |
| `SegmentationService` | Segmentation-related application state; controlled labelmap mutation helpers. |

### ADR-08 Rendering Is Request-Based, Not Continuous

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| ID           | ADR-08                                               |
| Status       | Accepted                                             |
| Affects      | RenderService                                        |

**Context.** Continuous per-frame rendering wastes GPU time when nothing has
changed. Polling-driven rendering also hides the moment a render is needed.

**Decision.** State changes request the next frame through `requestRender`.
Multiple requests are coalesced into a single `requestAnimationFrame` flush.

**Consequences.**

- Interactions remain responsive without burning GPU time on idle frames.
- State changes that happen before the flush are reflected in the next render.
- A flush renders each pending viewport at most once, even after a burst of
  repeated requests for the same viewport.

### ADR-09 Imported Labelmaps Must Match Their Source Volume

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| ID           | ADR-09                                               |
| Status       | Accepted                                             |
| Affects      | IO layer, segmentation service                       |

**Context.** A labelmap defines a value per voxel of its source volume. If
shape or affine does not match the source volume, the renderer would have to
resample or guess spatial relationships in shaders.

**Decision.** A labelmap segmentation must be created from a source volume and
inherit an exactly matching shape and affine. If externally loaded data does
not match the source volume, the application refuses to create the segmentation.

**Consequences.**

- Spatial facts stay in the data layer.
- The renderer and shaders are never required to correct inconsistent data.
- External formats that cannot match a source volume must be reoriented or
  resampled at the IO layer before being accepted.

### ADR-10 WebGPU Type Constraints Stay at the Boundary

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| ID           | ADR-10                                               |
| Status       | Accepted                                             |
| Affects      | Data model, GPU upload path                          |

**Context.** WebGPU resources require explicit GPU formats and buffer / texture
layouts. Premature binding to a particular texture format would prevent
swapping renderers or running on different hardware.

**Decision.** The CPU data layer keeps typed arrays and affine information for
medical data. Conversion to a specific texture format happens only at the GPU
upload boundary.

**Consequences.**

- The data model is not tied to any shader or texture format.
- Swapping a renderer does not require changing data classes.
- The upload path is the only place that needs to know about WebGPU types.

---

## 6. Module Overview

### 6.1 Entry and UI

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/mpr.tsx`, `src/style.css`, `mpr.html`        |
| Owns         | UI composition, runtime service creation, command and tool registration, DOM-to-InputRouter wiring, scene browser, viewport overlays |

The entry point assembles the system. It is not a long-lived owner of business
state. Long-lived facts go into the `Scene` or a service; transient display
state may stay in React.

### 6.2 Scene Model

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/scene.ts`, `src/volume.ts`, `src/segmentation.ts` |
| Owns         | CPU-side data facts, voxel arrays, spatial transforms, ownership validation, typed `SceneChangeSet` records, coordinate conversion |

- `Scene` is the aggregate root for data facts.
- `ScalarVolume` represents a scalar voxel volume.
- `LabelmapSegmentationData` represents labelmap data and must be associated
  with a source volume.

### 6.3 IO Layer

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/io/nifti.ts`                                 |
| Owns         | External file parsing, conversion to internal volume or segmentation facts, shape / typed array / affine preservation |

The IO layer only translates external formats into internal data structures.
It does not open viewports, perform rendering, or modify tool state.

### 6.4 Services

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/services/sceneService.ts`, `src/services/viewportService.ts`, `src/services/renderService.ts`, `src/services/segmentationService.ts` |

Each service has a single responsibility:

| Service                | Responsibility                                                       |
| ---------------------- | -------------------------------------------------------------------- |
| `SceneService`         | Owns the active `Scene` reference; creates scenes and applies transactions. |
| `ViewportService`      | Owns viewport objects and render-state objects; provides lookup and lifecycle. |
| `RenderService`        | Owns the renderer instance and prepared-scene cache; translates `SceneChangeSet` into renderer invalidation; batches render requests. |
| `SegmentationService`  | Owns segmentation-related application state; provides controlled labelmap mutation helpers. |

Services are long-lived runtime objects. They can be called by commands and
queried by the UI, but their responsibilities must not be merged back together.

### 6.5 Commands

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/commands/commandDispatcher.ts`, `src/commands/sceneCommands.ts`, `src/commands/mprCommands.ts`, `src/commands/segmentationCommands.ts` |
| Owns         | Named operations, mutation coordination through `CommandContext`, render scheduling, hiding operation details from tools and UI |

A Command is the boundary between "user intent" and "state mutation." The UI
and tools should prefer to invoke commands rather than directly chain multi-step
service operations.

Validation may happen inside the command, or in the model, IO layer, or service
that owns the relevant invariant. The command is responsible for coordinating
those checks and applying the resulting state change through the proper service
boundary.

### 6.6 Tool and Input Framework

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/tools/toolInput.ts`, `src/tools/tool.ts`, `src/tools/toolRegistry.ts`, `src/tools/toolGroupService.ts`, `src/tools/toolController.ts`, `src/tools/inputRouter.ts`, `src/tools/mprTools.ts` |
| Owns         | DOM input normalization, tool interfaces and bindings, tool factory registration, tool group attachment, tool selection per input event, gesture lifecycle, conversion to command execution or transient UI feedback |

The focus of the Tool framework is not a specific tool; it is separating input
response from React canvas handlers. This allows new tool types, binding
strategies, or plugin registration approaches to be added later.

### 6.7 Viewport Model

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/viewport.ts`, `src/mpr/mprState.ts`          |
| Owns         | Canvas-backed viewport facts, viewport size and pixel ratio, render state used by the renderer, separation of viewing parameters from `Scene` data |

The Viewport does not own medical data. It is the renderer's output target and
the attachment point for render state.

### 6.8 MPR Renderer Module

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/mpr/mprRenderer.ts`, `src/mpr/mprMath.ts`, `src/mpr/shaders/mpr.wgsl` |
| Owns         | GPU resource preparation from `Scene`, prepared-scene resource cache, viewport output drawing from render state, shared math for coordinate conversion and sampling |

The Renderer module may read the `Scene` and render state, but must not become
the owner of `Scene` facts. The renderer's internal cache must be invalidated
and rebuilt through `SceneChangeSet`.

### 6.9 PBR Renderer Module

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Files        | `src/pbr.ts`, `src/pbr/*`                         |
| Owns         | Path-tracing and physically based rendering code, renderer-specific data structures, renderer-specific shader code, separation from MPR-specific state |

PBR and MPR are different rendering backends. They may share the underlying
data model, but should not share renderer-internal state.

---

## 7. Ownership Rules

### 7.1 What Each Layer Owns

| Layer               | Owns                                                            |
| ------------------- | --------------------------------------------------------------- |
| `Scene`             | Volume facts, segmentation facts, CPU voxel arrays, affine and coordinate facts |
| `ViewportService`   | Viewport registry, render-state registry                       |
| `RenderService`     | Renderer instance, prepared-scene cache, pending render queue   |
| `ToolController`    | Active gesture state                                            |
| React               | Presentation state, user-facing component composition           |

### 7.2 Ownership That Is Intentionally Avoided

| Layer   | Must not own                                                  |
| ------- | ------------------------------------------------------------- |
| Tools   | Scene data                                                    |
| React   | GPU resources                                                 |
| Scene   | Canvas or renderer state                                      |
| Renderer | Authoritative medical facts                                  |
| Commands | Long-lived state                                             |

---

## 8. Change Propagation

### 8.1 Scene-Level Change

```text
Command
  -> SceneService.applyTransaction
  -> SceneChangeSet
  -> RenderService.applySceneChangeSet
  -> prepared-scene invalidation
  -> request affected viewports
```

### 8.2 Viewport Render-State Change

```text
Command
  -> ViewportService.setRenderState
  -> RenderService.requestRender(viewportId)
```

### 8.3 Input-Driven Change

```text
DOM event
  -> InputRouter
  -> ToolController
  -> selected Tool
  -> CommandDispatcher
```

This keeps mutation, invalidation, and rendering as three observable steps
that can be logged, tested, and reasoned about independently.

---

## 9. Extension Guidelines

When adding a new feature, choose the layer by ownership:

| You are adding...                | Belongs in...                                          |
| -------------------------------- | ------------------------------------------------------ |
| A new persistent medical fact    | `Scene` model and `SceneChangeSet`                     |
| A new operation                  | A command                                              |
| A new user interaction           | A tool and its binding                                 |
| A new runtime owner              | A new service, only if it has a stable long-lived responsibility |
| A new GPU representation         | The renderer and the `PreparedScene` invalidation path |
| A new file format                | The IO layer                                           |

### 9.1 Anti-Patterns

- Do not add feature logic directly to the React entry unless it is purely
  presentation.
- Do not add renderer code that silently changes CPU-side data facts.
- Do not introduce a service whose lifetime is tied to a single command.
- Do not let a tool mutate `Scene` data without going through a transaction.

---

## 10. Glossary

| Term                  | Meaning                                                                          |
| --------------------- | -------------------------------------------------------------------------------- |
| `Scene`               | CPU-side aggregate of all medical data facts owned by the application.           |
| `SceneChangeSet`      | Typed record of mutations applied to a `Scene` in one transaction.               |
| `PreparedScene`       | GPU-side cache derived from a `Scene`.                                           |
| Render state          | View parameters (camera, plane, windowing, overlays) for a single viewport.      |
| `CommandDispatcher`   | The only mutation boundary between tools or UI and services.                     |
| `CommandContext`      | The object passed to commands, exposing services and render scheduling.          |
| Affine                | The 4x4 matrix describing voxel-to-world mapping for a volume.                   |
| Labelmap              | A per-voxel integer segmentation aligned to a source volume.                     |

---

## 11. Current Non-Goals

The current architecture leaves room for these future systems, but does not
require them yet:

- Plugin runtime
- Command history and undo/redo
- Multi-scene workspace
- Cross-renderer synchronization service
- Server-backed workflow sessions
- Full annotation framework

They should be added only when their ownership and lifecycle are clear enough
to fit the existing service, command, and `Scene` boundaries.

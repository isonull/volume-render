# UI MVP Design

| Field | Value |
| ----- | ----- |
| Version | v0.04 |
| Status | Proposal |
| Scope | UI shell, information architecture, extension contribution placement |
| Inspiration | VS Code workbench: menubar, activity bar, primary side bar, secondary side bar, panel, status bar |
| Non-goal | Pixel-perfect visual design or full implementation plan |

## 1. Summary

The current `web-renderer` UI has functional controls but no formal product UI
design. v0.04 introduces a VS Code-style workbench shell as the UI MVP. The goal
is to give medical imaging workflows a stable layout vocabulary while preserving
the existing extension architecture.

The MVP shell has these regions:

```text
+-----------------------------------------------------------------------+
| Menubar                                                               |
+---+----------------------+-----------------------------+--------------+
| A | Primary Side Bar     | MPR Editor Area             | Secondary    |
| c |                      |                             | Side Bar     |
| t |                      |                             |              |
| i |                      |                             |              |
| v |                      |                             |              |
| i +----------------------+-----------------------------+--------------+
| t | Panel                                                                  |
| y |                                                                        |
+---+-------------------------------------------------------------------+
| Status Bar                                                            |
+-----------------------------------------------------------------------+
```

The shell should feel like an operational medical imaging tool: dense,
predictable, restrained, and optimized for repeated workflows.

## 2. Design Goals

- Give the application stable regions for navigation, scene management,
  segmentation management, workflow tools, logs, and status.
- Make extension UI contributions first-class citizens of the shell.
- Keep `mpr.tsx` as a composition layer rather than a feature-specific UI owner.
- Keep the MPR viewport area visually dominant.
- Support a clear progression:
  `open volume -> create/open segmentation -> choose segment -> choose workflow -> edit -> exit workflow`.
- Preserve keyboard/mouse-focused work without forcing modal dialogs for common
  actions.

## 3. Workbench Regions

### 3.1 Menubar

Purpose: top-level application commands.

MVP contents:

| Menu | Items |
| ---- | ----- |
| File | Open Volume, Open Segmentation, Close Volume, Close Segmentation |
| View | Reset View, Center Active Volume, Toggle Primary Side Bar, Toggle Secondary Side Bar, Toggle Panel |
| Segmentation | New Segmentation, Add Segment, Delete Segment |
| Tools | Navigate, Brush, nnInteractive |
| Help | About, Diagnostics |

MVP behavior:

- Menubar commands dispatch existing commands or extension actions.
- Menubar should not own feature state.
- Menu items are disabled when prerequisites are missing.

### 3.2 Activity Bar

Purpose: primary navigation between workbench activities.

MVP activities:

| Activity | Icon concept | Opens |
| -------- | ------------ | ----- |
| Explorer | files/tree | Primary Side Bar: Scene |
| Segmentation | label/brush | Primary Side Bar: Segmentation |
| AI | spark/target | Secondary Side Bar or tool panel focus for AI workflows |
| Settings | gear | Primary Side Bar: Settings |

MVP behavior:

- Activity Bar is vertical and always visible on desktop.
- Only one primary activity is active at a time.
- Activity selection changes Primary Side Bar content, not viewport state.
- Activity Bar does not replace interaction modes. Interaction modes still live
  in the tool system.

### 3.3 Primary Side Bar

Purpose: persistent navigation and resource management.

MVP views:

| View | Content |
| ---- | ------- |
| Scene | Volumes and segmentations tree, context menus |
| Segmentation | Active segmentation, segment list, add segment, segment context menu |
| Settings | Rendering defaults, server URL defaults, UI preferences |

The existing Scene browser should move here. The existing Segmentation panel
should become a Primary Side Bar view instead of an unstructured right-side
control block.

Segmentation view MVP:

```text
Segmentation
  Active: <segmentation id>
  [+] Add Segment

  Label 1  <color>  name
  Label 2  <color>  name
```

Segment row context menu:

```text
Brush
nnInteractive
Delete
```

### 3.4 Editor Area

Purpose: central medical image workspace.

MVP contents:

- 2x2 MPR layout:
  - Axial
  - Coronal
  - Sagittal
  - Empty or future 3D viewport
- Each viewport has a compact viewport toolbar:
  - orientation label
  - flip horizontal
  - flip vertical
  - reset view
  - optional overlay visibility

MVP behavior:

- Editor Area is the most visually dominant region.
- Viewport state remains per viewport through `MprRenderState`.
- Viewport toolbar commands target only that viewport.
- Context-sensitive overlays such as brush preview and probe info remain
  viewport-local.

### 3.5 Secondary Side Bar

Purpose: contextual workflow details and transient tool configuration.

MVP use:

| Context | Secondary Side Bar content |
| ------- | -------------------------- |
| No active workflow | Hidden or compact inspector |
| Brush workflow | Brush Tool Panel |
| nnInteractive workflow | nnInteractive Tool Panel |
| Future workflow | Extension-contributed tool panel |

This is the preferred long-term location for workflow tool panels. The current
implementation renders tool panels inside the Segmentation panel. v0.04 should
move toward a named Secondary Side Bar host slot while keeping the same
`ExtensionToolPanelContribution` contract.

Tool panel requirements:

- Must show target context, such as segmentation id and label.
- Must provide `Exit Tool`.
- May provide destructive or session lifecycle actions such as `Release
  Session`, but those must be visually distinct from `Exit Tool`.
- Must disable actions when prerequisites are missing.

### 3.6 Panel

Purpose: bottom workbench region for output that is not part of the primary
workflow controls.

MVP tabs:

| Tab | Content |
| --- | ------- |
| Problems | Validation errors and failed commands |
| Output | Runtime messages, loader messages, proxy/server messages |
| Jobs | Long-running operations such as upload, prediction, conversion |
| Diagnostics | WebGPU limits, active adapter, memory-related messages |

MVP behavior:

- Panel is collapsible.
- Status Bar summarizes important panel state.
- Panel content should be append-only or event-driven; it should not own
  workflow state.

### 3.7 Status Bar

Purpose: persistent low-height status and mode summary.

MVP segments:

| Segment | Example |
| ------- | ------- |
| Active volume | `reference.nii.gz` |
| Active segmentation | `reference-segmentation` |
| Active segment | `Label 2` |
| Interaction mode | `Navigate`, `Brush`, `AI+ Point` |
| Server/session | `nnInteractive ready`, `busy`, `offline` |
| Voxel readout | `IJK 120, 44, 19` |
| GPU/backend | `WebGPU` |

MVP behavior:

- Status Bar should not contain large controls.
- Clicking a status segment may focus the relevant side bar or panel.
- It should make hidden long-lived state visible, especially active segment and
  nnInteractive session state.

## 4. Extension Contribution Mapping

The VS Code-style shell does not replace the extension architecture. It gives
host slots names that map onto the existing contribution types.

| Contribution | MVP shell host |
| ------------ | -------------- |
| `ExtensionPanelContribution` | Primary Side Bar view or app-level side view |
| `ExtensionToolPanelContribution` | Secondary Side Bar workflow panel |
| `SceneActionContribution` | Scene tree context menu |
| `SegmentActionContribution` | Segment list context menu |
| `commands` | Menubar, context menus, toolbars, tools |
| `tools` | Interaction mode system and viewport input routing |
| `services` | Runtime state and external sessions |

Required architectural rule:

```text
UI shell decides where contributions appear.
Extensions decide what capability they contribute.
Commands/services decide how state changes.
```

## 5. MVP Workflows

### 5.1 Open Volume

```text
File > Open Volume
  -> command opens volume
  -> Scene activity becomes available
  -> Editor Area centers volume in MPR viewports
  -> Status Bar shows active volume
```

### 5.2 Create Segmentation

```text
Scene tree volume right click > New Segmentation
  -> create empty labelmap for that volume
  -> set active segmentation
  -> show Segmentation activity/view
  -> overlay active segmentation in viewports
```

### 5.3 Brush Segment

```text
Segmentation view > segment right click > Brush
  -> set active segmentation and segment label
  -> open Brush Tool Panel in Secondary Side Bar
  -> activate brush interaction mode
  -> Exit Tool returns to Navigate
```

### 5.4 nnInteractive Segment

```text
Segmentation view > segment right click > nnInteractive
  -> set active segmentation and segment label
  -> open nnInteractive Tool Panel in Secondary Side Bar
  -> user starts or reuses one global nnInteractive session
  -> prompt tools write foreground to the target segment label
  -> Exit Tool returns to Navigate without releasing session
  -> Release Session explicitly closes server lease
```

### 5.5 Inspect Errors

```text
Failed command / server error / WebGPU warning
  -> Status Bar shows compact warning
  -> Panel > Problems or Output contains details
```

## 6. Initial Layout Defaults

Desktop default:

| Region | Default |
| ------ | ------- |
| Menubar | Visible |
| Activity Bar | Visible |
| Primary Side Bar | Visible, Scene activity selected |
| Editor Area | 2x2 MPR grid |
| Secondary Side Bar | Hidden until workflow opens |
| Panel | Hidden until output/problem appears |
| Status Bar | Visible |

Suggested initial sizes:

| Region | Size |
| ------ | ---- |
| Activity Bar | 44 px |
| Primary Side Bar | 280-340 px |
| Secondary Side Bar | 320-380 px |
| Panel | 180-260 px |
| Status Bar | 24 px |

Responsive MVP:

- On narrow screens, Primary and Secondary Side Bars become overlay drawers.
- The Editor Area remains the main content.
- Panel can become a full-width bottom drawer.

## 7. Interaction and Selection Rules

- Selection is not the same as activation.
- Active volume drives viewport initialization and status.
- Active segmentation drives segment list and overlay defaults.
- Active segment drives brush and nnInteractive target label.
- Active tool panel is a singleton workflow surface.
- Interaction mode controls viewport input handling.
- Exit Tool always returns to `core.navigate`.
- Release Session is explicit and separate from Exit Tool.

## 8. Visual Direction

MVP visual tone:

- dark neutral workbench
- small, dense controls
- 6-8 px radius maximum
- restrained borders and separators
- clear active/selected/focused states
- no marketing-style hero layout
- no decorative gradients or large cards

Avoid:

- nested cards
- large explanatory text blocks inside the app
- feature descriptions in the viewport area
- workflow controls floating over image content except compact viewport toolbar

## 9. Required Host Slots

v0.04 should name the UI host slots explicitly:

```ts
type UiHostSlot =
  | 'menubar'
  | 'activityBar'
  | 'primarySideBar'
  | 'secondarySideBar'
  | 'editor'
  | 'panel'
  | 'statusBar'
```

The first implementation does not need to expose all slots to extensions. It
does need to make these layout regions explicit in React structure and CSS.

Minimum formal slots for extension UI:

| Slot | Extension contribution |
| ---- | ---------------------- |
| Primary Side Bar | `ExtensionPanelContribution` |
| Secondary Side Bar | `ExtensionToolPanelContribution` |
| Scene tree context menu | `SceneActionContribution` |
| Segment row context menu | `SegmentActionContribution` |

## 10. MVP Implementation Phases

### Phase 1: Shell Skeleton

- Add workbench root layout.
- Create Menubar, Activity Bar, Primary Side Bar, Editor Area, Secondary Side
  Bar, Panel, Status Bar components.
- Move existing MPR grid into Editor Area.
- Move scene browser into Primary Side Bar.
- Move segmentation panel into Primary Side Bar.

### Phase 2: Contribution Placement

- Render app panels in Primary Side Bar views.
- Render tool panels in Secondary Side Bar.
- Keep scene actions in Scene tree context menu.
- Keep segment actions in Segment list context menu.
- Keep `mpr.tsx` as shell composition only.

### Phase 3: Workflow Polish

- Normalize button styles, toolbars, menu states, empty states, disabled states.
- Add status bar summaries for active volume, active segmentation, active
  segment, interaction mode, and nnInteractive session.
- Add panel tabs for Output and Problems.

### Phase 4: Documentation and Tests

- Update `architecture.md` if host slots become code-level public interfaces.
- Add lightweight component or fixture tests for contribution placement.
- Add screenshot checks after a dev server is launched manually.

## 11. Acceptance Criteria

- User can open a volume from Menubar or existing file input path.
- User can create a segmentation from the Scene tree.
- User can select a segment and open Brush from its context menu.
- User can select a segment and open nnInteractive from its context menu.
- Brush and nnInteractive panels appear in the workflow area, not as unrelated
  global controls.
- Exit Tool always returns to Navigate.
- Status Bar always shows active volume, segmentation, segment, and interaction
  mode when available.
- Scene browser actions and segment actions remain separate contribution
  surfaces.
- Existing MPR viewport interactions continue to work.

## 12. Open Questions

- Should the Secondary Side Bar be right-side only, or allow switching with the
  Primary Side Bar?
- Should `ExtensionPanelContribution` declare a preferred activity, such as
  `scene`, `segmentation`, or `settings`?
- Should status bar items become their own formal contribution type?
- Should Menubar items become formal command contributions, or remain host-owned
  command shortcuts in the MVP?
- Should Panel tabs be formal contributions in v0.05?


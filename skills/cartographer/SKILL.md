---
name: cartographer
description: Turn a codebase into an interactive isometric architecture map published as a self-contained HTML artifact. Blocks are sized by real line counts and colored by zone, edges carry animated payload dots, and the page has a structure rail, an explainer/legend panel, go-inside drill-downs, and a step-by-step request trace. Use when the user says "make a cartographer map", "make one for my codebase", "turn this repo into a visual diagram", "isometric codebase map", or "visual map of the architecture". Also use to update or extend an existing cartographer map. Not for single mechanism diagrams inside a prose answer (draw inline SVG), Mermaid/flowchart requests, or UI mockups of the product itself.
---

# Cartographer

Produce a single self-contained HTML page (no external deps, CSP-safe) that maps a repository as
an isometric city: blocks sized by real line counts, edges carrying animated data dots, a left
structure rail, and a right WHAT IT DOES / HOW IT'S BUILT panel. Publish it as an artifact.

The design language is: each subsystem is a **building** (height ∝ lines of code), grouped into
**zones** by color, with **storage as flat slabs** and **external systems as off-map labels** with
dashed leaders. Control/data paths are **L-elbow circuit traces**; a moving dot carries the payload
name on hover. Keep it readable — roofs carry the label, nothing spills below a block's base.

## Step 1: Inventory the repo (facts, not guesses)

Spawn an Explore agent (very thorough) asking for a structured inventory:

- 15-35 major subsystems, each with: short name, directory/key files, 1-2 plain-English sentences
  for a non-expert, rough size (files or LOC), and what it talks to (directed edges with what flows).
- Overall request flow, databases/storage, headline stats (total LOC, routers/routes, feature
  counts, test files, deployed services).
- Ask it to correct your assumed subsystem list, and to distinguish deployed **services** from
  code-level **roles**.

Every number shown in the map must come from this scan. Never invent counts.

## Step 2: Build from the template engine

Copy `references/cartographer-template.html` into the session scratchpad and keep the engine. Replace only
the DATA section, which is clearly delimited by `/* ===== DATA ==== */` and
`/* ===== END DATA ==== */` near the top of the script:

- `GROUPS`: `{id, name, hue, desc}` — the color zones (surface, interface, core domain, bridge, …).
- `STRUCTURES`: `{id, code, name, group, gx, gy, w, d, loc, what, how, talks[], files[], children[]?, slab?, h?}`.
  - `loc` is a **number** (lines of code). Height is computed as
    `max(1, min(5, round(sqrt(loc)/10)))`; pass `h` to override, `slab:true` for flat storage.
  - `files[]` is shown in the inspector panel.
  - `children[]` (for go-inside views): `{c, n, l, what, gx, gy, w, d, loc, f}`
    (`c` = 2-char code, `n` = name, `l` = loc label, `what` = one-liner, `f` = file).
- `EDGES`: `{f, t, pay, dashed?, via?, flow?}` — `pay` names what travels (hover a dot),
  `dashed:1` for advisory/CI edges, `via:[[gx,gy]...]` to route around clusters,
  `flow` = number of dots (default 1).
- `EXTERNALS`: `{id, name, sub, gx, gy, target, pay, dashed?}` — off-map labels with dashed leaders.
- `TRACE`: 10-14 `{s, t}` steps — `s` is a struct id, `t` is an HTML sentence walking one canonical
  request end to end.
- Topbar stats, sidebar `GROUPS`, and the two overview essays (`OVERVIEW_WHAT`, `OVERVIEW_HOW`).

Layout rules that make it read well:

- Iso projection is `x=(gx-gy)*26, y=(gx+gy)*13 - h*16` (EX/EY/EZ in the engine). Painter order
  sorts by `gx+gy` so nothing needs z-hacks.
- Cluster by zone: browser surfaces top, API below them, agent right, ingestion left, core domain
  center, compute below it, storage slabs bottom row, CI in a corner.
- Keep block 3D bounding boxes disjoint. A block's roof projects **up** by `h*16/13 ≈ 1.23h` grid
  units, so the row gap must exceed that or tall roofs will overlap the row in front. Check with a
  grid-unit AABB test: `xMin=gx-gy-d, xMax=gx-gy+w`, `yMin=gx+gy-1.23h, yMax=gx+gy+w+d`.
- Biggest subsystem = tallest block. Storage = flat slabs. The eye should find the core domain in
  the middle. Roofs carry the 2-char code + name (no labels below the base — they collide).
- Keep external labels clear of every block (a deep block at high `gy` projects further left than
  its shallow neighbors) and clear of each other; keep `sub` text short.

## Step 3: Verify headlessly before publishing

The template has URL-hash debug hooks: `#inside=<id>` and `#trace=<n>`. Screenshot at 1800x1000
with `npx --yes playwright screenshot` against `file://...` for at least the default view, one
`#inside=<id>` view, and `#trace=7`. Check for block overlap (query every `.block`'s `getBBox()`),
label collisions, external labels clipping, and edges slicing through clusters. Fix, reshoot, then
publish the artifact (favicon 🗺️, keep it stable across republish).

## Step 4: Share-safety pass (always, before the user posts it)

The map may leave the company. Keep code structure (module names, LOC, stack); scrub anything
that describes live infrastructure: concrete cloud service/queue names, public endpoint paths,
API-key prefixes or formats, where credentials are stored, project IDs, resource shapes. Grep the
final file for the company's cloud naming prefix, `@`, `secret`, key prefixes, and mount paths.
Remind the user the artifact stays private until they share the file.

# dsh-scriptorium

[![CI](https://github.com/santera-pixel/dsh-scriptorium/actions/workflows/ci.yml/badge.svg)](https://github.com/santera-pixel/dsh-scriptorium/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-0e7490)](https://github.com/topics/dsh-plugin)

<img src="https://raw.githubusercontent.com/santera-pixel/dsh-scriptorium/main/docs/media/hero.png" alt="Scriptorium: a project notebook inside the DeepSeek Harness — notes, screenshots, a canvas and a mind graph in one panel" width="100%">

Scriptorium is a project knowledge base inside the DeepSeek Harness Web GUI: workspaces bound to
Harness projects, nested documents, a Markdown editor with live preview, full-text search, a command palette, a
kanban board, a free-form media canvas, an Obsidian-style mind graph, tags, favourites, trash and
ZIP/JSON archives — all stored in one JSON file on the host that this plugin owns.

The panel lives in the sidebar (book icon, "Scriptorium"). Everything else is one keystroke away.

## What it looks like

| | |
| --- | --- |
| <img src="https://raw.githubusercontent.com/santera-pixel/dsh-scriptorium/main/docs/media/workspace.png" alt="Documents view: note tree on the left, Markdown editor and live preview in the middle"> | <img src="https://raw.githubusercontent.com/santera-pixel/dsh-scriptorium/main/docs/media/media.png" alt="Media sandbox: every attachment in the project as a preview card"> |
| **Documents** — nested notes, split editor and a live preview, tags and status in the header. | **Media sandbox** — every screenshot, PDF and clip in the project, filterable by kind. |
| <img src="https://raw.githubusercontent.com/santera-pixel/dsh-scriptorium/main/docs/media/canvas.png" alt="Media canvas: attachment cards arranged beside the notes that own them, joined by edges"> | <img src="https://raw.githubusercontent.com/santera-pixel/dsh-scriptorium/main/docs/media/graph.png" alt="Mind graph: notes as nodes and wiki links as edges, auto-fitted to the panel"> |
| **Canvas** — attachments become cards beside the note that owns them, joined by an edge. | **Mind graph** — notes are nodes, `[[wiki links]]` are edges; opens fitted to the panel. |
| <img src="https://raw.githubusercontent.com/santera-pixel/dsh-scriptorium/main/docs/media/board.png" alt="Board view: draft, active and done columns built from note statuses"> | <img src="https://raw.githubusercontent.com/santera-pixel/dsh-scriptorium/main/docs/media/search.png" alt="Command palette: fuzzy list of every action, grouped by Create, Projects, Navigate and Data"> |
| **Board** — Draft / Active / Done, straight from each note's status. | **Command palette** — `Ctrl+K`, every action one fuzzy query away. |

**In practice:**

- A design review: drop three screenshots on the note, arrange them on the canvas next to the
  brief, link them, and the graph shows which notes reference which.
- A release: every note carries a status, so the board is the plan — drag a card and the note's
  status changes on disk.
- A month later: `Ctrl+K` or search finds the note, the graph shows its neighbours, and the
  attachment is still next to the paragraph it explains.

## What you get

| Area | Behaviour |
| --- | --- |
| Organize | Workspaces → folders → nested documents, drag a document onto a folder, inline rename, reorder |
| Projects | Every notebook mirrors one Harness project from `<DSH_HOME>/storages/workspace.json`: the sidebar lists each project with its path and accent dot, sync creates/renames notebooks, a vanished project is flagged `missing` (its documents are kept), and an unlinked notebook can be linked — or merged into the existing project notebook |
| Write | Markdown editor: headings, **bold**, *italic*, ~~strike~~, `code`, links, images, tables, task lists, `::: note/tip/warning/danger` callouts, fenced code with a copy button, `$math$`, horizontal rules |
| Preview | Write / split / preview modes, task checkboxes toggle the source line, scroll sync |
| Find | `Ctrl+K` command palette (fuzzy, recency-aware) and full-text search with highlighted title/body matches and relevance ranking |
| Track | Kanban board with Draft / Active / Done columns; drag a card to change its status |
| Classify | Tags on every document, tag cloud filtering, generated per-tag colours, a per-tag view |
| Keep | Favourites, soft trash with restore, permanent purge, empty trash |
| Attachments | Upload images, PDF, audio, video and text files per document; in-app preview modal (PDF via the browser viewer); media sandbox view with kind filters |
| Canvas | Free-form media canvas: every attachment becomes a draggable, resizable card beside the document that owns it, joined by an edge; pan, wheel/button zoom, fit-to-screen, link two cards, keyboard nudging, delete a link |
| Connections | Obsidian-style mind graph: notes are nodes, `[[wiki links]]` (with `|alias` and `#heading`) and optional tags are edges; animated force layout, drag nodes, pan/zoom, search dimming, neighbour highlighting, click to open, "connect two notes" writes the link into the source note |
| Portability | Export JSON, export ZIP (manifest + Markdown notes + media bytes), import JSON (merged, never overwriting) and import ZIP (ids remapped, media stored); the canvas travels both ways and is re-pointed at the imported ids |
| Feel | Shared animation set (fade, pop, toast, tree expansion), theme-token colours only, `prefers-reduced-motion` respected |

Keyboard: `Ctrl+K` palette, `Ctrl+N` new document, `Ctrl+S` save, `Ctrl+B`/`Ctrl+I` bold/italic,
`Esc` closes overlays; shortcuts stay out of the way while the caret is inside a field.

## Storage

- Documents: `<DSH_HOME>/scriptorium/data.json` (atomic tmp+rename writes, one serialized queue,
  revision counter; oversized or malformed snapshots are rejected with a 400).
- Attachments: `<DSH_HOME>/scriptorium/media/<id>` plus a `<id>.json` sidecar with name/mime/size.
  `DSH_HOME` defaults to `~/.dsh`. A directory left by the pre-rename build (`<DSH_HOME>/alexandrie/`)
  is moved into place on first mount, so existing notes, attachments and layout survive the rename.
- Layout copy: `<DSH_HOME>/scriptorium/layout.json` holds only `canvas` + `graph` and is written
  before `data.json` on every save. A pre-canvas build rebuilds `data.json` from a fixed key list
  and never touches this file, so a downgrade cannot destroy the board: the next load merges the
  layout back (cards whose document was deleted meanwhile are pruned), and the read itself never
  rewrites `data.json`.
- Projects: the host reads `<DSH_HOME>/storages/workspace.json` (the same file the Harness
  workspace switcher uses) and returns `{ projects, defaultProjectId, directory, source, exists }`.
  The file is read-only for this plugin: notebook names/paths come from `global.workspaceIds`
  order plus `tables.workspaces` metadata, a missing file yields an empty list, a malformed one
  yields an empty list plus a warning, and `GET /projects` never touches `data.json`. The legacy
  single notebook is adopted by the default project on the first sync so existing notes are
  never stranded, and a project that disappears from the Harness stays in the sidebar flagged
  `missing` rather than being deleted.
- Archive shape is additive: a missing `canvas`/`graph` block is filled with empty defaults on load
  (95 bytes on disk), and a build never erases a top-level block it does not know, so newer
  features' data survives an older build's save.
- Imports carry the board: a ZIP import rebuilds every card and link on the freshly remapped
  document/attachment ids (dead references are dropped, repeated links deduped); a JSON import
  keeps the local layout untouched and folds the imported cards/links in, idempotently, so the
  same archive imported twice adds nothing twice.
- ZIP imports are read defensively: a single entry may decompress to at most 16 MB, the whole
  archive to 128 MB, with at most 2,000 entries and no entry past a 200:1 ratio once it passes
  1 MB, so a tiny crafted archive answers 400 `archive exceeds safety budget: <reason>` instead
  of expanding without bound.

The browser half never touches the disk: it talks to the plugin's own same-origin route
(`/dsh-scriptorium/*`) with a `{ ok, value }` / `{ ok: false, error: { message } }` envelope, the
same proven pattern as the shipped `dsh-taskboard` plugin.

Host routes: `GET /health`, `GET /state`, `GET /projects`, `POST /save`, `GET /export`,
`GET /archive/export`, `POST /archive/import`, `GET|POST /media`, `GET|DELETE /media/<id>`.

## Install

Repository: <https://github.com/santera-pixel/dsh-scriptorium>

From npm — the one-step command the DSH Plugin Hub runs:

```
dsh plugin --profile web add dsh-scriptorium
```

Straight from GitHub (works before any npm publish; npm runs this package's `prepare` script, so
the browser bundle is rebuilt during install):

```
dsh plugin --profile web add github:santera-pixel/dsh-scriptorium
```

From the Web GUI: **Settings → Plugins** and install from a package, or let the agent call
`plugin_manager` with `install_bundle` and target `dsh-scriptorium` (or a path to a local
checkout). Whichever route installs it, a page refresh is enough for a client change; the host
half (`lib/index.js`) is ESM and only reloads on a harness restart.

After installing, open the book icon in the sidebar.

## Compatibility and permissions

- DeepSeek Harness with the Web profile; the client half declares `platform: "web"` and injects
  only the `slots` service. The host half injects `webServer` and registers routes under
  `/dsh-scriptorium`.
- Node.js `>=22` (the host half is dependency-free ESM).
- No outbound network calls, no telemetry, no third-party embeds.
- Writes only under `<DSH_HOME>/scriptorium/` (`data.json`, `layout.json`, `media/`). Reads
  `<DSH_HOME>/storages/workspace.json` read-only to mirror the Harness project list.
- Caps: 12 MB per attachment, 24 MB per snapshot.

## Publishing to the DSH Plugin Hub

The hub discovers public GitHub repositories that carry the `dsh-plugin` topic and contain a root
`package.json` with an `apply(ctx)` export. To publish:

1. Push this repository to GitHub and add the **`dsh-plugin`** topic.
2. `npm publish` (the package is not `private` and sets `publishConfig.access = "public"`); the
   hub only offers one-step installs for packages that exist on npm.
3. Optionally install `dsh-plugin` and verify the listing appears under **Settings → Plugin Hub**.

## Build

No bundler and no JSX: `src/client/*.js` are plain-JavaScript parts concatenated, in filename
order, into `lib/client.js` inside the `window.__ModuleLoader__` factory wrapper.

```
node build.mjs
node --check lib/client.js
```

`lib/index.js` (host half) and `lib/zip.js` / `lib/archive.js` are plain ESM with no dependencies.

## Verification

The suites below live in `tests/` on the **`dev` branch**. The `main` branch — what GitHub shows and
what the plugin hub installs — ships without them, and the npm tarball never includes them either.

| Suite | Covers | Checks |
| --- | --- | --- |
| `tests/smoke.mjs` | model readers/mutators, markdown rendering, search ranking, store seed/save | 13 |
| `tests/render.mjs` | every component body under a React shim, all App views, media library/preview/grid, canvas and graph roots, project sidebar groups | 41 |
| `tests/crud.mjs` | create/rename/move/trash/restore/purge/workspace cascade through the real store | 10 |
| `tests/editor.mjs` | toolbar transforms, modes, task toggling, sanitising, undo-safe insert | 27 |
| `tests/interactions.mjs` | search/overlay keyboard, palette recency, board drag, tags, shortcut guards | 23 |
| `tests/canvas.mjs` | canvas geometry (bounds/fit/zoom anchor), item/link mutators, hostile snapshot sanitising, purge/media cleanup, wide-card placement | 19 |
| `tests/graph.mjs` | wiki-link parsing, graph building (tags, scope, orphans, undirected dedupe), deterministic force layout including 1000-node spread, zoom/fit maths | 13 |
| `tests/merge.mjs` | JSON archive parsing and merge semantics (no overwrite, orphan re-rooting) | 8 |
| `tests/archive.mjs` | ZIP writer/reader round-trip, archive build/parse, id remapping | 8 |
| `tests/zip-budget.mjs` | hand-built ZIPs prove the reader's safety budgets: ratio, entry-count, declared single-entry and actual single-entry bombs and a declared-total bomb all fail closed, while a legitimate multi-megabyte archive imports | 6 |
| `tests/canvas-import.mjs` | an exported board survives both import paths: ZIP remap re-points cards/links onto fresh ids, drops dangling/dead references and dedupes; JSON merge keeps the target layout, folds imported cards/links in deterministically | 9 |
| `tests/compat.mjs` | a pre-canvas `data.json` survives load→save→reload verbatim (old bytes unchanged, 95-byte block overhead, no drift); unknown top-level blocks carried through; no prototype pollution | 7 |
| `tests/downgrade.mjs` | a pre-canvas build's fixed-key rewrite of `data.json` is recovered from the layout copy on the next load: positions/sizes/links restored, document edits kept, deleted-document cards pruned, idempotent cycles, export carries the layout | 7 |
| `tests/projects.mjs` | project sync (create/adopt/rename/missing/idempotent), unsafe ids ignored, linking and merge-into-existing semantics, store project state success/failure | 11 |
| `tests/migrate.mjs` | the pre-rename data directory is moved into place on mount with documents, attachments, layout copy and revision counter intact; a second mount repeats nothing | 1 |
| `tests/http.mjs` | the real host half on a throwaway server: state/save, project mirror + malformed file, media, ZIP export/import including the board round-trip, and a bomb import answering 400 without touching the store | 18 |
| `tests/export.mjs` | Markdown and JSON download naming and payload | 3 |
| `tests/gui.mjs` | the built bundle in jsdom against a throwaway host: mount, create, type, preview, Ctrl+K, search, board move, trash/restore, settings, upload→canvas→drag→zoom, graph→connect→filter — asserting on the rendered DOM and on `data.json` | 10 |
| `tests/battle.mjs` | adversarial pass: 400-operation model fuzz with invariants, hostile canvas payloads, wiki-link abuse, 800-node layout budget, concurrent saves, traversal names, broken archives, 3000-document round-trip | 10 |
| `tests/live.mjs` | the running harness (health/state/save/conflict/export/projects) | 9 |

253 checks in total (224 node suites, 10 jsdom GUI, 10 adversarial, 9 live).

The suites live in `tests/` on the **dev** branch. `main` — what GitHub shows, what the hub
installs and what npm publishes — is `dev` minus `tests/`, so a plain checkout of `main` contains
no test code. Tests are never in the npm tarball either.

```
git switch dev        # or: git fetch origin dev && git switch dev
npm install           # jsdom + react for the DOM suites
npm test              # the fifteen node suites above
npm run test:battle   # adversarial suite only
npm run test:gui      # real DOM end to end
npm run test:live     # against the running GUI
```

`tests/live.mjs` reads the GUI URL from `DSH_WEB_URL` (it defaults to the current harness port).

To release, rebuild `main` from `dev` (the script copies `dev`'s tree, drops `tests/`, and refuses
when `main` has commits of its own, i.e. someone edited the release branch directly):

```
npm run sync:main
git push origin main dev --tags
```

## Limitations

- The GUI shell answers `401` to plain HTTP without a browser session, so visual end-to-end
  checking is manual: the automated evidence is the component tree, the host route suite and the
  slot-registration check (`main` key + `sidebar.panellist` row).
- Media previews depend on the browser: PDFs use the built-in viewer, office documents fall back
  to a download link.
- Attachments are capped at 12 MB each; the whole snapshot at 24 MB.

## License

MIT — see [LICENSE](LICENSE).

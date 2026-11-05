// Regenerates the screenshots used by the README. Not part of the shipped package and not part
// of CI: it needs Microsoft Edge (headless) and is meant to be run by hand when the UI changes.
//
//   node tests/shots.mjs
//
// It boots the real host half + the built client bundle in jsdom with a hand-written fixture
// (two projects, notes, attachments, a canvas and wiki links), serialises each view into a
// self-contained page, and lets headless Edge rasterise it at 1.5x. The result is the actual
// panel markup and stylesheet, not a mock-up.

import http from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EDGE = [
  'C:/Program Files (x86)/Microsoft/EdgeCore/156.0.4314.50/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].find((path) => existsSync(path))
if (!EDGE) throw new Error('Microsoft Edge not found; install it or edit the EDGE list')

const SAMPLE = join(process.env.TEMP || process.env.TMP || '.', 'scr-shots')
const DOCS = fileURLToPath(new URL('../docs/media/', import.meta.url))
await mkdir(DOCS, { recursive: true })

const home = await mkdtemp(join(tmpdir(), 'scr-shots-'))
process.env.DSH_HOME = home

const stamp = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
const media = {
  onboarding: { id: 'media-onboarding', name: 'onboarding.png', mime: 'image/png', size: 0, createdAt: stamp, uploadedAt: stamp },
  chart: { id: 'media-chart', name: 'sessions-chart.png', mime: 'image/png', size: 0, createdAt: stamp, uploadedAt: stamp },
  sketch: { id: 'media-sketch', name: 'canvas-sketch.png', mime: 'image/png', size: 0, createdAt: stamp, uploadedAt: stamp },
  lighting: { id: 'media-lighting', name: 'lighting-ref.png', mime: 'image/png', size: 0, createdAt: stamp, uploadedAt: stamp },
}

const brief = `Scriptorium now runs inside the harness: one panel, one JSON file, zero accounts.

## Why we built it

Notes, screenshots and sketches live in five different apps, while the project context lives in the harness. Bringing the two together is the whole point.

| Piece | State |
| --- | --- |
| Markdown notes + live preview | done |
| Media sandbox | done |
| Canvas + mind graph | done |
| Project mirroring | done |

::: tip The data file stays plain JSON, so the panel is never a lock-in.
:::

## Before launch

- [x] Bundle rebuilt and syntax-checked
- [x] Project sync tested on the real workspace file
- [ ] Hub listing with screenshots
- [ ] First-run tour

Next: [[Architecture notes]] and [[Agent memory, one library at a time]].`

const architecture = `Two halves, one route prefix.

::: note The browser half never touches the disk. It calls /dsh-scriptorium/* and renders the envelope it gets back.
:::

## Host half

- GET /state and POST /save own data.json, written through a tmp+rename swap
- GET /projects mirrors the harness project list, read-only
- media routes stream attachments straight from the library directory

## Client half

- one bundle, mounted in the panel slot
- theme tokens only, no external fonts, no outbound calls

Open questions are tracked in [[Release brief — v1.0]]; routing lives in [[Routing decision]].`

const routing = `A single route prefix beats five endpoints with different shapes.

## The decision

- /dsh-scriptorium/* owns state, projects, media and archives
- the client never builds file paths
- every failure returns { ok: false, error: { message } }

Recorded here because [[Architecture notes]] is the long version.`

const memory = `A chat forgets. A notebook does not.

The plan is boring on purpose: capture while you work, tag what matters, connect the notes that argue with each other. When a question comes back three weeks later, the answer is a search away instead of a scroll.

Three habits carry it:

1. One note per decision, written the same day.
2. Screenshots go next to the note, never into a folder called misc.
3. Link the note you will want to find again.

Nothing here needs a server. data.json is readable, exportable, and yours.`

const shortcuts = `Every shortcut the panel listens for.

| Keys | Action |
| --- | --- |
| Ctrl+K | Command palette |
| Ctrl+N | New document |
| Ctrl+S | Save now |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Esc | Close overlays |

Shortcuts stay out of the way while the caret is inside a field.`

const checklist = `Everything still open before the tag.

## Ship

- [x] rebuilt bundle
- [x] smoke, render, crud suites
- [ ] screenshots
- [ ] publish to npm

## After

- [ ] tag v1.0.0
- [ ] hub topic`

const lighting = `Morning light through the east window, bounced off the oak floor.

- [x] key light at 5600K
- [ ] fill from the hallway
- [ ] dust motes pass`

const texture = `What each surface is allowed to cost.

| Surface | Resolution |
| --- | --- |
| floorboards | 4K |
| plaster | 2K |
| fabric | 1K |`

const node = (id, workspaceId, title, content, extra) =>
  Object.assign(
    {
      id,
      workspaceId,
      parentId: null,
      kind: 'doc',
      title,
      icon: 'doc',
      status: 'draft',
      tags: [],
      favorite: false,
      trashed: false,
      order: 0,
      createdAt: stamp,
      updatedAt: stamp,
      content,
      media: [],
    },
    extra || {},
  )

const nodes = [
  node('doc-brief', 'ws-scriptorium', 'Release brief — v1.0', brief, {
    status: 'active',
    tags: ['release', 'plugin'],
    favorite: true,
    order: 0,
    media: [media.onboarding, media.chart],
  }),
  node('doc-architecture', 'ws-scriptorium', 'Architecture notes', architecture, {
    status: 'active',
    tags: ['architecture'],
    order: 1,
    media: [media.sketch],
  }),
  node('doc-memory', 'ws-scriptorium', 'Agent memory, one library at a time', memory, {
    tags: ['essay'],
    order: 2,
  }),
  node('doc-shortcuts', 'ws-scriptorium', 'Keyboard shortcuts', shortcuts, {
    status: 'done',
    tags: ['reference'],
    favorite: true,
    order: 3,
  }),
  node('doc-checklist', 'ws-scriptorium', 'Release checklist', checklist, {
    tags: ['release'],
    order: 4,
  }),
  node('doc-routing', 'ws-scriptorium', 'Routing decision', routing, {
    status: 'active',
    tags: ['architecture'],
    order: 5,
  }),
  node('doc-lighting', 'ws-living', 'Lighting pass — living room', lighting, {
    status: 'active',
    tags: ['lighting'],
    order: 0,
    media: [media.lighting],
  }),
  node('doc-texture', 'ws-living', 'Texture budget', texture, {
    tags: ['budget'],
    order: 1,
  }),
]

const canvas = {
  items: [
    { kind: 'doc', refId: 'doc-brief', x: 40, y: 40, w: 340, h: 210, z: 0 },
    { kind: 'doc', refId: 'doc-architecture', x: 440, y: 40, w: 300, h: 186, z: 1 },
    { kind: 'media', refId: 'media-onboarding', x: 40, y: 300, w: 320, h: 220, z: 2 },
    { kind: 'media', refId: 'media-chart', x: 400, y: 300, w: 320, h: 220, z: 3 },
    { kind: 'media', refId: 'media-sketch', x: 760, y: 300, w: 320, h: 220, z: 4 },
  ],
  links: [
    { id: 'link:doc:doc-brief::media:media-onboarding', from: 'doc:doc-brief', to: 'media:media-onboarding' },
    { id: 'link:doc:doc-brief::media:media-chart', from: 'doc:doc-brief', to: 'media:media-chart' },
    { id: 'link:doc:doc-architecture::media:media-sketch', from: 'doc:doc-architecture', to: 'media:media-sketch' },
  ],
}

const snapshot = {
  version: 1,
  workspaces: [
    {
      id: 'ws-scriptorium',
      name: 'Scriptorium',
      icon: 'book',
      color: 'brand',
      projectId: 'p-scriptorium',
      path: 'C:\\\\Users\\\\Santera\\\\Documents\\\\deepseek-harness\\\\default-workspace\\\\dsh-scriptorium',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'ws-living',
      name: 'LivingMiniature',
      icon: 'book',
      color: 'brand',
      projectId: 'p-living',
      path: 'C:\\\\Users\\\\Santera\\\\Documents\\\\deepseek-harness\\\\living-miniature',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
  nodes,
  settings: { view: 'list', editorMode: 'split', fontSize: 15, autoSave: true, showLineNumbers: true, sort: 'manual' },
  ui: { activeWorkspaceId: 'ws-scriptorium', activeNodeId: 'doc-brief', expanded: [] },
  canvas,
  graph: { showTags: false, showLabels: true, scopeAll: false },
}

const workspaceFile = {
  global: { defaultWorkspaceId: 'p-scriptorium', workspaceIds: ['p-scriptorium', 'p-living'] },
  tables: {
    workspaces: {
      'p-scriptorium': {
        path: 'C:\\Users\\Santera\\Documents\\deepseek-harness\\default-workspace\\dsh-scriptorium',
        title: 'Scriptorium',
        sessionIds: [],
      },
      'p-living': {
        path: 'C:\\Users\\Santera\\Documents\\deepseek-harness\\living-miniature',
        title: 'LivingMiniature',
        sessionIds: [],
      },
    },
  },
}

// ---- fixture on disk ------------------------------------------------------------------------
await mkdir(join(home, 'scriptorium', 'media'), { recursive: true })
await mkdir(join(home, 'storages'), { recursive: true })
await writeFile(join(home, 'storages', 'workspace.json'), JSON.stringify(workspaceFile, null, 2))
for (const [key, entry] of Object.entries(media)) {
  const bytes = await readFile(join(SAMPLE, key + '.png'))
  entry.size = bytes.length
  await copyFile(join(SAMPLE, key + '.png'), join(home, 'scriptorium', 'media', entry.id))
  await writeFile(join(home, 'scriptorium', 'media', entry.id + '.json'), JSON.stringify(entry))
}
await writeFile(join(home, 'scriptorium', 'data.json'), JSON.stringify({ version: 1, revision: 7, updatedAt: stamp, snapshot }, null, 2))

// ---- real host + route ----------------------------------------------------------------------
const { apply } = await import('../lib/index.js')
const routes = []
apply({ webServer: { register(route) { routes.push(route); return () => {} } }, effect() { return () => {} } })
const route = routes[0]
let snapshotHtml = '<!doctype html><html><body></body></html>'
const server = http.createServer((request, response) => {
  if (String(request.url || '').startsWith('/snapshot')) {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(snapshotHtml)
    return
  }
  Promise.resolve(route.handler(request, response)).catch((error) => {
    response.writeHead(500)
    response.end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const baseUrl = 'http://127.0.0.1:' + server.address().port

// ---- jsdom + the real bundle ---------------------------------------------------------------
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: baseUrl + '/',
  pretendToBeVisual: true,
})
const { window } = dom
const { document } = window
const THEME = `
:root {
  --dsw-alias-bg-base: #151517;
  --dsw-alias-bg-layer-1: #232324;
  --dsw-alias-bg-layer-2: #2c2c2e;
  --dsw-alias-bg-overlay: #61666b;
  --dsw-alias-border-l1: rgba(255, 255, 255, .07);
  --dsw-alias-border-l2: rgba(255, 255, 255, .13);
  --dsw-alias-brand-primary: #f9fafb;
  --dsw-alias-label-primary: #f9fafb;
  --dsw-alias-label-secondary: #cfd3d6;
  --dsw-alias-state-error-primary: #f25a5a;
  --dsw-alias-state-idle-primary: #545557;
  --dsw-alias-state-success-primary: #22c55e;
  --dsw-alias-state-warn-primary: #f59e0b;
}
html, body { margin: 0; padding: 0; height: 100%; background: var(--dsw-alias-bg-base); }
#root { height: 100%; }
`
const themeTag = document.createElement('style')
themeTag.textContent = THEME
document.head.appendChild(themeTag)

globalThis.window = window
globalThis.document = document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
for (const key of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'File', 'FileReader', 'getComputedStyle', 'FocusEvent']) {
  if (window[key] !== undefined) globalThis[key] = window[key]
}
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => realFetch(new URL(String(input), baseUrl), init)

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
let mod = null
window.__ModuleLoader__ = { load(descriptor) { mod = descriptor } }
const factory = new Function('window', 'document', 'fetch', 'require', 'structuredClone', code)
factory(window, document, globalThis.fetch, (id) => (id === 'react' ? React : {}), structuredClone)
const client = mod.factory((id) => (id === 'react' ? React : {}))

const registrations = []
client.apply({
  get: (name) => (name === 'slots' ? {
    inject(key, fn) { registrations.push({ key, entry: fn() }); return () => {} },
    register(definition, component) { return { definition, component } },
  } : undefined),
  on() {},
  effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
})
const main = registrations.find((entry) => entry.key === 'main')
const root = createRoot(document.getElementById('root'))
root.render(React.createElement(main.entry.component))

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, timeout = 8000, label = 'condition') {
  const started = Date.now()
  for (;;) {
    let value = null
    try { value = predicate() } catch { value = null }
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('timed out waiting for ' + label)
    await delay(40)
  }
}
const q = (selector) => document.querySelector(selector)
const qa = (selector) => Array.from(document.querySelectorAll(selector))
const byText = (selector, needle) => qa(selector).find((el) => (el.textContent || '').includes(needle)) || null
function click(element) {
  if (!element) throw new Error('missing element to click')
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}
function press(key, init) {
  window.dispatchEvent(new window.KeyboardEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, init || {})))
}

window.addEventListener('error', (event) => console.error('page error: ' + (event.error && event.error.stack ? event.error.stack : event.message)))
try {
  await waitFor(() => q('.dsh-scr-root') && (document.body.textContent || '').includes('Release brief'), 10000, 'panel + fixture')
} catch (error) {
  console.error('BODY: ' + document.body.innerHTML.slice(0, 2500))
  throw error
}

// Values live in properties, not attributes; promote them so a static page still renders them.
function serialize() {
  for (const el of qa('textarea')) el.textContent = el.value
  for (const el of qa('input')) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) el.setAttribute('checked', 'checked')
      else el.removeAttribute('checked')
    } else {
      el.setAttribute('value', el.value)
    }
  }
  for (const el of qa('select')) {
    for (const option of Array.from(el.options)) {
      if (option.value === el.value) option.setAttribute('selected', 'selected')
      else option.removeAttribute('selected')
    }
  }
  return '<!doctype html>' + document.documentElement.outerHTML
}

function run(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(error.message + '\n' + String(stderr || '')))
      else resolve(stdout)
    })
  })
}

async function shoot(name, width, height, scale) {
  snapshotHtml = serialize()
  const output = join(DOCS, name + '.png')
  await run(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,MediaRouter',
    '--user-data-dir=' + join(home, 'edge-profile'),
    '--window-size=' + width + ',' + height,
    '--force-device-scale-factor=' + scale,
    '--virtual-time-budget=6000',
    '--screenshot=' + output,
    baseUrl + '/snapshot',
  ])
  const stats = await readFile(output)
  console.log('wrote docs/media/' + name + '.png (' + Math.round(stats.length / 1024) + ' KB, ' + Math.round(width * scale) + 'x' + Math.round(height * scale) + ')')
  return output
}

await shoot('workspace', 1440, 900, 1.5)

press('k', { ctrlKey: true })
await waitFor(() => q('.dsh-scr-palette-backdrop'), 4000, 'command palette')
await delay(500)
await shoot('search', 1440, 900, 1.5)
press('Escape')
await waitFor(() => q('.dsh-scr-palette-backdrop') === null, 3000, 'palette closed')

click(byText('.dsh-scr-seg-btn', 'Media'))
await waitFor(() => q('.dsh-scr-media-library'), 5000, 'media view')
await delay(400)
await shoot('media', 1440, 900, 1.5)

click(byText('.dsh-scr-seg-btn', 'Canvas'))
await waitFor(() => q('.dsh-scr-canvas'), 5000, 'canvas view')
await delay(400)
await shoot('canvas', 1440, 900, 1.5)

// jsdom has no layout engine, so the graph would measure a 0x0 viewport and stack every node
// in the corner. Report a plausible panel-sized rect before the view mounts, while the force
// layout runs.
const realRect = window.Element.prototype.getBoundingClientRect
window.Element.prototype.getBoundingClientRect = function () {
  return { x: 272, y: 56, top: 56, left: 272, right: 1392, bottom: 856, width: 1120, height: 800, toJSON() { return this } }
}
click(byText('.dsh-scr-seg-btn', 'Graph'))
await waitFor(() => q('.dsh-scr-graph'), 5000, 'graph view')
await waitFor(() => qa('.dsh-scr-graph-node').length > 3, 5000, 'graph nodes')
await delay(1800)
await shoot('graph', 1440, 900, 1.5)
window.Element.prototype.getBoundingClientRect = realRect

click(byText('.dsh-scr-seg-btn', 'Board'))
await waitFor(() => q('.dsh-scr-board-cols'), 5000, 'board view')
await delay(400)
await shoot('board', 1440, 900, 1.5)

// ---- hero banner ---------------------------------------------------------------------------
const canvasShot = (await readFile(join(DOCS, 'canvas.png'))).toString('base64')
const hero = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background:
      radial-gradient(900px 520px at 78% 12%, rgba(94, 234, 178, .10), transparent 62%),
      radial-gradient(700px 480px at 12% 88%, rgba(120, 150, 255, .10), transparent 60%),
      #0d0f13;
    font-family: "Segoe UI", system-ui, sans-serif;
    color: #f4f6fa;
    overflow: hidden;
  }
  body::before {
    content: ""; position: absolute; inset: 0;
    background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(1100px 600px at 50% 30%, #000 25%, transparent 75%);
  }
  .wrap { position: relative; display: grid; grid-template-columns: 470px 1fr; gap: 56px; align-items: center; height: 680px; padding: 0 64px; }
  .eyebrow { font-size: 13px; letter-spacing: .22em; text-transform: uppercase; color: #6ee7b7; font-weight: 600; }
  h1 { font-size: 74px; line-height: .95; margin: 18px 0 20px; letter-spacing: -.03em; font-weight: 700; }
  h1 span { display: block; font-size: 22px; letter-spacing: 0; font-weight: 500; color: #9aa3b2; margin-top: 18px; line-height: 1.5; }
  ul { list-style: none; margin: 0 0 34px; padding: 0; display: grid; gap: 12px; }
  li { display: flex; gap: 12px; align-items: baseline; font-size: 17px; color: #d6dbe4; }
  li b { color: #f4f6fa; font-weight: 600; }
  .dot { width: 7px; height: 7px; border-radius: 99px; background: #6ee7b7; box-shadow: 0 0 12px #6ee7b7aa; flex: 0 0 auto; transform: translateY(-2px); }
  .install { display: inline-flex; align-items: center; gap: 12px; font-family: Consolas, monospace; font-size: 15px; color: #cfe9dd; background: rgba(110, 231, 183, .10); border: 1px solid rgba(110, 231, 183, .25); padding: 12px 18px; border-radius: 10px; }
  .install i { color: #6ee7b7; font-style: normal; }
  .shot { position: relative; }
  .shot .frame { border-radius: 16px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); box-shadow: 0 40px 90px rgba(0,0,0,.55), 0 0 0 8px rgba(255,255,255,.02); transform: perspective(1600px) rotateY(-7deg) rotateX(2deg); }
  .shot .bar { display: flex; gap: 7px; align-items: center; height: 30px; padding: 0 13px; background: #191b21; border-bottom: 1px solid rgba(255,255,255,.07); }
  .shot .bar i { width: 9px; height: 9px; border-radius: 99px; background: #3a3f4b; }
  .shot img { display: block; width: 100%; }
  .tag { position: absolute; right: -18px; bottom: -20px; background: #16181e; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 12px 16px; font-size: 13px; color: #9aa3b2; box-shadow: 0 18px 40px rgba(0,0,0,.45); }
  .tag b { display: block; color: #f4f6fa; font-size: 15px; margin-bottom: 2px; }
</style></head><body><div class="wrap">
  <div>
    <div class="eyebrow">DeepSeek Harness plugin</div>
    <h1>Scriptorium<span>A project notebook that lives inside the harness: notes, screenshots, a canvas and a mind graph, in one panel.</span></h1>
    <ul>
      <li><i class="dot"></i><span><b>Notes</b> with a live Markdown preview</span></li>
      <li><i class="dot"></i><span><b>Screenshots</b> attached to the note they belong to</span></li>
      <li><i class="dot"></i><span><b>Canvas</b> and mind graph over the same library</span></li>
    </ul>
    <div class="install"><i>&gt;</i> dsh plugin --profile web add dsh-scriptorium</div>
  </div>
  <div class="shot">
    <div class="frame"><div class="bar"><i></i><i></i><i></i></div><img src="data:image/png;base64,${canvasShot}"></div>
    <div class="tag"><b>One JSON file</b>no account, no cloud, exportable any time</div>
  </div>
</div></body></html>`
const heroPath = join(home, 'hero.html')
await writeFile(heroPath, hero)
await run(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--user-data-dir=' + join(home, 'edge-hero'),
  '--window-size=1280,680',
  '--force-device-scale-factor=1.5',
  '--virtual-time-budget=4000',
  '--screenshot=' + join(DOCS, 'hero.png'),
  'file:///' + heroPath.replace(/\\/g, '/'),
])
const heroStats = await readFile(join(DOCS, 'hero.png'))
console.log('wrote docs/media/hero.png (' + Math.round(heroStats.length / 1024) + ' KB, 1920x1020)')

root.unmount()
server.close()
await rm(home, { recursive: true, force: true })
console.log('done')

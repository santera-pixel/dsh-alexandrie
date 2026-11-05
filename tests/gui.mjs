// Real-DOM end-to-end check: mounts the built client bundle in jsdom against a throwaway
// instance of the real host half, then drives the UI the way a user would (click, type,
// Ctrl+K, drag-free board moves, trash/restore, settings) and asserts on the rendered DOM
// plus the JSON the host actually persisted. This is the closest automated substitute for a
// browser pass: the GUI shell itself refuses plain HTTP with 401, but the panel and its
// routes are exercised for real here.

import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let passed = 0
const pending = []
const check = (title, fn) => {
  pending.push(async () => {
    try {
      await fn()
      passed += 1
      console.log('ok   ' + title)
    } catch (error) {
      console.error('FAIL ' + title)
      console.error(error && error.stack ? error.stack : error)
      process.exitCode = 1
    }
  })
}

const realFetch = globalThis.fetch
const home = await mkdtemp(join(tmpdir(), 'scr-gui-'))
process.env.DSH_HOME = home

// ---- a throwaway host with the real routes ------------------------------------------------
const { apply } = await import('../lib/index.js')
const routes = []
apply({
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect() {
    return () => {}
  },
})
const route = routes[0]
const server = http.createServer((request, response) => {
  Promise.resolve(route.handler(request, response)).catch((error) => {
    response.writeHead(500)
    response.end(String(error))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const baseUrl = `http://127.0.0.1:${port}`

async function hostState() {
  const response = await realFetch(baseUrl + '/dsh-scriptorium/state')
  const payload = await response.json()
  return payload.value
}
async function waitForState(predicate, timeout = 4000, label = 'host state') {
  const started = Date.now()
  for (;;) {
    let value = null
    try {
      value = await hostState()
    } catch {
      value = null
    }
    if (value && predicate(value)) return value
    if (Date.now() - started > timeout) throw new Error('timed out waiting for ' + label)
    await delay(40)
  }
}

// ---- a DOM the bundle can live in ---------------------------------------------------------
const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: baseUrl + '/',
  pretendToBeVisual: true,
})
const { window } = dom
const { document } = window

globalThis.window = window
globalThis.document = document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
for (const key of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'DragEvent', 'File', 'FileReader', 'getComputedStyle']) {
  if (window[key] !== undefined) globalThis[key] = window[key]
}
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.fetch = (input, init) => realFetch(new URL(String(input), baseUrl), init)

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')

const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
let mod = null
window.__ModuleLoader__ = {
  load(descriptor) {
    mod = descriptor
  },
}
const factory = new Function('window', 'document', 'fetch', 'require', 'structuredClone', code)
factory(window, document, globalThis.fetch, (id) => (id === 'react' ? React : {}), structuredClone)
assert.ok(mod !== null, 'the bundle called window.__ModuleLoader__.load')
const client = mod.factory((id) => (id === 'react' ? React : {}))

const registrations = []
const slots = {
  inject(key, fn) {
    registrations.push({ key, entry: fn() })
    return () => {}
  },
  register(definition, component) {
    return { definition, component }
  },
}
const services = { slots }
client.apply({
  get: (name) => services[name],
  on() {},
  effect(fn) {
    const dispose = fn()
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
})

const main = registrations.find((entry) => entry.key === 'main')
assert.ok(main, 'the panel registered into the main slot')
const sidebar = registrations.find((entry) => entry.key === 'sidebar.panellist')
assert.ok(sidebar, 'the panel registered a sidebar icon')

const container = document.getElementById('root')
const root = createRoot(container)
root.render(React.createElement(main.entry.component))

// ---- helpers -------------------------------------------------------------------------------
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, timeout = 4000, label = 'condition') {
  const started = Date.now()
  for (;;) {
    let value
    try {
      value = predicate()
    } catch {
      value = null
    }
    if (value) return value
    if (Date.now() - started > timeout) throw new Error('timed out waiting for ' + label)
    await delay(25)
  }
}
const text = () => document.body.textContent.replace(/\s+/g, ' ')
const q = (selector) => document.querySelector(selector)
const qa = (selector) => Array.from(document.querySelectorAll(selector))
const byLabel = (label) => q('[aria-label="' + label + '"]')
const byText = (selector, needle) => qa(selector).find((el) => (el.textContent || '').includes(needle)) || null
function click(element) {
  assert.ok(element, 'clicked element exists')
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
}
function type(element, value) {
  assert.ok(element, 'typed element exists')
  const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, value)
  element.dispatchEvent(new window.Event('input', { bubbles: true }))
}
function press(element, key, init = {}) {
  const target = element || window
  target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}
const docsOf = (state) => state.snapshot.nodes.filter((node) => node.kind === 'doc' && node.trashed !== true)

// ---- checks --------------------------------------------------------------------------------
check('the panel mounts, seeds the sample workspace and loads it from the host', async () => {
  await waitFor(() => text().includes('Welcome to Scriptorium'), 5000, 'seeded workspace')
  const state = await waitForState((value) => value.snapshot !== null && value.snapshot.workspaces.length === 1, 5000, 'seeded host state')
  assert.equal(docsOf(state).length, 3)
  assert.ok(q('.dsh-scr-root'), 'root element rendered')
  assert.ok(q('.dsh-scr-sidebar'), 'sidebar rendered')
  assert.ok(q('.dsh-scr-panel'), 'panel wrapper rendered')
})

check('creating a document through the header button opens the editor', async () => {
  click(byLabel('New document (Ctrl+N)'))
  await waitFor(() => q('.dsh-scr-textarea'), 4000, 'editor textarea')
  const title = q('[aria-label="Document title"]')
  assert.ok(title, 'title input exists')
  type(title, 'GUI smoke test')
  title.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }))
  await waitFor(() => text().includes('GUI smoke test'), 3000, 'renamed title')
  await delay(900)
  const state = await hostState()
  assert.ok(
    docsOf(state).some((node) => node.title === 'GUI smoke test'),
    'the new document was persisted by the host',
  )
})

check('typing markdown updates the live preview and reaches disk', async () => {
  const body = '# GUI heading\n\nSome **bold** text and a table:\n\n| col | val |\n| --- | --- |\n| a | 42 |\n\n- [ ] pending task\n'
  type(q('.dsh-scr-textarea'), body)
  await waitFor(() => (q('.dsh-scr-md') ? q('.dsh-scr-md').textContent.includes('GUI heading') : false), 4000, 'preview heading')
  const preview = q('.dsh-scr-md')
  assert.ok(preview.querySelector('table'), 'preview renders the table element')
  assert.ok(preview.textContent.includes('42'), 'preview renders table cells')
  assert.ok(q('.dsh-scr-md-task'), 'task list checkbox rendered')
  await delay(1200)
  const state = await hostState()
  const saved = docsOf(state).find((node) => node.title === 'GUI smoke test')
  assert.ok(saved && saved.content.includes('GUI heading'), 'content reached data.json through /save')
  const raw = await readFile(join(home, 'scriptorium', 'data.json'), 'utf8')
  assert.ok(raw.includes('GUI heading'), 'the file on disk contains the new content')
})

check('Ctrl+K opens the command palette and Escape closes it', async () => {
  press(null, 'k', { ctrlKey: true })
  await waitFor(() => q('.dsh-scr-palette-backdrop'), 3000, 'command palette')
  assert.ok(text().includes('New document'), 'palette lists commands')
  press(null, 'Escape')
  await waitFor(() => q('.dsh-scr-palette-backdrop') === null, 3000, 'palette closed')
})

check('search finds the new document and Enter opens it', async () => {
  click(byText('button', 'Search documents'))
  const input = await waitFor(() => q('.dsh-scr-search-input'), 3000, 'search overlay input')
  type(input, 'GUI smoke')
  await waitFor(() => q('.dsh-scr-search-hit'), 3000, 'highlighted hit')
  press(input, 'Enter')
  await waitFor(() => q('[aria-label="Document title"]') && q('[aria-label="Document title"]').value === 'GUI smoke test', 4000, 'picked document')
})

check('the board shows the document and its move button changes the status on the host', async () => {
  click(byText('.dsh-scr-seg-btn', 'Board'))
  await waitFor(() => q('.dsh-scr-board-cols'), 3000, 'board columns')
  const card = qa('.dsh-scr-board-card').find((el) => (el.textContent || '').includes('GUI smoke test'))
  assert.ok(card, 'the document appears as a board card')
  const move = card.querySelector('[aria-label="Move to Active"]')
  assert.ok(move, 'the draft card can move forward')
  click(move)
  await delay(1200)
  const state = await hostState()
  const moved = docsOf(state).find((node) => node.title === 'GUI smoke test')
  assert.equal(moved.status, 'active', 'the new status persisted')
  assert.ok(qa('.dsh-scr-board-card').length >= 3, 'the other cards are still rendered')
})

check('trash and restore round-trip through the views', async () => {
  click(byText('.dsh-scr-seg-btn', 'Documents'))
  const opened = await waitFor(() => q('.dsh-scr-doc-head [aria-label="Move to trash"]') || qa('.dsh-scr-list-row').find((el) => (el.textContent || '').includes('GUI smoke test')), 4000, 'a way into the document')
  if (!q('.dsh-scr-doc-head [aria-label="Move to trash"]')) {
    click(opened)
    await waitFor(() => q('.dsh-scr-doc-head [aria-label="Move to trash"]'), 4000, 'editor trash button')
  }
  click(q('.dsh-scr-doc-head [aria-label="Move to trash"]'))
  await delay(250)
  click(byText('.dsh-scr-tree-row', 'Trash'))
  const trashed = await waitFor(
    () => qa('.dsh-scr-list-row').find((el) => (el.textContent || '').includes('GUI smoke test')),
    4000,
    'trashed document row',
  )
  const restore = trashed.querySelector('[aria-label="Restore"]')
  assert.ok(restore, 'restore button present')
  click(restore)
  await waitFor(
    () => !qa('.dsh-scr-list-row').some((el) => (el.textContent || '').includes('GUI smoke test')),
    4000,
    'row leaves the trash',
  )
  await delay(900)
  const state = await hostState()
  const restored = docsOf(state).find((node) => node.title === 'GUI smoke test')
  assert.ok(restored, 'the document is alive again')
})

check('the settings modal persists a font-size change', async () => {
  click(byLabel('Settings'))
  const dialog = await waitFor(() => q('[role="dialog"][aria-label="Scriptorium settings"]'), 3000, 'settings dialog')
  assert.ok(dialog.textContent.includes('Storage'), 'storage row present')
  const range = dialog.querySelector('input[type="range"]')
  assert.ok(range, 'font size slider present')
  type(range, '17')
  await delay(1200)
  const state = await hostState()
  assert.equal(state.snapshot.settings.fontSize, 17, 'the setting persisted')
  click(byText('button', 'Done'))
  await waitFor(() => q('[role="dialog"][aria-label="Scriptorium settings"]') === null, 3000, 'dialog closed')
})

check('an attachment uploads through the editor and lands on the canvas', async () => {
  click(byText('.dsh-scr-seg-btn', 'Documents'))
  await delay(250)
  if (!q('.dsh-scr-editor-media')) {
    const row = await waitFor(() => qa('.dsh-scr-list-row').find((el) => (el.textContent || '').includes('GUI smoke test')), 4000, 'document row')
    click(row)
  }
  await waitFor(() => q('.dsh-scr-editor-media'), 4000, 'attachments section')
  const input = q('.dsh-scr-editor-media input[type="file"]')
  assert.ok(input, 'attachment file input exists')
  const file = new window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'shot.png', { type: 'image/png' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.dispatchEvent(new window.Event('change', { bubbles: true }))
  const state = await waitForState((value) => docsOf(value).some((node) => Array.isArray(node.media) && node.media.length > 0), 6000, 'uploaded media')
  const doc = docsOf(state).find((node) => node.title === 'GUI smoke test')
  assert.equal(doc.media.length, 1, 'the media entry was persisted on the document')
  assert.ok(state.snapshot.canvas.items.length >= 2, 'the upload also placed the attachment and its document on the canvas')

  click(byText('.dsh-scr-seg-btn', 'Canvas'))
  await waitFor(() => q('.dsh-scr-canvas'), 4000, 'canvas root')
  const cards = qa('.dsh-scr-canvas-card')
  assert.ok(cards.length >= 2, 'the canvas shows the attachment and its owning document')
  assert.ok(q('.dsh-scr-canvas-edge'), 'the owning document is linked to its attachment')

  const media = q('[data-canvas-item^="media:"]')
  assert.ok(media, 'the attachment card is present')
  media.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 120, clientY: 120, button: 0 }))
  window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 220, clientY: 200 }))
  window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 220, clientY: 200 }))
  await delay(1200)
  const movedState = await hostState()
  const movedItem = movedState.snapshot.canvas.items.find((item) => item.id.startsWith('media:'))
  assert.ok(movedItem.x > 90, 'the dragged card moved and the position persisted (' + movedItem.x + ')')
  assert.ok(movedItem.y > 80, 'the dragged card moved vertically too')

  click(byLabel('Zoom in'))
  await waitFor(() => (q('.dsh-scr-canvas-stage').getAttribute('style') || '').includes('scale(1.2'), 2000, 'zoomed stage')
})

check('the mind graph maps the notes and can create a new connection', async () => {
  click(byText('.dsh-scr-seg-btn', 'Graph'))
  await waitFor(() => q('.dsh-scr-graph'), 4000, 'graph root')
  const nodes = await waitFor(() => (qa('.dsh-scr-graph-node').length >= 4 ? qa('.dsh-scr-graph-node') : null), 4000, 'graph nodes')
  assert.ok(nodes.some((el) => (el.textContent || '').includes('GUI smoke test')), 'the new note is a graph node')

  const source = nodes.find((el) => (el.textContent || '').includes('GUI smoke test'))
  const target = nodes.find((el) => (el.textContent || '').includes('Welcome to Scriptorium'))
  assert.ok(source && target, 'both endpoints exist')
  click(source)
  await waitFor(() => qa('.dsh-scr-graph-node.is-selected').length === 1, 2000, 'source note selected')
  click(byLabel('Connect two notes'))
  await waitFor(() => qa('.dsh-scr-graph-node.is-connect-source').length === 1, 2000, 'link mode armed from the selection')
  click(target)
  await delay(1200)
  const state = await hostState()
  const edited = docsOf(state).find((node) => node.title === 'GUI smoke test')
  assert.ok(edited.content.includes('[[Welcome to Scriptorium]]'), 'the connection was written as a wiki link')
  await waitFor(() => qa('.dsh-scr-graph-edge').length >= 1, 3000, 'graph edge after connecting')

  const query = q('[aria-label="Filter notes in the graph"]')
  type(query, 'GUI')
  await waitFor(() => qa('.dsh-scr-graph-node.is-dim').length > 0, 2000, 'non-matching nodes dim')
})

// ---- hostile SVG (card t-mw3r61os-yd6yyb) ---------------------------------------------------
// An imported SVG must never run script in the GUI origin. The host serves it as a download
// and the preview scrubs it before rendering it through <img> (which cannot execute SVG script).
check('a hostile SVG attachment previews without running its script', async () => {
  click(byText('.dsh-scr-seg-btn', 'Documents'))
  await delay(250)
  // The graph check leaves the graph view active; the smoke-test note is still the open document.
  // When no editor is open yet, reopen it from the list first.
  if (!q('.dsh-scr-editor-media')) {
    const row = await waitFor(() => qa('.dsh-scr-list-row').find((el) => (el.textContent || '').includes('GUI smoke test')), 4000, 'document row')
    click(row)
  }
  await waitFor(() => q('.dsh-scr-editor-media'), 4000, 'attachments section')
  assert.equal((q('.dsh-scr-doc-title') || {}).value, 'GUI smoke test', 'the upload targets the smoke-test note')
  const hostile =
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="window.__pwned = true">' +
    '<script>window.__pwned = true</script><rect width="120" height="80" fill="#c00"/></svg>'
  const file = new window.File([hostile], 'hostile.svg', { type: 'image/svg+xml' })
  const uploaded = (value) => docsOf(value).some((node) => Array.isArray(node.media) && node.media.some((item) => item.name === 'hostile.svg'))
  let state = null
  for (let attempt = 0; attempt < 3 && state === null; attempt += 1) {
    const input = q('.dsh-scr-editor-media input[type="file"]')
    assert.ok(input, 'attachment file input exists')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new window.Event('change', { bubbles: true }))
    try {
      state = await waitForState(uploaded, 2500, 'uploaded hostile svg')
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
  const doc = docsOf(state).find((node) => node.title === 'GUI smoke test')
  const stored = doc.media.find((item) => item.name === 'hostile.svg')
  assert.equal(stored.mime, 'image/svg+xml', 'the SVG keeps its declared type in the snapshot')

  click(byText('.dsh-scr-seg-btn', 'Media'))
  await waitFor(() => q('.dsh-scr-media-library'), 4000, 'media library')
  const tile = await waitFor(() => qa('.dsh-scr-media-tile').find((el) => (el.textContent || '').includes('hostile.svg')), 4000, 'hostile svg tile')
  click(tile.querySelector('.dsh-scr-media-thumb'))
  const image = await waitFor(() => q('.dsh-scr-media-svg-full'), 4000, 'sanitized svg preview')
  assert.equal(window.__pwned, undefined, 'the SVG script never ran')
  assert.equal(q('.dsh-scr-media-modal script'), null, 'no script element in the preview DOM')
  const src = image.getAttribute('src')
  assert.match(src, /^data:image\/svg\+xml;base64,/)
  const decoded = Buffer.from(src.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')
  assert.ok(decoded.includes('<rect'), 'the harmless artwork survives')
  assert.ok(!/<script/i.test(decoded), 'the script element was stripped')
  assert.ok(!/onload/i.test(decoded), 'the onload handler was stripped')
  assert.ok(!/javascript:/i.test(decoded), 'no javascript: URL survives')
})

for (const run of pending) await run()

root.unmount()
server.close()
await rm(home, { recursive: true, force: true })
console.log('')
console.log('gui: ' + passed + ' checks passed')
if (process.exitCode) process.exit(1)

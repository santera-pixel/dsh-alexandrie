// Editor test: formatting helpers, mode switching, Markdown rendering, sanitising and auto-save.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, '..', 'src', 'client')
const parts = fs
  .readdirSync(clientDir)
  .filter((name) => name.endsWith('.js'))
  .sort()

const exposed =
  'applyWrap, applyLinePrefix, EDITOR_MODES, EditorToolbar, DocumentEditor, renderMarkdown, markdownStats, ' +
  'markdownPlainText, toggleTaskLine, safeHref, safeImageSrc, insertIntoTextarea'

const source =
  parts.map((name) => fs.readFileSync(path.join(clientDir, name), 'utf8')).join('\n') + '\n;return { ' + exposed + ', model, createStore }\n'

const el = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false),
})

let presets = []
let cursor = 0
const reactShim = {
  createElement: el,
  Fragment: Symbol('Fragment'),
  useState(initial) {
    const value = cursor < presets.length && presets[cursor] !== undefined ? presets[cursor] : typeof initial === 'function' ? initial() : initial
    cursor += 1
    return [value, () => {}]
  },
  useRef(initial) {
    return { current: initial }
  },
  useEffect() {},
  useLayoutEffect() {},
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
  },
}

const documentStub = {
  head: { appendChild() {}, removeChild() {} },
  body: { appendChild() {} },
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, click() {} }),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)

const stamp = '2026-01-01T00:00:00.000Z'

const fixture = () => ({
  version: 1,
  workspaces: [{ id: 'ws-1', name: 'Knowledge base', icon: 'book', createdAt: stamp, updatedAt: stamp }],
  nodes: [
    {
      id: 'doc-1',
      workspaceId: 'ws-1',
      parentId: null,
      kind: 'doc',
      title: 'Welcome',
      icon: 'sparkles',
      status: 'active',
      tags: ['intro'],
      favorite: false,
      trashed: false,
      order: 0,
      createdAt: stamp,
      updatedAt: stamp,
      content: '# Welcome\n\n- [ ] first\n- [x] second\n',
    },
  ],
  settings: { view: 'list', editorMode: 'split', fontSize: 15, autoSave: true, showLineNumbers: true, sort: 'manual' },
  ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: [] },
})

// ---------- fake host ----------
const host = { snapshot: null, revision: 4, updatedAt: stamp, saves: [], failSave: false }
const reply = (payload, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(payload) })

const fetchStub = async (url, options = {}) => {
  const target = String(url)
  const method = String((options && options.method) || 'GET').toUpperCase()
  if (target.endsWith('/state')) {
    return reply({ ok: true, value: { revision: host.revision, updatedAt: host.updatedAt, snapshot: host.snapshot } })
  }
  if (target.endsWith('/health')) {
    return reply({ ok: true, value: { directory: 'C:\\x\\.dsh\\alexandrie', file: 'data.json', exists: true, size: 512 } })
  }
  if (target.endsWith('/save') && method === 'POST') {
    if (host.failSave) return reply({ ok: false, error: { message: 'disk full' } }, 500)
    const body = JSON.parse(options.body)
    host.saves.push(body.snapshot)
    host.snapshot = body.snapshot
    host.revision += 1
    return reply({ ok: true, value: { revision: host.revision, updatedAt: stamp } })
  }
  return reply({ ok: false, error: { message: 'unknown route' } }, 404)
}

const mod = new Function('require', 'window', 'document', 'fetch', source)(
  (id) => (id === 'react' ? reactShim : {}),
  { addEventListener() {}, removeEventListener() {} },
  documentStub,
  fetchStub,
)

let passed = 0
const failures = []
const check = async (name, fn) => {
  try {
    await fn()
    passed += 1
  } catch (error) {
    failures.push(name + ' :: ' + ((error && error.message) || String(error)).split('\n').slice(0, 3).join(' | '))
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- render helpers ----------
const renderTree = (component, props) => {
  const sink = { classes: [], text: [], elements: [] }
  presets = []
  cursor = 0
  const walk = (element, depth) => {
    if (element === null || element === undefined || element === false || element === true) return
    if (depth > 80) throw new Error('render recursion too deep')
    if (typeof element === 'string' || typeof element === 'number') {
      sink.text.push(String(element))
      return
    }
    if (Array.isArray(element)) {
      for (const child of element) walk(child, depth + 1)
      return
    }
    if (typeof element !== 'object') return
    const { type, props: elementProps, children } = element
    sink.elements.push({ type, props: elementProps || {} })
    if (elementProps && typeof elementProps.className === 'string') sink.classes.push(elementProps.className)
    const all = (children || []).concat(elementProps && elementProps.children !== undefined ? [].concat(elementProps.children) : [])
    if (typeof type === 'function') {
      if (type.prototype && type.prototype.isReactComponent) walk(new type(elementProps).render(), depth + 1)
      else walk(type(elementProps), depth + 1)
    } else {
      for (const child of all) walk(child, depth + 1)
    }
  }
  walk(el(component, props), 0)
  return sink
}

const hasClass = (sink, needle) => sink.classes.some((value) => String(value).split(/\s+/).includes(needle))
const findClass = (sink, needle) => sink.elements.find((entry) => typeof entry.props.className === 'string' && entry.props.className.split(/\s+/).includes(needle))
const findByTag = (sink, tag) => sink.elements.filter((entry) => entry.type === tag)
const textOf = (sink) => sink.text.join(' ')

const fakeTextarea = (value, start, end) => {
  const state = { value, selectionStart: start === undefined ? value.length : start, selectionEnd: end === undefined ? (start === undefined ? value.length : start) : end, focused: 0 }
  return Object.assign(state, {
    focus() {
      state.focused += 1
    },
    setSelectionRange(a, b) {
      state.selectionStart = a
      state.selectionEnd = b
    },
  })
}

// ---------- fixture wiring for the editor ----------
const makeEditorProps = (overrides = {}) => {
  const snapshot = fixture()
  if (overrides.settings) snapshot.settings = Object.assign(snapshot.settings, overrides.settings)
  const node = overrides.node || snapshot.nodes[0]
  const calls = { setContent: [], saveNow: 0, patchSettings: [], rename: [] }
  const store = {
    state: { saveState: 'saved', updatedAt: stamp, revision: 4, snapshot, status: 'ready', storage: null, saveError: null },
    subscribe: () => () => {},
    load: async () => {},
    commit: (mutator) => {
      mutator(snapshot)
    },
    saveNow: async () => {
      calls.saveNow += 1
    },
    replace() {},
    dispose() {},
  }
  const actions = {
    setContent: (id, value) => calls.setContent.push([id, value]),
    saveNow: () => {
      calls.saveNow += 1
    },
    patchSettings: (patch) => calls.patchSettings.push(patch),
    renameNode: (id, title) => calls.rename.push([id, title]),
    setStatus() {},
    toggleFavorite() {},
    exportDocument() {},
    trashNode() {},
    addTag() {},
    removeTag() {},
  }
  return { props: { store, snapshot, node, ui: snapshot.ui, actions }, calls, snapshot }
}

// ---------- checks ----------
await check('editor modes are write/split/preview', () => {
  const ids = mod.EDITOR_MODES.map((entry) => entry.id).join(',')
  assert(ids === 'write,split,preview', 'unexpected modes: ' + ids)
  const labels = mod.EDITOR_MODES.map((entry) => entry.label).join(',')
  assert(labels === 'Write,Split,Preview', 'unexpected labels: ' + labels)
})

await check('the persisted editor mode is restored on load', async () => {
  host.snapshot = fixture()
  host.snapshot.settings.editorMode = 'preview'
  host.saves = []
  const store = mod.createStore()
  await store.load()
  assert(store.state.status === 'ready', 'store did not become ready')
  assert(store.state.snapshot.settings.editorMode === 'preview', 'editor mode not restored: ' + store.state.snapshot.settings.editorMode)
})

await check('changing the editor mode is saved to the host', async () => {
  host.snapshot = fixture()
  host.saves = []
  host.failSave = false
  const store = mod.createStore()
  await store.load()
  store.commit((draft) => {
    draft.settings.editorMode = 'write'
  })
  await sleep(900)
  assert(host.saves.length >= 1, 'nothing was saved')
  assert(host.saves[host.saves.length - 1].settings.editorMode === 'write', 'saved mode is ' + host.saves[host.saves.length - 1].settings.editorMode)
  assert(store.state.saveState === 'saved', 'save state is ' + store.state.saveState)
  store.dispose()
})

await check('a failed save surfaces an error state', async () => {
  host.snapshot = fixture()
  host.saves = []
  host.failSave = true
  const store = mod.createStore()
  await store.load()
  store.commit((draft) => {
    draft.settings.fontSize = 17
  })
  await sleep(900)
  assert(store.state.saveState === 'error', 'save state is ' + store.state.saveState)
  assert(/disk full/.test(String(store.state.saveError)), 'unexpected error: ' + store.state.saveError)
  host.failSave = false
  store.dispose()
})

await check('write mode renders only the textarea', () => {
  const { props } = makeEditorProps({ settings: { editorMode: 'write' } })
  const sink = renderTree(mod.DocumentEditor, props)
  assert(hasClass(sink, 'dsh-axl-textarea'), 'textarea missing')
  assert(!hasClass(sink, 'dsh-axl-md'), 'preview should be hidden in write mode')
  assert(findByTag(sink, 'textarea').length === 1, 'expected one textarea')
})

await check('preview mode renders only the rendered document', () => {
  const { props } = makeEditorProps({ settings: { editorMode: 'preview' } })
  const sink = renderTree(mod.DocumentEditor, props)
  assert(!hasClass(sink, 'dsh-axl-textarea'), 'textarea should be hidden in preview mode')
  assert(hasClass(sink, 'dsh-axl-md'), 'preview body missing')
  assert(textOf(sink).includes('Welcome'), 'document text missing from preview')
})

await check('split mode renders both panes with labels', () => {
  const { props } = makeEditorProps({ settings: { editorMode: 'split' } })
  const sink = renderTree(mod.DocumentEditor, props)
  assert(hasClass(sink, 'dsh-axl-textarea') && hasClass(sink, 'dsh-axl-md'), 'split mode needs both panes')
  const labels = textOf(sink)
  assert(labels.includes('Markdown') && labels.includes('Preview'), 'pane labels missing')
  assert(hasClass(sink, 'dsh-axl-toolbar'), 'toolbar missing')
})

await check('the toolbar exposes every formatting action', () => {
  const sink = renderTree(mod.EditorToolbar, { textareaRef: { current: null }, onApply() {}, onSave() {} })
  const labels = sink.elements.filter((entry) => entry.type === 'button').map((entry) => entry.props['aria-label'])
  const expected = ['Heading', 'Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Strikethrough', 'Inline code', 'Code block', 'Bullet list', 'Numbered list', 'Task list', 'Quote', 'Link', 'Image', 'Table', 'Divider', 'Callout', 'Save now (Ctrl+S)']
  const missing = expected.filter((label) => !labels.includes(label))
  assert(missing.length === 0, 'missing actions: ' + missing.join(', '))
})

await check('formatting a button click pipes the edit through onApply', () => {
  const applied = []
  const sink = renderTree(mod.EditorToolbar, { textareaRef: { current: fakeTextarea('hello', 0, 5) }, onApply: (result) => applied.push(result), onSave() {} })
  const bold = sink.elements.find((entry) => entry.type === 'button' && entry.props['aria-label'] === 'Bold (Ctrl+B)')
  assert(bold !== undefined, 'bold button missing')
  bold.props.onClick()
  assert(applied.length === 1, 'onApply not called')
  assert(applied[0].value === '**hello**', 'unexpected result: ' + applied[0].value)
  assert(applied[0].selectionStart === 2 && applied[0].selectionEnd === 7, 'selection not preserved: ' + JSON.stringify(applied[0]))
})

await check('toolbar edits use the browser command so the undo stack survives', () => {
  const target = fakeTextarea('hello', 0, 5)
  let command = null
  documentStub.execCommand = (name, _ui, value) => {
    command = { name, value }
    target.value = value
    return true
  }
  const replaced = mod.insertIntoTextarea(target, { value: '**hello**', selectionStart: 2, selectionEnd: 7 })
  assert(replaced === true, 'the execCommand path was not used')
  assert(command !== null && command.name === 'insertText' && command.value === '**hello**', 'unexpected command: ' + JSON.stringify(command))
  assert(target.value === '**hello**', 'value was not replaced')

  const restored = fakeTextarea('abc', 1, 2)
  documentStub.execCommand = () => true
  const lied = mod.insertIntoTextarea(restored, { value: 'zzz', selectionStart: 0, selectionEnd: 1 })
  assert(lied === false && restored.value === 'abc', 'a command that did not apply must be rejected')

  documentStub.execCommand = () => {
    throw new Error('blocked')
  }
  const blocked = fakeTextarea('abc', 0, 1)
  assert(mod.insertIntoTextarea(blocked, { value: 'q', selectionStart: 0, selectionEnd: 1 }) === false, 'a throwing command must be reported as unavailable')
  assert(blocked.value === 'abc', 'a throwing command must leave the text untouched')

  delete documentStub.execCommand
  assert(mod.insertIntoTextarea(fakeTextarea('abc', 0, 1), { value: 'q', selectionStart: 0, selectionEnd: 1 }) === false, 'without execCommand the helper must return false')
})
await check('applyWrap inserts a placeholder when the selection is empty', () => {
  const result = mod.applyWrap(fakeTextarea('abc', 1, 1), '**', '**', 'bold text')
  assert(result.value === 'a**bold text**bc', 'unexpected value: ' + result.value)
  assert(result.selectionStart === 3 && result.selectionEnd === 12, 'unexpected selection: ' + JSON.stringify(result))
})

await check('applyWrap returns null without a textarea', () => {
  assert(mod.applyWrap(null, '**', '**', 'x') === null, 'expected null')
})

await check('applyLinePrefix bullets every selected line', () => {
  const result = mod.applyLinePrefix(fakeTextarea('one\ntwo', 0, 7), '- ', false)
  assert(result.value === '- one\n- two', 'unexpected value: ' + JSON.stringify(result.value))
})

await check('applyLinePrefix removes the prefix on a second click', () => {
  const result = mod.applyLinePrefix(fakeTextarea('- one\n- two', 0, 11), '- ', false)
  assert(result.value === 'one\ntwo', 'unexpected value: ' + JSON.stringify(result.value))
})

await check('applyLinePrefix numbers ordered lines', () => {
  const result = mod.applyLinePrefix(fakeTextarea('a\nb\nc', 0, 5), '1. ', true)
  assert(result.value === '1. a\n2. b\n3. c', 'unexpected value: ' + JSON.stringify(result.value))
})

await check('applyLinePrefix adds task boxes and keeps existing ones', () => {
  const added = mod.applyLinePrefix(fakeTextarea('todo', 0, 4), '- [ ] ', false)
  assert(added.value === '- [ ] todo', 'unexpected value: ' + JSON.stringify(added.value))
  const kept = mod.applyLinePrefix(fakeTextarea('- [x] done\nnext', 0, 15), '- [ ] ', false)
  assert(kept.value === '- [x] done\n- [ ] next', 'unexpected value: ' + JSON.stringify(kept.value))
})

await check('applyLinePrefix quotes lines', () => {
  const result = mod.applyLinePrefix(fakeTextarea('say this', 0, 8), '> ', false)
  assert(result.value === '> say this', 'unexpected value: ' + JSON.stringify(result.value))
})

await check('applyLinePrefix keeps nested indentation', () => {
  const result = mod.applyLinePrefix(fakeTextarea('  child', 0, 7), '- ', false)
  assert(result.value === '  - child', 'unexpected value: ' + JSON.stringify(result.value))
})

await check('renderMarkdown covers headings, tables, fences, containers and rules', () => {
  const sink = renderTree(() =>
    el(
      'div',
      null,
      mod.renderMarkdown(
        '# One\n\n## Two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n\n::: warning\nCareful\n:::\n\n> quote\n\n---\n',
        {},
      ),
    ),
  )
  const tags = sink.elements.map((entry) => entry.type)
  assert(tags.includes('h1') && tags.includes('h2'), 'headings missing: ' + tags.join(','))
  assert(tags.includes('table') && tags.includes('thead') && tags.includes('tbody'), 'table missing')
  assert(tags.includes('pre') && tags.includes('code'), 'code fence missing')
  assert(hasClass(sink, 'dsh-axl-md-copy'), 'copy button missing')
  assert(textOf(sink).includes('ts'), 'code fence language label missing')
  assert(hasClass(sink, 'dsh-axl-md-container'), 'callout container missing')
  assert(tags.includes('blockquote'), 'blockquote missing')
  assert(tags.includes('hr'), 'horizontal rule missing')
})

await check('renderMarkdown covers inline marks and links', () => {
  const sink = renderTree(() =>
    el('div', null, mod.renderMarkdown('**b** *i* ~~s~~ `c` ==m== $x$ [l](https://e.com/a) ![p](p.png) <https://e.com>\n', {})),
  )
  const tags = sink.elements.map((entry) => entry.type)
  for (const expected of ['strong', 'em', 'del', 'code', 'mark', 'span', 'a', 'img']) {
    assert(tags.includes(expected), 'missing inline element: ' + expected)
  }
  const link = sink.elements.find((entry) => entry.type === 'a' && entry.props.href === 'https://e.com/a')
  assert(link !== undefined, 'link href lost')
  assert(link.props.rel === 'noreferrer noopener', 'external link needs rel')
  const image = sink.elements.find((entry) => entry.type === 'img')
  assert(image.props.src === 'p.png' && image.props.loading === 'lazy', 'image attributes lost')
})

await check('task list checkboxes report their line index', () => {
  const events = []
  const source = '- [ ] first\n- [x] second\n'
  const sink = renderTree(() => el('div', null, mod.renderMarkdown(source, { onToggleTask: (index, checked) => events.push([index, checked]) })))
  const boxes = sink.elements.filter((entry) => entry.type === 'input' && entry.props.type === 'checkbox')
  assert(boxes.length === 2, 'expected two checkboxes, got ' + boxes.length)
  assert(boxes[0].props.checked === false && boxes[1].props.checked === true, 'checkbox state wrong')
  boxes[0].props.onChange({ target: { checked: true } })
  assert(JSON.stringify(events[0]) === '[0,true]', 'unexpected event: ' + JSON.stringify(events[0]))
  assert(hasClass(sink, 'dsh-axl-md-task'), 'task class missing on list item')
})

await check('raw HTML in the source can never become markup', () => {
  const sink = renderTree(() => el('div', null, mod.renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n', {})))
  const text = textOf(sink)
  assert(text.includes('<script>alert(1)</script>'), 'script text was swallowed')
  assert(text.includes('<img src=x onerror=alert(1)>'), 'img text was swallowed')
  for (const entry of sink.elements) {
    assert(entry.props.dangerouslySetInnerHTML === undefined, 'renderer must not inject HTML')
  }
  assert(!sink.elements.some((entry) => entry.type === 'script' || entry.type === 'img'), 'raw tags leaked into the tree')
})

await check('unsafe link and image targets degrade to text', () => {
  assert(mod.safeHref('javascript:alert(1)') === null, 'javascript URL allowed')
  assert(mod.safeHref('data:text/html,<b>x</b>') === null, 'data URL allowed for links')
  assert(mod.safeHref('https://example.com/x') === 'https://example.com/x', 'https URL rejected')
  assert(mod.safeHref('/docs/intro') === '/docs/intro', 'absolute path rejected')
  assert(mod.safeHref('#anchor') === '#anchor', 'anchor rejected')
  assert(mod.safeImageSrc('data:image/png;base64,AAA') === 'data:image/png;base64,AAA', 'image data URL rejected')
  assert(mod.safeImageSrc('data:text/html,x') === null, 'html data URL allowed for images')

  const sink = renderTree(() => el('div', null, mod.renderMarkdown('[click](javascript:alert(1)) ![a](data:text/html,x)\n', {})))
  const anchor = sink.elements.find((entry) => entry.type === 'a')
  assert(anchor === undefined, 'javascript link still rendered as an anchor')
  assert(sink.elements.find((entry) => entry.type === 'img') === undefined, 'html data image rendered')
  assert(textOf(sink).includes('click') && textOf(sink).includes('a'), 'label text lost')
})

await check('toggleTaskLine flips only the addressed task', () => {
  const source = '- [ ] one\n- [x] two\nplain\n'
  const first = mod.toggleTaskLine(source, 0, true)
  assert(first === '- [x] one\n- [x] two\nplain\n', 'unexpected: ' + JSON.stringify(first))
  const second = mod.toggleTaskLine(source, 1, false)
  assert(second === '- [ ] one\n- [ ] two\nplain\n', 'unexpected: ' + JSON.stringify(second))
  const untouched = mod.toggleTaskLine(source, 2, true)
  assert(untouched === source, 'non-task line was rewritten')
  assert(mod.toggleTaskLine(source, 99, true) === source, 'out-of-range index changed the source')
  assert(mod.toggleTaskLine(source, -1, true) === source, 'negative index changed the source')
  assert(mod.toggleTaskLine(source, 1.5, true) === source, 'fractional index changed the source')
})

await check('task list checkbox in the preview flushes the edited document', async () => {
  const { props, calls } = makeEditorProps({ settings: { editorMode: 'split' }, node: null })
  props.node = props.snapshot.nodes[0]
  const sink = renderTree(mod.DocumentEditor, props)
  const box = sink.elements.find((entry) => entry.type === 'input' && entry.props.type === 'checkbox')
  assert(box !== undefined, 'preview checkbox missing')
  box.props.onChange({ target: { checked: true } })
  await sleep(520)
  assert(calls.setContent.length === 1, 'content was not flushed')
  assert(calls.setContent[0][0] === 'doc-1', 'wrong node id: ' + calls.setContent[0][0])
  assert(/^- \[x\] first/m.test(calls.setContent[0][1]), 'checkbox not written: ' + JSON.stringify(calls.setContent[0][1]))
})

await check('Ctrl+B wraps the selection and Ctrl+S saves', () => {
  const { props, calls } = makeEditorProps({ settings: { editorMode: 'split' } })
  const sink = renderTree(mod.DocumentEditor, props)
  const textarea = sink.elements.find((entry) => entry.type === 'textarea')
  assert(textarea !== undefined, 'textarea missing')
  const target = fakeTextarea('hello', 0, 5)
  let prevented = 0
  textarea.props.onKeyDown({ key: 'b', ctrlKey: true, altKey: false, preventDefault: () => (prevented += 1), currentTarget: target })
  assert(prevented === 1, 'default not prevented')
  textarea.props.onKeyDown({ key: 's', ctrlKey: true, altKey: false, preventDefault: () => {}, currentTarget: target })
  assert(calls.saveNow === 1, 'Ctrl+S did not save: ' + calls.saveNow)
  let tabPrevented = 0
  textarea.props.onKeyDown({ key: 'Tab', ctrlKey: false, preventDefault: () => (tabPrevented += 1), currentTarget: target })
  assert(tabPrevented === 1, 'Tab default not prevented')
  return sleep(520).then(() => {
    const staged = calls.setContent.map((entry) => entry[1]).join('')
    assert(staged.includes('  '), 'Tab did not stage two spaces: ' + JSON.stringify(staged))
  })
})

await check('markdownStats counts words, minutes and headings', () => {
  const stats = mod.markdownStats('# Title\n\none two three four\n')
  assert(stats.words === 5, 'unexpected word count: ' + stats.words)
  assert(stats.headings === 1, 'unexpected heading count: ' + stats.headings)
  assert(stats.minutes >= 1, 'reading time below one minute')
  assert(mod.markdownStats('').words === 0, 'empty document should have no words')
})

// ---------- report ----------
if (failures.length > 0) {
  console.error('editor test failures:\n' + failures.map((line) => ' - ' + line).join('\n'))
  console.error(passed + ' passed, ' + failures.length + ' failed')
  process.exit(1)
}
console.log('editor: ' + passed + ' checks passed')

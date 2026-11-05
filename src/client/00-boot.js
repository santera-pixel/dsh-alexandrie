// Shared boot: React access, element helper, icon set, utilities, plugin identity.

const PLUGIN_ID = 'dsh-scriptorium'
const PANEL_ID = 'dsh-scriptorium'
const PANEL_ORDER = 12
const ROUTE_BASE = '/dsh-scriptorium'

const React = require('react')
const h = React.createElement

/** Collects CSS from every client part; injected once at mount. */
const CSS_CHUNKS = []

/** Class name join that drops falsy entries. */
const cx = (...values) => values.filter(Boolean).join(' ')

/** Stable id with a readable prefix. */
const uid = (prefix = 'id') =>
  prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)

const nowIso = () => new Date().toISOString()

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** Debounce that keeps `.cancel()` and `.flush()` available for cleanup. */
function debounce(fn, delay) {
  let timer = null
  const wrapped = (...args) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, delay)
  }
  wrapped.cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  wrapped.flush = (...args) => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    fn(...args)
  }
  return wrapped
}

/** JSON RPC over the plugin's own HTTP route (same-origin, cookie authenticated). */
async function api(path, options = {}) {
  const init = { method: options.method || 'GET', headers: {} }
  if (options.body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }
  const response = await fetch(ROUTE_BASE + path, init)
  const text = await response.text()
  let payload = null
  try {
    payload = text === '' ? null : JSON.parse(text)
  } catch {
    throw new Error(`scriptorium: ${path}: response was not JSON (HTTP ${response.status})`)
  }
  if (!response.ok || payload === null || payload.ok !== true) {
    const message = (payload && payload.error && payload.error.message) || `HTTP ${response.status}`
    throw new Error(message)
  }
  return payload.value
}

/** Same envelope as `api`, but the request body is raw bytes (ZIP import, uploads). */
async function apiRaw(path, options = {}) {
  const init = { method: options.method || 'POST', headers: {} }
  if (options.body !== undefined) {
    init.headers['content-type'] = options.contentType || 'application/octet-stream'
    init.body = options.body
  }
  const response = await fetch(ROUTE_BASE + path, init)
  const text = await response.text()
  let payload = null
  try {
    payload = text === '' ? null : JSON.parse(text)
  } catch {
    throw new Error(`scriptorium: ${path}: response was not JSON (HTTP ${response.status})`)
  }
  if (!response.ok || payload === null || payload.ok !== true) {
    const message = (payload && payload.error && payload.error.message) || `HTTP ${response.status}`
    throw new Error(message)
  }
  return payload.value
}

/** Trigger a browser download for text content, without leaving the panel. */
function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  setTimeout(() => {
    URL.revokeObjectURL(url)
    anchor.remove()
  }, 1000)
}

/** Single-stroke icon set; every glyph shares the same 24×24 grid. */
const ICONS = {
  book: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5M8 7.5h7M8 11h5',
  folder: 'M3 8V6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H4.5A1.5 1.5 0 0 1 3 17.5z',
  doc: 'M6.5 3h7L19 8.5V21H6.5zM13 3v6h6M9.5 13h6M9.5 16.5h4',
  star: 'M12 3.6l2.6 5.3 5.9.9-4.3 4.2 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.8l5.9-.9z',
  search: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6zM15.8 15.8L21 21',
  plus: 'M12 5v14M5 12h14',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5a7.6 7.6 0 0 0 0-3l1.8-1.3-1.8-3.2-2.2.8a7.4 7.4 0 0 0-2.6-1.5L14.2 3H9.8l-.4 2.3a7.4 7.4 0 0 0-2.6 1.5l-2.2-.8L2.8 9.2l1.8 1.3a7.6 7.6 0 0 0 0 3L2.8 14.8l1.8 3.2 2.2-.8a7.4 7.4 0 0 0 2.6 1.5l.4 2.3h4.4l.4-2.3a7.4 7.4 0 0 0 2.6-1.5l2.2.8 1.8-3.2z',
  trash: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 13.5h9.2L17.5 7M10 11v6M14 11v6',
  restore: 'M4 12a8 8 0 1 0 2.6-5.9M4 4.5V10h5.5',
  chevron: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15',
  upload: 'M12 20V9M7.5 13.5L12 9l4.5 4.5M4.5 4.5h15',
  board: 'M4 5.5h5.2v13H4zM9.9 5.5h5.2v9H9.9zM15.8 5.5H21v11h-5.2z',
  list: 'M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01',
  command: 'M9 9h6v6H9zM9 9V6.5a2.5 2.5 0 1 0-2.5 2.5H9zM15 9V6.5A2.5 2.5 0 1 1 17.5 9H15zM9 15v2.5A2.5 2.5 0 1 1 6.5 15H9zM15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15z',
  check: 'M5 12.5l4.5 4.5L19 7',
  sparkles: 'M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7zM18 15l.9 2.1 2.1.9-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
  keyboard: 'M3 6.5h18v11H3zM6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8',
  warning: 'M12 4.5l8.5 15h-17zM12 10v4.5M12 17h.01',
  edit: 'M4 20h4l10-10-4-4L4 16zM14.5 5.5l4 4',
  bold: 'M7 4.5h5.5a3.5 3.5 0 0 1 0 7H7zM7 11.5h6.2a3.7 3.7 0 0 1 0 7.4H7z',
  italic: 'M10 4.5h7M7 19.5h7M14.5 4.5l-5 15',
  strike: 'M5 12h14M8.5 8.2A3.4 3.4 0 0 1 12 5.5c2 0 3.2.9 3.7 2M15.4 15.6c-.6 1.4-1.9 2.9-3.9 2.9-2.2 0-3.6-1.2-3.9-2.6',
  code: 'M9 7.5L4.5 12 9 16.5M15 7.5L19.5 12 15 16.5',
  heading: 'M5.5 5.5v13M18.5 5.5v13M5.5 12h13',
  listUl: 'M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01',
  listOl: 'M10 7h10M10 12h10M10 17h10M4 5.5h1.5V9M4 9h2M4 14.5h2l-2 3h2',
  quote: 'M9 6.5c-2.2 0-3.8 1.7-3.8 4 0 2.1 1.4 3.5 3.2 3.5.5 0 .9-.1 1.2-.2-.4 1.6-1.7 3-3.6 3.5M18.3 6.5c-2.2 0-3.8 1.7-3.8 4 0 2.1 1.4 3.5 3.2 3.5.5 0 .9-.1 1.2-.2-.4 1.6-1.7 3-3.6 3.5',
  table: 'M3.5 5.5h17v13h-17zM3.5 10h17M3.5 14.5h17M9.5 5.5v13M15 5.5v13',
  link: 'M10 13.5a4 4 0 0 0 5.7 0l2.4-2.4a4 4 0 0 0-5.7-5.7l-1.2 1.2M14 10.5a4 4 0 0 0-5.7 0l-2.4 2.4a4 4 0 0 0 5.7 5.7l1.2-1.2',
  image: 'M3.5 5.5h17v13h-17zM8.5 10.5a1.3 1.3 0 1 0 0-2.6 1.3 1.3 0 0 0 0 2.6zM4 16l4.5-4 3.5 3 3-2.5 5 4.5',
  hr: 'M4 12h16',
  save: 'M5 4.5h10L19.5 9v10.5H5zM8.5 4.5v5h7v-5M8.5 19.5v-5h7v5',
  copy: 'M9 9V5.5h10V16h-3.5M5 9h10v10.5H5z',
  drag: 'M9 6.5h.01M15 6.5h.01M9 12h.01M15 12h.01M9 17.5h.01M15 17.5h.01',
  sortAsc: 'M7 19V5M3.5 8.5L7 5l3.5 3.5M13 7h7M13 12h5M13 17h3',
  eye: 'M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6zM12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z',
  columns: 'M4 5h16v14H4zM9.3 5v14M14.6 5v14',
  sidebar: 'M4 5h16v14H4zM9.5 5v14',
  tag: 'M4 4.5h8L20 12.5 12.5 20 4 11.5zM8 8h.01',
  archive: 'M3.5 5.5h17v4h-17zM5 9.5V20h14V9.5M9.5 13h5',
  menu: 'M4 7h16M4 12h16M4 17h16',
  arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  refresh: 'M20 12a8 8 0 1 1-2.4-5.7M20 4.5V10h-5.5',
  filter: 'M4 5.5h16l-6 7v6l-4 2v-8z',
  minus: 'M5 12h14',
  fit: 'M9 4.5V9H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5',
  graph: 'M6 2a3 3 0 1 0 0 6 3 3 0 1 0 0-6M18 8a3 3 0 1 0 0 6 3 3 0 1 0 0-6M10.5 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6M8.4 6.7l7.2 2.6M16 13.5l-2.8 2.1M8.2 7.6l1.2 7.4',
  canvas: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8.5 13.5l2.4-2.2 2 1.8 1.5-1.3 2.1 2.2',
  minus: 'M5 12h14',
  graph: 'M6 2a3 3 0 1 0 0 6 3 3 0 1 0 0-6M18 8a3 3 0 1 0 0 6 3 3 0 1 0 0-6M10.5 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6M8.4 6.7l7.2 2.6M16 13.5l-3.2 2.1M8.2 7.6l1.3 7.4',
  canvas: 'M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8.5 13.5l2.4-2.2 2 1.8 1.5-1.3 2.1 2.2',
  fit: 'M9 4.5V9H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5',
}

function Icon({ name, size = 16, className }) {
  const path = ICONS[name] || ICONS.doc
  const dimension = typeof size === 'number' && size > 0 ? size : 16
  return h(
    'svg',
    {
      width: dimension,
      height: dimension,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      className: className,
    },
    h('path', { d: path }),
  )
}

/** Small icon button used across the shell. */
function IconButton({ icon, label, onClick, active, danger, disabled, size = 16, className }) {
  return h(
    'button',
    {
      type: 'button',
      className: cx('dsh-scr-icon-btn', active && 'is-active', danger && 'is-danger', className),
      title: label,
      'aria-label': label,
      'aria-pressed': active === undefined ? undefined : active ? 'true' : 'false',
      disabled: disabled === true,
      onClick: onClick,
    },
    h(Icon, { name: icon, size }),
  )
}

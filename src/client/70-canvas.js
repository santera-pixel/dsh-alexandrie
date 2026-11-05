// Media canvas: a freeform board where attachments and the documents they belong to
// become draggable cards joined by edges — the Obsidian-canvas feel for the media sandbox.
//
// Canvas data lives in `snapshot.canvas`:
//   items: [{ id: 'media:<id>' | 'doc:<id>', kind, refId, x, y, w, h, z }]
//   links: [{ id, from, to }]
// Item ids are derived from their target so a media file can never appear twice.

const CANVAS_ZOOM_MIN = 0.25
const CANVAS_ZOOM_MAX = 2.5
const CANVAS_MIN_W = 180
const CANVAS_MIN_H = 140
const CANVAS_MAX_W = 760
const CANVAS_MAX_H = 760
const CANVAS_DEFAULT_W = 300
const CANVAS_DEFAULT_H = 240
const CANVAS_GRID_X = 760
const CANVAS_GRID_Y = 620
const CANVAS_SLOT_X = 90
const CANVAS_SLOT_Y = 80

const canvasItemId = (kind, refId) => String(kind) + ':' + String(refId)

/** Split an item id back into its kind and target. */
function canvasRefOf(itemId) {
  const text = String(itemId || '')
  const cut = text.indexOf(':')
  if (cut <= 0 || cut === text.length - 1) return null
  const kind = text.slice(0, cut)
  if (kind !== 'media' && kind !== 'doc') return null
  return { kind, refId: text.slice(cut + 1) }
}

/** Deterministic grid slot so fresh cards never stack on top of each other. */
function canvasSlot(index) {
  const safe = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0
  return {
    x: CANVAS_SLOT_X + (safe % 2) * CANVAS_GRID_X,
    y: CANVAS_SLOT_Y + Math.floor(safe / 2) * CANVAS_GRID_Y,
  }
}

function canvasMediaIndex(snapshot) {
  const index = new Map()
  for (const entry of allMedia(snapshot)) index.set(String(entry.media.id), entry)
  return index
}

/** Items whose target still exists (a trashed document hides itself and its links). */
function canvasResolved(snapshot) {
  const canvas = snapshot && snapshot.canvas && typeof snapshot.canvas === 'object' ? snapshot.canvas : { items: [], links: [] }
  const items = Array.isArray(canvas.items) ? canvas.items : []
  const mediaIndex = canvasMediaIndex(snapshot)
  const resolved = []
  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const ref = canvasRefOf(item.id)
    if (ref === null) continue
    if (ref.kind === 'media') {
      const entry = mediaIndex.get(ref.refId)
      if (entry === undefined) continue
      resolved.push({ item, kind: 'media', media: entry.media, node: entry.node })
    } else {
      const node = model.nodeById(snapshot, ref.refId)
      if (node === null || node.kind !== 'doc' || node.trashed === true) continue
      resolved.push({ item, kind: 'doc', node })
    }
  }
  return resolved
}

/** Beziers that hug whichever sides of the two cards face each other. */
function canvasEdgePath(left, right) {
  const a = { x: left.x, y: left.y, w: left.w, h: left.h }
  const b = { x: right.x, y: right.y, w: right.w, h: right.h }
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const dx = bc.x - ac.x
  const dy = bc.y - ac.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const dir = dx >= 0 ? 1 : -1
    const start = { x: ac.x + (dir * a.w) / 2, y: ac.y }
    const end = { x: bc.x - (dir * b.w) / 2, y: bc.y }
    const pull = Math.max(40, Math.abs(end.x - start.x) * 0.45)
    return 'M' + round2(start.x) + ' ' + round2(start.y) + ' C' + round2(start.x + dir * pull) + ' ' + round2(start.y) + ' ' + round2(end.x - dir * pull) + ' ' + round2(end.y) + ' ' + round2(end.x) + ' ' + round2(end.y)
  }
  const dir = dy >= 0 ? 1 : -1
  const start = { x: ac.x, y: ac.y + (dir * a.h) / 2 }
  const end = { x: bc.x, y: bc.y - (dir * b.h) / 2 }
  const pull = Math.max(40, Math.abs(end.y - start.y) * 0.45)
  return 'M' + round2(start.x) + ' ' + round2(start.y) + ' C' + round2(start.x) + ' ' + round2(start.y + dir * pull) + ' ' + round2(end.x) + ' ' + round2(end.y - dir * pull) + ' ' + round2(end.x) + ' ' + round2(end.y)
}

const round2 = (value) => Math.round(value * 100) / 100

function canvasBounds(items) {
  if (items.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of items) {
    minX = Math.min(minX, item.x)
    minY = Math.min(minY, item.y)
    maxX = Math.max(maxX, item.x + item.w)
    maxY = Math.max(maxY, item.y + item.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Fit every card in the viewport; empty canvas falls back to the identity view. */
function canvasFit(items, size, padding) {
  const bounds = canvasBounds(items)
  const pad = padding === undefined ? 64 : padding
  const width = size && size.w > 0 ? size.w : 960
  const height = size && size.h > 0 ? size.h : 620
  if (bounds === null) return { x: 0, y: 0, zoom: 1 }
  const zoom = clamp(Math.min((width - pad * 2) / Math.max(bounds.w, 1), (height - pad * 2) / Math.max(bounds.h, 1)), CANVAS_ZOOM_MIN, 1.35)
  return {
    zoom,
    x: (width - bounds.w * zoom) / 2 - bounds.x * zoom,
    y: (height - bounds.h * zoom) / 2 - bounds.y * zoom,
  }
}

/** Zoom around a screen-space anchor, so the card under the pointer stays put. */
function canvasZoom(view, factor, point) {
  const current = view !== null && typeof view === 'object' ? view : { x: 0, y: 0, zoom: 1 }
  const from = clamp(Number(current.zoom) || 1, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX)
  const next = clamp(from * factor, CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX)
  const anchor = point !== null && typeof point === 'object' ? point : { x: 0, y: 0 }
  const ratio = next / from
  const x = Number(current.x) || 0
  const y = Number(current.y) || 0
  return {
    zoom: next,
    x: anchor.x - (anchor.x - x) * ratio,
    y: anchor.y - (anchor.y - y) * ratio,
  }
}

/* ------------------------------------------------------------------ mutators */

function canvasEnsureItem(draft, kind, refId, position) {
  if (!draft.canvas || typeof draft.canvas !== 'object') draft.canvas = { items: [], links: [] }
  if (!Array.isArray(draft.canvas.items)) draft.canvas.items = []
  if (!Array.isArray(draft.canvas.links)) draft.canvas.links = []
  const id = canvasItemId(kind, refId)
  const existing = draft.canvas.items.find((item) => item !== null && item.id === id)
  if (existing !== undefined) return existing
  const count = draft.canvas.items.length
  const slot = position || canvasSlot(count)
  const item = {
    id,
    kind,
    refId: String(refId),
    x: Math.round(slot.x),
    y: Math.round(slot.y),
    w: CANVAS_DEFAULT_W,
    h: CANVAS_DEFAULT_H,
    z: count,
  }
  draft.canvas.items.push(item)
  return item
}

function canvasLinkId(from, to) {
  const pair = [String(from), String(to)].sort()
  return 'link:' + pair[0] + '::' + pair[1]
}

function canvasLink(draft, from, to) {
  if (from === to) return null
  if (!draft.canvas || !Array.isArray(draft.canvas.items)) return null
  const exists = (id) => draft.canvas.items.some((item) => item !== null && item.id === id)
  if (!exists(from) || !exists(to)) return null
  if (!Array.isArray(draft.canvas.links)) draft.canvas.links = []
  const id = canvasLinkId(from, to)
  const existing = draft.canvas.links.find((link) => link !== null && link.id === id)
  if (existing !== undefined) return existing
  const link = { id, from: String(from), to: String(to) }
  draft.canvas.links.push(link)
  return link
}

/** Make every attachment in `entries` visible, together with its owning document. */
function canvasSyncMedia(draft, entries) {
  let added = 0
  for (const entry of entries) {
    if (entry === null || entry === undefined || entry.media === undefined || entry.node === undefined) continue
    const mediaId = canvasItemId('media', entry.media.id)
    const before = canvasResolved(draft).some((row) => row.item.id === mediaId)
    const mediaItem = canvasEnsureItem(draft, 'media', entry.media.id)
    if (!before) added += 1
    const docItem = canvasEnsureItem(draft, 'doc', entry.node.id, {
      x: mediaItem.x + (Number.isFinite(mediaItem.w) ? mediaItem.w : CANVAS_DEFAULT_W) + 46,
      y: mediaItem.y + 18,
    })
    canvasLink(draft, mediaItem.id, docItem.id)
  }
  return added
}

function canvasRemoveItem(draft, itemId) {
  if (!draft.canvas) return
  draft.canvas.items = (draft.canvas.items || []).filter((item) => item !== null && item.id !== itemId)
  draft.canvas.links = (draft.canvas.links || []).filter((link) => link !== null && link.from !== itemId && link.to !== itemId)
}

function canvasMoveItem(draft, itemId, x, y) {
  const item = (draft.canvas && draft.canvas.items ? draft.canvas.items : []).find((entry) => entry !== null && entry.id === itemId)
  if (item === undefined) return
  item.x = Math.round(Number.isFinite(x) ? x : item.x)
  item.y = Math.round(Number.isFinite(y) ? y : item.y)
}

function canvasResizeItem(draft, itemId, w, h) {
  const item = (draft.canvas && draft.canvas.items ? draft.canvas.items : []).find((entry) => entry !== null && entry.id === itemId)
  if (item === undefined) return
  item.w = Math.round(clamp(Number.isFinite(w) ? w : item.w, CANVAS_MIN_W, CANVAS_MAX_W))
  item.h = Math.round(clamp(Number.isFinite(h) ? h : item.h, CANVAS_MIN_H, CANVAS_MAX_H))
}

function canvasRaiseItem(draft, itemId) {
  const items = draft.canvas && Array.isArray(draft.canvas.items) ? draft.canvas.items : []
  const top = items.reduce((max, item) => Math.max(max, Number(item.z) || 0), 0)
  const item = items.find((entry) => entry !== null && entry.id === itemId)
  if (item !== undefined) item.z = top + 1
}

function canvasRemoveLink(draft, linkId) {
  if (!draft.canvas) return
  draft.canvas.links = (draft.canvas.links || []).filter((link) => link !== null && link.id !== linkId)
}

/* ----------------------------------------------------------------- component */

const canvasModel = {
  CANVAS_ZOOM_MIN,
  CANVAS_ZOOM_MAX,
  canvasItemId,
  canvasRefOf,
  canvasSlot,
  canvasResolved,
  canvasEdgePath,
  canvasBounds,
  canvasFit,
  canvasZoom,
  canvasEnsureItem,
  canvasLink,
  canvasLinkId,
  canvasSyncMedia,
  canvasRemoveItem,
  canvasMoveItem,
  canvasResizeItem,
  canvasRaiseItem,
  canvasRemoveLink,
}

function CanvasCard({ row, style, selected, linkSource, linkMode, onPointerDown, onCardClick, onOpen, onPreview, onRemove, onStartLink, onResize, onFocus }) {
  const media = row.media
  const kind = row.kind
  const title = kind === 'doc' ? row.node.title : String(media.name || 'Attachment')
  const subtitle =
    kind === 'doc'
      ? model.statusLabelOf(row.node.status) + ' · ' + model.wordCountOf(row.node.content || '') + ' words'
      : mediaKindOf(media).toUpperCase() + ' · ' + mediaSizeLabel(media)
  return h(
    'div',
    {
      className: cx(
        'dsh-scr-canvas-card',
        selected && 'is-selected',
        linkSource && 'is-link-source',
        linkMode && 'is-linkable',
        'is-' + kind,
      ),
      style,
      'data-canvas-item': row.item.id,
      role: 'group',
      'aria-label': title,
      tabIndex: 0,
      onFocus: () => onFocus(row.item.id),
      onMouseDown: onPointerDown,
      onClick: onCardClick,
    },
    h(
      'div',
      { className: 'dsh-scr-canvas-cardbody' },
      kind === 'media' && mediaKindOf(media) === 'image'
        ? h('img', { className: 'dsh-scr-canvas-thumb', src: mediaUrl(media), alt: title, draggable: false, loading: 'lazy' })
        : h(
            'div',
            { className: cx('dsh-scr-canvas-placeholder', 'is-' + (kind === 'doc' ? 'doc' : mediaKindOf(media))) },
            h(Icon, { name: kind === 'doc' ? row.node.icon || 'doc' : mediaIconOf(media), size: 30 }),
          ),
      h(
        'div',
        { className: 'dsh-scr-canvas-caption' },
        h('div', { className: 'dsh-scr-canvas-title', title }, title),
        h('div', { className: 'dsh-scr-canvas-sub' }, subtitle),
      ),
    ),
    h(
      'div',
      { className: 'dsh-scr-canvas-cardfoot' },
      kind === 'media'
        ? h(
            'button',
            {
              type: 'button',
              className: 'dsh-scr-canvas-owner',
              title: 'Open the document this attachment belongs to',
              onClick: (event) => {
                event.stopPropagation()
                if (row.node) onOpen(row.node.id)
              },
            },
            h(Icon, { name: 'doc', size: 11 }),
            row.node ? row.node.title : 'Unknown document',
          )
        : h('span', { className: 'dsh-scr-canvas-owner is-static' }, h(Icon, { name: 'doc', size: 11 }), 'Document'),
      h('span', { className: 'dsh-scr-canvas-spacer' }),
      kind === 'media'
        ? h(IconButton, { icon: 'eye', label: 'Preview ' + title, size: 13, onClick: (event) => { event.stopPropagation(); onPreview(media) } })
        : h(IconButton, { icon: 'arrowRight', label: 'Open ' + title, size: 13, onClick: (event) => { event.stopPropagation(); onOpen(row.node.id) } }),
      h(IconButton, { icon: 'link', label: 'Link from ' + title, size: 13, active: linkSource, onClick: (event) => { event.stopPropagation(); onStartLink(row.item.id) } }),
      h(IconButton, { icon: 'close', label: 'Remove from canvas', size: 13, danger: true, onClick: (event) => { event.stopPropagation(); onRemove(row.item.id) } }),
    ),
    h('span', { className: 'dsh-scr-canvas-resize', title: 'Resize', onMouseDown: onResize }),
  )
}

function MediaCanvas(props) {
  const input = props || {}
  const store = input.store
  const snapshot = input.snapshot || { nodes: [], canvas: { items: [], links: [] } }
  const workspaceId = input.workspaceId || undefined
  const notify = typeof input.notify === 'function' ? input.notify : () => {}
  const onOpen = typeof input.onOpen === 'function' ? input.onOpen : () => {}
  const onPreview = typeof input.onPreview === 'function' ? input.onPreview : () => {}

  const [view, setView] = React.useState({ x: 0, y: 0, zoom: 1 })
  const [selected, setSelected] = React.useState(null)
  const [selectedLink, setSelectedLink] = React.useState(null)
  const [linkMode, setLinkMode] = React.useState(false)
  const [linkFrom, setLinkFrom] = React.useState(null)
  const [drag, setDrag] = React.useState(null)
  const [resized, setResized] = React.useState(null)
  const [size, setSize] = React.useState({ w: 960, h: 620 })
  const [hint, setHint] = React.useState(null)

  const viewportRef = React.useRef(null)
  const rootRef = React.useRef(null)
  const dragRef = React.useRef(null)
  const resizedRef = React.useRef(null)
  const syncedRef = React.useRef(false)
  const viewRef = React.useRef(view)
  viewRef.current = view

  const rows = canvasResolved(snapshot)
  const links = (snapshot.canvas && Array.isArray(snapshot.canvas.links) ? snapshot.canvas.links : []).filter(
    (link) => link !== null && link.from !== link.to && rows.some((row) => row.item.id === link.from) && rows.some((row) => row.item.id === link.to),
  )
  const docs = model.docsOf(snapshot, workspaceId)

  React.useEffect(() => {
    const element = viewportRef.current
    if (element === null) return undefined
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setSize({ w: Math.round(rect.width), h: Math.round(rect.height) })
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(element)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Wheel zoom is a native listener so the browser does not scroll the panel behind it.
  React.useEffect(() => {
    const element = viewportRef.current
    if (element === null) return undefined
    const onWheel = (event) => {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      const rect = element.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const factor = Math.exp(-Number(event.deltaY || 0) * 0.0015)
      setView((current) => canvasZoom(current, factor, point))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  // First visit: float every existing attachment and its document onto the canvas.
  React.useEffect(() => {
    if (syncedRef.current || store === undefined) return
    syncedRef.current = true
    const entries = allMedia(snapshot).filter((entry) => workspaceId === undefined || entry.node.workspaceId === workspaceId)
    if (entries.length === 0) return
    const missing = entries.filter((entry) => !rows.some((row) => row.item.id === canvasItemId('media', entry.media.id)))
    if (missing.length === 0) return
    store.commit((draft) => canvasSyncMedia(draft, missing))
    setHint('Placed ' + missing.length + ' attachment(s) on the canvas')
  }, [])

  const selectedRow = selected === null ? null : rows.find((row) => row.item.id === selected) || null
  const displayRow = (row) => {
    if (drag !== null && drag.id === row.item.id) return Object.assign({}, row, { item: Object.assign({}, row.item, { x: drag.x, y: drag.y }) })
    if (resized !== null && resized.id === row.item.id) return Object.assign({}, row, { item: Object.assign({}, row.item, { w: resized.w, h: resized.h }) })
    return row
  }
  const displayRows = rows.map(displayRow)
  const rectOf = (itemId) => {
    const row = displayRows.find((entry) => entry.item.id === itemId)
    return row === undefined ? null : { x: row.item.x, y: row.item.y, w: row.item.w, h: row.item.h }
  }

  const clearModes = () => {
    setLinkMode(false)
    setLinkFrom(null)
    setSelectedLink(null)
  }

  const finishLink = (targetId) => {
    if (linkFrom === null) {
      setLinkFrom(targetId)
      setSelected(targetId)
      return
    }
    if (linkFrom === targetId) {
      setLinkFrom(null)
      return
    }
    store.commit((draft) => {
      canvasLink(draft, linkFrom, targetId)
    })
    setLinkFrom(null)
    setLinkMode(false)
    notify('Cards linked', 'success')
  }

  const onCardClick = (row) => (event) => {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
    if (linkMode) {
      finishLink(row.item.id)
      return
    }
    setSelected(row.item.id)
    setSelectedLink(null)
    if (rootRef.current !== null && typeof rootRef.current.focus === 'function') rootRef.current.focus()
  }

  const onCardPointerDown = (row) => (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (linkMode) return
    if (target && typeof target.closest === 'function' && target.closest('button, a, input, select, textarea, .dsh-scr-canvas-resize')) return
    event.preventDefault()
    event.stopPropagation()
    if (rootRef.current !== null && typeof rootRef.current.focus === 'function') rootRef.current.focus()
    setSelected(row.item.id)
    setSelectedLink(null)
    const start = { clientX: event.clientX, clientY: event.clientY, x: row.item.x, y: row.item.y, id: row.item.id }
    dragRef.current = start
    store.commit((draft) => canvasRaiseItem(draft, row.item.id))
    const move = (moveEvent) => {
      const ratio = viewRef.current.zoom || 1
      const next = {
        id: start.id,
        x: Math.round(start.x + (moveEvent.clientX - start.clientX) / ratio),
        y: Math.round(start.y + (moveEvent.clientY - start.clientY) / ratio),
      }
      dragRef.current = Object.assign({}, start, next)
      setDrag(next)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
      const final = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (final && (final.x !== start.x || final.y !== start.y)) {
        store.commit((draft) => canvasMoveItem(draft, start.id, final.x, final.y))
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
  }

  const onStartResize = (row) => (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const start = { clientX: event.clientX, clientY: event.clientY, w: row.item.w, h: row.item.h, id: row.item.id }
    resizedRef.current = start
    const move = (moveEvent) => {
      const ratio = viewRef.current.zoom || 1
      const next = {
        id: start.id,
        w: Math.round(clamp(start.w + (moveEvent.clientX - start.clientX) / ratio, CANVAS_MIN_W, CANVAS_MAX_W)),
        h: Math.round(clamp(start.h + (moveEvent.clientY - start.clientY) / ratio, CANVAS_MIN_H, CANVAS_MAX_H)),
      }
      resizedRef.current = Object.assign({}, start, next)
      setResized(next)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
      const final = resizedRef.current
      resizedRef.current = null
      setResized(null)
      if (final && (final.w !== start.w || final.h !== start.h)) {
        store.commit((draft) => canvasResizeItem(draft, start.id, final.w, final.h))
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
  }

  const onBackgroundDown = (event) => {
    if (event.button !== 0) return
    const target = event.target
    if (target && typeof target.closest === 'function' && target.closest('.dsh-scr-canvas-card, .dsh-scr-canvas-toolbar, .dsh-scr-canvas-edgehit, button, select, input')) return
    if (linkMode) {
      setLinkFrom(null)
      return
    }
    setSelected(null)
    setSelectedLink(null)
    const start = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y }
    const move = (moveEvent) => setView((current) => Object.assign({}, current, { x: start.x + (moveEvent.clientX - start.clientX), y: start.y + (moveEvent.clientY - start.clientY) }))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
  }

  const zoomBy = (factor) => setView((current) => canvasZoom(current, factor, { x: size.w / 2, y: size.h / 2 }))
  const fit = () => setView(canvasFit(displayRows.map((row) => row.item), size))
  const reset = () => setView({ x: 0, y: 0, zoom: 1 })

  const addDocument = (nodeId) => {
    if (nodeId === '') return
    store.commit((draft) => canvasEnsureItem(draft, 'doc', nodeId))
    notify('Document added to the canvas', 'success')
  }

  const syncMedia = () => {
    const entries = allMedia(snapshot).filter((entry) => workspaceId === undefined || entry.node.workspaceId === workspaceId)
    let added = 0
    store.commit((draft) => {
      added = canvasSyncMedia(draft, entries)
    })
    notify(added === 0 ? 'Every attachment is already on the canvas' : added + ' attachment(s) placed', added === 0 ? 'info' : 'success')
  }

  const removeRow = (itemId) => {
    store.commit((draft) => canvasRemoveItem(draft, itemId))
    if (selected === itemId) setSelected(null)
    notify('Removed from the canvas (the file stays in the library)', 'info')
  }

  const removeSelected = () => {
    if (selectedLink !== null) {
      store.commit((draft) => canvasRemoveLink(draft, selectedLink))
      setSelectedLink(null)
      notify('Link removed', 'info')
      return
    }
    if (selected !== null) removeRow(selected)
  }

  const openRow = (row) => {
    if (row.kind === 'doc') onOpen(row.node.id)
    else onPreview(row.media)
  }

  const onKeyDown = (event) => {
    if (event.defaultPrevented) return
    const target = event.target
    const tag = target !== null && target !== undefined ? String(target.tagName || '') : ''
    // Never hijack keys aimed at the toolbar, a form control, or a card's own buttons.
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || (target !== null && target !== undefined && target.isContentEditable === true)) return
    const key = event.key
    if (key === 'Escape') {
      clearModes()
      return
    }
    if ((key === 'Delete' || key === 'Backspace') && (selected !== null || selectedLink !== null)) {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      removeSelected()
      return
    }
    if (key === 'Enter' && selectedRow !== null) {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      openRow(selectedRow)
      return
    }
    if (selectedRow === null) return
    const step = event.shiftKey ? 40 : 10
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[key] !== undefined) {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      const [dx, dy] = moves[key]
      store.commit((draft) => canvasMoveItem(draft, selectedRow.item.id, selectedRow.item.x + dx, selectedRow.item.y + dy))
    }
  }

  const linkCount = links.length
  return h(
    'div',
    { className: 'dsh-scr-canvas', ref: rootRef, tabIndex: 0, onKeyDown, role: 'application', 'aria-label': 'Media canvas' },
    h(
      'div',
      { className: 'dsh-scr-canvas-toolbar' },
      h(
        'span',
        { className: 'dsh-scr-canvas-badge' },
        h(Icon, { name: 'canvas', size: 14 }),
        rows.length + ' card(s)',
      ),
      h(
        'span',
        { className: 'dsh-scr-canvas-badge is-quiet' },
        linkCount + ' link(s)',
        hint ? ' · ' + hint : '',
      ),
      h('span', { className: 'dsh-scr-canvas-spacer' }),
      h(
        'select',
        {
          className: 'dsh-scr-canvas-select',
          value: '',
          title: 'Add a document to the canvas',
          onChange: (event) => {
            addDocument(event.target.value)
            event.target.value = ''
          },
        },
        [h('option', { value: '', key: '__placeholder' }, 'Add document…')].concat(
          docs.map((node) => h('option', { value: node.id, key: node.id }, node.title)),
        ),
      ),
      h('button', { type: 'button', className: 'dsh-scr-btn is-ghost', title: 'Place every attachment from this workspace', onClick: syncMedia }, h(Icon, { name: 'refresh', size: 13 }), 'Sync media'),
      h(IconButton, { icon: 'link', label: 'Link two cards', active: linkMode, onClick: () => { setLinkMode((value) => !value); setLinkFrom(null) } }),
      h('span', { className: 'dsh-scr-canvas-sep' }),
      h(IconButton, { icon: 'minus', label: 'Zoom out', onClick: () => zoomBy(1 / 1.2) }),
      h('span', { className: 'dsh-scr-canvas-zoom' }, Math.round(view.zoom * 100) + '%'),
      h(IconButton, { icon: 'plus', label: 'Zoom in', onClick: () => zoomBy(1.2) }),
      h(IconButton, { icon: 'fit', label: 'Fit all cards', onClick: fit }),
      h('button', { type: 'button', className: 'dsh-scr-btn is-ghost', onClick: reset }, '100%'),
      h(IconButton, { icon: 'trash', label: 'Remove selection', danger: true, disabled: selected === null && selectedLink === null, onClick: removeSelected }),
    ),
    hint !== null
      ? h('div', { className: 'dsh-scr-canvas-note', role: 'status' }, hint, h('button', { type: 'button', className: 'dsh-scr-canvas-notebtn', onClick: () => setHint(null) }, 'Dismiss'))
      : null,
    h(
      'div',
      {
        className: cx('dsh-scr-canvas-viewport', linkMode && 'is-linking'),
        ref: viewportRef,
        onMouseDown: onBackgroundDown,
        style: { backgroundSize: Math.max(12, Math.round(26 * view.zoom)) + 'px ' + Math.max(12, Math.round(26 * view.zoom)) + 'px', backgroundPosition: view.x + 'px ' + view.y + 'px' },
      },
      h(
        'div',
        { className: 'dsh-scr-canvas-stage', style: { transform: 'translate(' + view.x + 'px, ' + view.y + 'px) scale(' + view.zoom + ')' } },
        h(
          'svg',
          { className: 'dsh-scr-canvas-edges', width: 1, height: 1, 'aria-hidden': 'true' },
          links.map((link) => {
            const left = rectOf(link.from)
            const right = rectOf(link.to)
            if (left === null || right === null) return null
            const d = canvasEdgePath(left, right)
            const active = selectedLink === link.id
            return h(
              'g',
              { key: link.id, className: cx('dsh-scr-canvas-edgegroup', active && 'is-selected') },
              h('path', {
                className: 'dsh-scr-canvas-edgehit',
                d,
                onMouseDown: (event) => {
                  event.stopPropagation()
                  setSelectedLink(link.id)
                  setSelected(null)
                },
              }),
              h('path', { className: cx('dsh-scr-canvas-edge', active && 'is-selected'), d }),
            )
          }),
        ),
        displayRows.map((row) => {
          const item = row.item
          const z = Number(item.z) || 0
          return h(CanvasCard, {
            key: row.item.id,
            row,
            selected: selected === row.item.id,
            linkSource: linkFrom === row.item.id,
            linkMode,
            style: { left: item.x, top: item.y, width: item.w, height: item.h, zIndex: 10 + z },
            onPointerDown: onCardPointerDown(row),
            onCardClick: onCardClick(row),
            onOpen,
            onPreview,
            onFocus: (itemId) => {
              setSelected(itemId)
              setSelectedLink(null)
            },
            onRemove: removeRow,
            onStartLink: (itemId) => {
              setLinkMode(true)
              setLinkFrom(itemId)
              setSelected(itemId)
            },
            onResize: onStartResize(row),
          })
        }),
      ),
      rows.length === 0
        ? h(
            'div',
            { className: 'dsh-scr-canvas-emptystate' },
            h(Icon, { name: 'canvas', size: 26 }),
            h('strong', null, 'Your media canvas is empty'),
            h('span', null, 'Attach files to a document from its editor, then press "Sync media" — each image lands here beside its document.'),
            h('button', { type: 'button', className: 'dsh-scr-btn is-primary', onClick: syncMedia }, h(Icon, { name: 'refresh', size: 13 }), 'Sync media'),
          )
        : null,
      linkMode
        ? h('div', { className: 'dsh-scr-canvas-hintbar' }, linkFrom === null ? 'Pick the first card to connect' : 'Now pick the card to connect it to · Esc to cancel')
        : null,
      selectedLink !== null
        ? h(
            'div',
            { className: 'dsh-scr-canvas-hintbar is-active' },
            'Link selected · press Delete to remove it',
            h('button', { type: 'button', className: 'dsh-scr-btn is-danger is-small', onClick: removeSelected }, 'Delete link'),
          )
        : null,
    ),
  )
}

const CANVAS_CSS = `
.dsh-scr-canvas { display: flex; flex-direction: column; height: 100%; min-height: 460px; outline: none; position: relative; }
.dsh-scr-canvas-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: color-mix(in srgb, var(--dsw-alias-bg-base) 92%, var(--dsw-alias-bg-layer-1)); flex-wrap: wrap; }
.dsh-scr-canvas-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsh-scr-canvas-badge.is-quiet { font-weight: 500; opacity: .85; }
.dsh-scr-canvas-spacer { flex: 1 1 auto; }
.dsh-scr-canvas-sep { width: 1px; height: 18px; margin: 0 4px; background: var(--dsw-alias-border-l1); }
.dsh-scr-canvas-zoom { min-width: 40px; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.dsh-scr-canvas-select { max-width: 190px; height: 28px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; padding: 0 8px; }
.dsh-scr-canvas-note { display: flex; align-items: center; gap: 10px; padding: 6px 14px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-scr-canvas-notebtn { border: 0; background: transparent; color: var(--dsw-alias-brand-primary); font-size: 11.5px; font-weight: 600; cursor: pointer; }
.dsh-scr-canvas-viewport { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; cursor: grab; background-color: var(--dsw-alias-bg-base); background-image: radial-gradient(color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent) 1px, transparent 1px); background-size: 22px 22px; background-position: -1px -1px; }
.dsh-scr-canvas-viewport:active { cursor: grabbing; }
.dsh-scr-canvas-viewport.is-linking { cursor: crosshair; }
.dsh-scr-canvas-stage { position: absolute; inset: 0; transform-origin: 0 0; }
.dsh-scr-canvas-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.dsh-scr-canvas-edge { fill: none; stroke: color-mix(in srgb, var(--dsw-alias-label-secondary) 48%, transparent); stroke-width: 1.6; transition: stroke .16s ease; }
.dsh-scr-canvas-edge.is-selected { stroke: var(--dsw-alias-brand-primary); stroke-width: 2.4; }
.dsh-scr-canvas-edgehit { fill: none; stroke: transparent; stroke-width: 20; pointer-events: stroke; cursor: pointer; }
.dsh-scr-canvas-card { position: absolute; display: flex; flex-direction: column; border-radius: 12px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); box-shadow: 0 8px 22px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); overflow: hidden; cursor: grab; transition: box-shadow .16s ease, border-color .16s ease; animation: dsh-scr-canvas-in .26s cubic-bezier(.22,.61,.36,1) both; }
.dsh-scr-canvas-card:hover { border-color: var(--dsw-alias-border-l2); box-shadow: 0 12px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent); }
.dsh-scr-canvas-card.is-selected { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 40%, transparent), 0 12px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent); }
.dsh-scr-canvas-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dsh-scr-canvas-card.is-linkable { cursor: crosshair; }
.dsh-scr-canvas-card.is-link-source { box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary), 0 0 0 6px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
.dsh-scr-canvas-cardbody { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.dsh-scr-canvas-thumb { width: 100%; flex: 1 1 auto; min-height: 0; object-fit: cover; display: block; pointer-events: none; background: var(--dsw-alias-bg-layer-2); }
.dsh-scr-canvas-placeholder { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-secondary); background: linear-gradient(140deg, color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent), var(--dsw-alias-bg-layer-2)); }
.dsh-scr-canvas-placeholder.is-doc { color: var(--dsw-alias-brand-primary); }
.dsh-scr-canvas-caption { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; background: var(--dsw-alias-bg-layer-1); border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-scr-canvas-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-scr-canvas-sub { font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dsh-scr-canvas-cardfoot { display: flex; align-items: center; gap: 2px; padding: 3px 4px 3px 6px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.dsh-scr-canvas-owner { display: inline-flex; align-items: center; gap: 4px; max-width: 62%; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font-size: 10.5px; cursor: pointer; padding: 2px 4px; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-scr-canvas-owner:hover { color: var(--dsw-alias-brand-primary); background: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); }
.dsh-scr-canvas-owner.is-static { cursor: default; }
.dsh-scr-canvas-resize { position: absolute; right: -1px; bottom: -1px; width: 16px; height: 16px; cursor: nwse-resize; background: linear-gradient(135deg, transparent 46%, color-mix(in srgb, var(--dsw-alias-label-secondary) 55%, transparent) 47%, transparent 58%, color-mix(in srgb, var(--dsw-alias-label-secondary) 55%, transparent) 59%, transparent 70%); }
.dsh-scr-canvas-emptystate { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 24px; color: var(--dsw-alias-label-secondary); pointer-events: none; }
.dsh-scr-canvas-emptystate strong { color: var(--dsw-alias-label-primary); font-size: 14px; }
.dsh-scr-canvas-emptystate span { max-width: 340px; font-size: 12px; line-height: 1.5; }
.dsh-scr-canvas-emptystate .dsh-scr-btn { pointer-events: auto; margin-top: 4px; }
.dsh-scr-canvas-hintbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 999px; font-size: 11.5px; font-weight: 500; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); animation: dsh-scr-pop .18s ease both; }
.dsh-scr-canvas-hintbar.is-active { border-color: var(--dsw-alias-brand-primary); }
@keyframes dsh-scr-canvas-in { from { opacity: 0; transform: scale(.96) } to { opacity: 1; transform: none } }
@media (max-width: 1100px) { .dsh-scr-canvas-select { max-width: 120px; } .dsh-scr-canvas-badge.is-quiet { display: none; } }
`

CSS_CHUNKS.push(CANVAS_CSS)

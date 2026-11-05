// Mind graph: an Obsidian-style map of notes and the links between them.
//
// Edges come from two syntaxes inside note bodies:
//   [[Another note]]            wiki link, `#heading` and `|alias` tolerated
//   [label](note:<id>)          explicit Markdown link to a note id
// Titles are resolved case-insensitively, so renaming a note keeps old links working
// only while a `[[old title]]` still matches something. Unresolved links are ignored.
//
// Layout is a small force simulation with deterministic seeds, so the same archive
// always opens with the same shape. `layoutGraph` is pure and unit-tested.

const GRAPH_LINK_PATTERNS = [
  { kind: 'wiki', pattern: /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g },
  { kind: 'markdown', pattern: /\[([^\]]*)\]\((?:alexandrie:\/\/|note:)([^)\s]+)\)/g },
]

function normalizeTitle(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

/** Raw link targets mentioned in one document. */
function graphLinksOf(content) {
  const text = String(content || '')
  const links = []
  for (const spec of GRAPH_LINK_PATTERNS) {
    const pattern = new RegExp(spec.pattern.source, spec.pattern.flags)
    let match = pattern.exec(text)
    while (match !== null) {
      if (spec.kind === 'wiki') links.push({ kind: 'wiki', target: match[1], alias: match[2] || '' })
      else links.push({ kind: 'markdown', target: match[2], alias: match[1] || '' })
      match = pattern.exec(text)
    }
  }
  return links
}

/** Build the node/edge model from the live snapshot. */
function buildGraph(snapshot, options) {
  const opts = options || {}
  const workspaceId = opts.workspaceId
  const scopeAll = opts.scopeAll === true
  const showTags = opts.showTags === true
  const docs = aliveNodes(snapshot).filter(
    (node) => node.kind === 'doc' && (scopeAll || workspaceId === undefined || workspaceId === null || node.workspaceId === workspaceId),
  )
  const byId = new Map()
  const byTitle = new Map()
  for (const node of docs) {
    byId.set(node.id, node)
    const key = normalizeTitle(node.title)
    if (!byTitle.has(key)) byTitle.set(key, node)
  }

  const nodes = docs.map((node) => ({ id: node.id, kind: 'doc', label: node.title, node, degree: 0, linkDegree: 0 }))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const edges = []
  const seen = new Set()

  const tagNodes = new Map()
  for (const node of docs) {
    for (const link of graphLinksOf(node.content || '')) {
      const raw = String(link.target || '').trim()
      if (raw === '') continue
      const target = byId.get(raw) || byTitle.get(normalizeTitle(raw))
      if (target === undefined || target.id === node.id) continue
      // Undirected: [[A]] in B and [[B]] in A describe one relationship, not two.
      const key = node.id < target.id ? node.id + '<->' + target.id : target.id + '<->' + node.id
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ id: 'edge:' + key, from: node.id, to: target.id, kind: link.kind })
      if (nodeById.has(node.id)) nodeById.get(node.id).linkDegree += 1
      if (nodeById.has(target.id)) nodeById.get(target.id).linkDegree += 1
    }
    if (showTags) {
      for (const tag of Array.isArray(node.tags) ? node.tags : []) {
        const tagId = 'tag:' + tag
        if (!tagNodes.has(tagId)) {
          tagNodes.set(tagId, { id: tagId, kind: 'tag', label: '#' + tag, node: null, degree: 0, linkDegree: 0 })
        }
        const edgeKey = node.id + '->' + tagId
        if (!seen.has(edgeKey)) {
          seen.add(edgeKey)
          edges.push({ id: 'edge:' + edgeKey, from: node.id, to: tagId, kind: 'tag' })
          tagNodes.get(tagId).degree += 1
        }
      }
    }
  }

  const allNodes = nodes.concat(Array.from(tagNodes.values()))
  const byNodeId = new Map(allNodes.map((node) => [node.id, node]))
  for (const edge of edges) {
    if (byNodeId.has(edge.from)) byNodeId.get(edge.from).degree += 1
    if (byNodeId.has(edge.to)) byNodeId.get(edge.to).degree += 1
  }
  const orphans = nodes.filter((node) => node.degree === 0)
  return { nodes: allNodes, edges, orphans, docs }
}

/** Stable string used to decide when a graph really changed. */
function graphSignature(graph) {
  return graph.nodes.map((node) => node.id).sort().join('|') + '||' + graph.edges.map((edge) => edge.id).sort().join('|')
}

/** FNV-1a over a string: deterministic pseudo-random seed for a node id. */
function graphHash(text) {
  let hash = 0x811c9dc5
  const source = String(text || '')
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Circle placement with a hash-based angle so ids (not order) decide the spot. */
function initialGraphPositions(graph) {
  const positions = {}
  const docs = graph.nodes.filter((node) => node.kind === 'doc')
  const tags = graph.nodes.filter((node) => node.kind === 'tag')
  const seed = (node, index, total, radius) => {
    const hash = graphHash(node.id)
    const angle = (index / Math.max(total, 1)) * Math.PI * 2 + ((hash % 1000) / 1000) * 0.35
    const ring = radius + ((hash >>> 10) % 40)
    positions[node.id] = { x: Math.cos(angle) * ring, y: Math.sin(angle) * ring, vx: 0, vy: 0 }
  }
  if (docs.length === 1) positions[docs[0].id] = { x: 0, y: 0, vx: 0, vy: 0 }
  else {
    const radius = 90 + Math.min(240, docs.length * 9)
    docs.forEach((node, index) => seed(node, index, docs.length, radius))
  }
  const tagRadius = 200 + Math.min(260, docs.length * 10)
  tags.forEach((node, index) => seed(node, index, tags.length, tagRadius))
  return positions
}

const finiteNumber = (value, fallback) => (Number.isFinite(value) ? value : fallback)

/** One simulation tick; returns fresh positions (never NaN). */
function graphStep(graph, positions, options) {
  const opts = options || {}
  const springLength = finiteNumber(opts.springLength, 130)
  const springStrength = finiteNumber(opts.springStrength, 0.028)
  const repulsion = finiteNumber(opts.repulsion, 2200)
  const gravity = finiteNumber(opts.gravity, 0.012)
  const damping = finiteNumber(opts.damping, 0.82)
  const maxStep = finiteNumber(opts.maxStep, 22)
  const nodes = graph.nodes
  const current = positions || initialGraphPositions(graph)
  const next = {}
  const forces = {}
  for (const node of nodes) {
    const source = current[node.id] || { x: 0, y: 0, vx: 0, vy: 0 }
    next[node.id] = { x: finiteNumber(source.x, 0), y: finiteNumber(source.y, 0), vx: finiteNumber(source.vx, 0), vy: finiteNumber(source.vy, 0) }
    forces[node.id] = { x: 0, y: 0 }
  }
  const count = nodes.length
  const repel = (left, right, scale) => {
    const a = next[nodes[left].id]
    const b = next[nodes[right].id]
    let dx = b.x - a.x
    let dy = b.y - a.y
    let distanceSq = dx * dx + dy * dy
    if (distanceSq < 1) {
      dx = (left - right) * 0.5 + 0.1
      dy = 0.5
      distanceSq = 1
    }
    const distance = Math.sqrt(distanceSq)
    const force = Math.min(repulsion / distanceSq, 14) * scale
    const fx = (dx / distance) * force
    const fy = (dy / distance) * force
    forces[nodes[left].id].x -= fx
    forces[nodes[left].id].y -= fy
    forces[nodes[right].id].x += fx
    forces[nodes[right].id].y += fy
  }
  if (count > 1 && count <= 800) {
    for (let left = 0; left < count; left += 1) {
      for (let right = left + 1; right < count; right += 1) repel(left, right, 1)
    }
  } else if (count > 800) {
    // Sampling keeps huge archives responsive without the old 400-node cliff where
    // repulsion stopped entirely and every node collapsed onto the origin.
    const sample = 240
    const step = count / sample
    const boost = Math.min(step, 6)
    for (let left = 0; left < count; left += 1) {
      for (let k = 1; k <= sample; k += 1) {
        const right = (left + Math.round(k * step)) % count
        if (right !== left) repel(left, right, boost)
      }
    }
  }
  for (const edge of graph.edges) {
    const a = next[edge.from]
    const b = next[edge.to]
    if (a === undefined || b === undefined) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const distance = Math.sqrt(dx * dx + dy * dy) || 0.01
    const pull = (distance - springLength) * springStrength
    const fx = (dx / distance) * pull
    const fy = (dy / distance) * pull
    forces[edge.from].x += fx
    forces[edge.from].y += fy
    forces[edge.to].x -= fx
    forces[edge.to].y -= fy
  }
  for (const node of nodes) {
    const position = next[node.id]
    const force = forces[node.id]
    force.x -= position.x * gravity
    force.y -= position.y * gravity
    position.vx = (position.vx + force.x) * damping
    position.vy = (position.vy + force.y) * damping
    position.x += clamp(position.vx, -maxStep, maxStep)
    position.y += clamp(position.vy, -maxStep, maxStep)
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      position.x = 0
      position.y = 0
      position.vx = 0
      position.vy = 0
    }
  }
  return next
}

/** Run the simulation to (near) rest; used for tests and the re-layout button. */
function layoutGraph(graph, options) {
  const opts = options || {}
  const iterations = Number.isFinite(opts.iterations) ? opts.iterations : graph.nodes.length > 180 ? 110 : 180
  let positions = initialGraphPositions(graph)
  for (let step = 0; step < Math.max(0, iterations); step += 1) positions = graphStep(graph, positions, opts)
  return positions
}

function graphBounds(graph, positions) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false
  for (const node of graph.nodes) {
    const point = positions[node.id]
    if (point === undefined) continue
    found = true
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  if (!found) return null
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

function graphFit(graph, positions, size, padding) {
  const bounds = graphBounds(graph, positions)
  const width = size && size.w > 0 ? size.w : 900
  const height = size && size.h > 0 ? size.h : 560
  const pad = padding === undefined ? 70 : padding
  if (bounds === null) return { x: 0, y: 0, zoom: 1 }
  const zoom = clamp(Math.min((width - pad * 2) / Math.max(bounds.w + 60, 1), (height - pad * 2) / Math.max(bounds.h + 60, 1)), 0.25, 1.6)
  return {
    zoom,
    x: width / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.h / 2) * zoom,
  }
}

function graphZoom(view, factor, point) {
  const current = view !== null && typeof view === 'object' ? view : { x: 0, y: 0, zoom: 1 }
  const from = clamp(Number(current.zoom) || 1, 0.2, 3)
  const next = clamp(from * factor, 0.2, 3)
  const ratio = next / from
  const anchor = point !== null && typeof point === 'object' ? point : { x: 0, y: 0 }
  return { zoom: next, x: anchor.x - (anchor.x - (Number(current.x) || 0)) * ratio, y: anchor.y - (anchor.y - (Number(current.y) || 0)) * ratio }
}

const graphModel = {
  graphLinksOf,
  buildGraph,
  graphSignature,
  graphHash,
  initialGraphPositions,
  graphStep,
  layoutGraph,
  graphBounds,
  graphFit,
  graphZoom,
}

/* ----------------------------------------------------------------- component */

function MindGraph(props) {
  const input = props || {}
  const store = input.store
  const snapshot = input.snapshot || { nodes: [] }
  const workspaceId = input.workspaceId || undefined
  const onOpen = typeof input.onOpen === 'function' ? input.onOpen : () => {}
  const onConnect = typeof input.onConnect === 'function' ? input.onConnect : () => {}
  const notify = typeof input.notify === 'function' ? input.notify : () => {}

  const graphPrefs = snapshot.graph && typeof snapshot.graph === 'object' ? snapshot.graph : {}
  const showTags = graphPrefs.showTags === true
  const scopeAll = graphPrefs.scopeAll === true
  const showLabels = graphPrefs.showLabels !== false

  const graph = React.useMemo(() => buildGraph(snapshot, { workspaceId, showTags, scopeAll }), [snapshot, workspaceId, showTags, scopeAll])
  const signature = React.useMemo(() => graphSignature(graph), [graph])
  const [positions, setPositions] = React.useState(() => initialGraphPositions(graph))
  const [view, setView] = React.useState({ x: 0, y: 0, zoom: 1 })
  const [selected, setSelected] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const [connectFrom, setConnectFrom] = React.useState(null)
  const [size, setSize] = React.useState({ w: 900, h: 560 })
  const [settling, setSettling] = React.useState(false)

  const containerRef = React.useRef(null)
  const positionsRef = React.useRef(positions)
  const viewRef = React.useRef(view)
  const animationRef = React.useRef(null)
  const draggingRef = React.useRef(false)
  positionsRef.current = positions
  viewRef.current = view

  React.useEffect(() => {
    const element = containerRef.current
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

  const cancelAnimation = () => {
    if (animationRef.current !== null) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    setSettling(false)
  }

  // Animate the graph into place whenever its shape changes.
  React.useEffect(() => {
    const reduceMotion = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let current = initialGraphPositions(graph)
    positionsRef.current = current
    setPositions(current)
    setSelected(null)
    setConnectFrom(null)
    if (graph.nodes.length === 0) return undefined
    if (typeof requestAnimationFrame !== 'function' || reduceMotion) {
      current = layoutGraph(graph, { iterations: 160 })
      positionsRef.current = current
      setPositions(current)
      return undefined
    }
    let steps = 0
    let alive = true
    setSettling(true)
    const tick = () => {
      if (!alive) return
      if (draggingRef.current) {
        animationRef.current = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(tick) : null
        return
      }
      current = graphStep(graph, positionsRef.current, {})
      positionsRef.current = current
      setPositions(current)
      steps += 1
      if (steps < 150) animationRef.current = requestAnimationFrame(tick)
      else {
        animationRef.current = null
        setSettling(false)
      }
    }
    animationRef.current = requestAnimationFrame(tick)
    return () => {
      alive = false
      cancelAnimation()
    }
  }, [signature])

  React.useEffect(() => {
    const element = containerRef.current
    if (element === null) return undefined
    const onWheel = (event) => {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      const rect = element.getBoundingClientRect()
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const factor = Math.exp(-Number(event.deltaY || 0) * 0.0016)
      setView((current) => graphZoom(current, factor, point))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const neighbours = React.useMemo(() => {
    const map = new Map()
    for (const edge of graph.edges) {
      if (!map.has(edge.from)) map.set(edge.from, new Set())
      if (!map.has(edge.to)) map.set(edge.to, new Set())
      map.get(edge.from).add(edge.to)
      map.get(edge.to).add(edge.from)
    }
    return map
  }, [graph])

  const needle = normalizeTitle(query)
  const matches = React.useMemo(() => {
    if (needle === '') return null
    const set = new Set()
    for (const node of graph.nodes) {
      if (normalizeTitle(node.label).indexOf(needle) >= 0) set.add(node.id)
    }
    return set
  }, [graph, needle])

  const selectedNode = selected === null ? null : graph.nodes.find((node) => node.id === selected) || null
  const near = selected === null ? null : neighbours.get(selected) || new Set()

  const nodeClass = (node) => {
    let dim = false
    if (matches !== null && !matches.has(node.id)) {
      const connected = Array.from(matches).some((id) => (neighbours.get(id) || new Set()).has(node.id))
      dim = !connected
    }
    if (selected !== null) dim = node.id !== selected && !near.has(node.id)
    return cx(
      'dsh-axl-graph-node',
      'is-' + node.kind,
      selected === node.id && 'is-selected',
      connectFrom === node.id && 'is-connect-source',
      near !== null && near.has(node.id) && 'is-neighbour',
      dim && 'is-dim',
    )
  }

  const onNodeDown = (node) => (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    cancelAnimation()
    draggingRef.current = true
    const start = { clientX: event.clientX, clientY: event.clientY, x: positions[node.id].x, y: positions[node.id].y }
    const move = (moveEvent) => {
      const ratio = viewRef.current.zoom || 1
      const next = Object.assign({}, positionsRef.current)
      next[node.id] = Object.assign({}, next[node.id], {
        x: start.x + (moveEvent.clientX - start.clientX) / ratio,
        y: start.y + (moveEvent.clientY - start.clientY) / ratio,
        vx: 0,
        vy: 0,
      })
      positionsRef.current = next
      setPositions(next)
    }
    const up = () => {
      draggingRef.current = false
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', up)
  }

  const onNodeClick = (node) => (event) => {
    if (event && typeof event.stopPropagation === 'function') event.stopPropagation()
    if (connectFrom !== null && connectFrom !== node.id) {
      onConnect(connectFrom, node.id)
      setConnectFrom(null)
      return
    }
    if (connectFrom === node.id) {
      setConnectFrom(null)
      return
    }
    if (connectFrom === '') {
      setConnectFrom(null)
      notify('Pick a note first, then choose Connect.', 'info')
      return
    }
    setSelected(node.id)
  }

  const onSvgDown = (event) => {
    if (event.button !== 0) return
    if (event.target !== event.currentTarget && event.target.tagName !== 'svg') return
    setSelected(null)
    setConnectFrom(null)
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

  const patchGraph = (patch) => {
    if (store === undefined) return
    store.commit((draft) => {
      if (!draft.graph || typeof draft.graph !== 'object') draft.graph = {}
      draft.graph = Object.assign({}, draft.graph, patch)
    })
  }

  const relayout = () => {
    cancelAnimation()
    const next = layoutGraph(graph, { iterations: 180 })
    positionsRef.current = next
    setPositions(next)
    setSelected(null)
  }

  const fit = () => setView(graphFit(graph, positionsRef.current, size))
  const zoomBy = (factor) => setView((current) => graphZoom(current, factor, { x: size.w / 2, y: size.h / 2 }))

  const onKeyDown = (event) => {
    if (event.defaultPrevented) return
    // The filter input and toolbar live in the same container: keys there must not open notes.
    const target = event.target
    const tag = target !== null && target !== undefined ? String(target.tagName || '') : ''
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON'
    if (typing && event.key !== 'Escape') return
    if (event.key === 'Escape') {
      setConnectFrom(null)
      setSelected(null)
      return
    }
    if (event.key === 'Enter' && selectedNode !== null && selectedNode.kind === 'doc') {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      onOpen(selectedNode.node.id)
    }
  }

  const edgeVisible = (edge) => {
    if (selected !== null && edge.from !== selected && edge.to !== selected) return false
    if (matches !== null && !matches.has(edge.from) && !matches.has(edge.to)) return false
    return true
  }

  const nodeRadius = (node) => (node.kind === 'tag' ? 5.5 : 7 + Math.min(6, node.degree * 0.7))

  return h(
    'div',
    {
      className: 'dsh-axl-graph',
      ref: containerRef,
      tabIndex: 0,
      onKeyDown,
      role: 'application',
      'aria-label': 'Mind graph',
    },
    h(
      'div',
      { className: 'dsh-axl-graph-toolbar' },
      h('span', { className: 'dsh-axl-graph-title' }, h(Icon, { name: 'graph', size: 14 }), 'Mind graph'),
      h('span', { className: 'dsh-axl-graph-stat' }, graph.docs.length + ' notes'),
      h('span', { className: 'dsh-axl-graph-stat' }, graph.edges.length + ' link(s)'),
      h('span', { className: 'dsh-axl-graph-stat is-warn' }, graph.orphans.length + ' orphan(s)'),
      h('span', { className: 'dsh-axl-graph-spacer' }),
      h('label', { className: 'dsh-axl-graph-search' }, h(Icon, { name: 'search', size: 12 }), h('input', {
        className: 'dsh-axl-graph-query',
        placeholder: 'Filter notes…',
        value: query,
        onChange: (event) => setQuery(event.target.value),
        'aria-label': 'Filter notes in the graph',
      })),
      h('button', { type: 'button', className: cx('dsh-axl-btn is-ghost', showTags && 'is-primary'), title: 'Show tag nodes', onClick: () => patchGraph({ showTags: !showTags }) }, h(Icon, { name: 'tag', size: 12 }), 'Tags'),
      h('button', { type: 'button', className: cx('dsh-axl-btn is-ghost', showLabels && 'is-primary'), title: 'Toggle labels', onClick: () => patchGraph({ showLabels: !showLabels }) }, 'Aa'),
      h('button', { type: 'button', className: cx('dsh-axl-btn is-ghost', scopeAll && 'is-primary'), title: 'Include every workspace', onClick: () => patchGraph({ scopeAll: !scopeAll }) }, 'All'),
      h(IconButton, {
        icon: 'link',
        label: 'Connect two notes',
        active: connectFrom !== null,
        onClick: () => {
          if (connectFrom !== null) {
            setConnectFrom(null)
            return
          }
          if (selectedNode === null || selectedNode.kind !== 'doc') {
            notify('Select a note first, then connect it to another', 'info')
            return
          }
          setConnectFrom(selectedNode.id)
        },
      }),
      h(IconButton, { icon: 'refresh', label: 'Re-layout graph', onClick: relayout }),
      h('span', { className: 'dsh-axl-canvas-sep' }),
      h(IconButton, { icon: 'minus', label: 'Zoom out', onClick: () => zoomBy(1 / 1.2) }),
      h('span', { className: 'dsh-axl-graph-zoom' }, Math.round(view.zoom * 100) + '%'),
      h(IconButton, { icon: 'plus', label: 'Zoom in', onClick: () => zoomBy(1.2) }),
      h(IconButton, { icon: 'fit', label: 'Fit graph', onClick: fit }),
    ),
    graph.nodes.length === 0
      ? h(
          'div',
          { className: 'dsh-axl-graph-empty' },
          h(Icon, { name: 'graph', size: 28 }),
          h('strong', null, 'No notes to map yet'),
          h('span', null, 'Create a document in this workspace, then link notes with [[another note title]].'),
        )
      : h(
          'div',
          { className: 'dsh-axl-graph-viewport' },
          h(
            'svg',
            { className: 'dsh-axl-graph-svg', width: '100%', height: '100%', onMouseDown: onSvgDown, role: 'group', 'aria-label': 'Graph of notes and links' },
            h(
              'g',
              { transform: 'translate(' + view.x + ' ' + view.y + ') scale(' + view.zoom + ')' },
              graph.edges.map((edge) => {
                const from = positions[edge.from]
                const to = positions[edge.to]
                if (from === undefined || to === undefined) return null
                return h('line', {
                  key: edge.id,
                  className: cx('dsh-axl-graph-edge', edge.kind === 'tag' && 'is-tag', !edgeVisible(edge) && 'is-dim'),
                  x1: from.x,
                  y1: from.y,
                  x2: to.x,
                  y2: to.y,
                })
              }),
              graph.nodes.map((node) => {
                const point = positions[node.id] || { x: 0, y: 0 }
                return h(
                  'g',
                  {
                    key: node.id,
                    className: nodeClass(node),
                    transform: 'translate(' + round2(point.x) + ' ' + round2(point.y) + ')',
                    onMouseDown: onNodeDown(node),
                    onClick: onNodeClick(node),
                    onFocus: () => setSelected(node.id),
                    tabIndex: 0,
                    role: 'button',
                    'aria-label': (node.kind === 'tag' ? 'Tag ' : 'Note ') + node.label,
                    onDoubleClick: () => {
                      if (node.kind === 'doc') onOpen(node.node.id)
                    },
                  },
                  h('circle', { className: 'dsh-axl-graph-dot', r: nodeRadius(node) }),
                  h('title', null, node.kind === 'tag' ? 'Tag ' + node.label : node.label + ' · ' + node.degree + ' link(s)'),
                  showLabels
                    ? h('text', { className: 'dsh-axl-graph-label', x: 0, y: nodeRadius(node) + 14, textAnchor: 'middle' }, node.label)
                    : null,
                )
              }),
            ),
          ),
          settling ? h('div', { className: 'dsh-axl-graph-settling' }, 'Settling…') : null,
          connectFrom !== null
            ? h(
                'div',
                { className: 'dsh-axl-graph-hintbar' },
                connectFrom === ''
                  ? 'Select a note to start the connection'
                  : 'Now choose the note to link from “' + (graph.nodes.find((node) => node.id === connectFrom) || { label: 'note' }).label + '”',
                h('button', { type: 'button', className: 'dsh-axl-btn is-ghost is-small', onClick: () => setConnectFrom(null) }, 'Cancel'),
              )
            : null,
          graph.orphans.length > 0 && graph.edges.length === 0
            ? h('div', { className: 'dsh-axl-graph-hintbar is-bottom' }, 'No links yet — type [[note title]] inside a note to connect it.')
            : null,
        ),
  )
}

const GRAPH_CSS = `
.dsh-axl-graph { display: flex; flex-direction: column; height: 100%; min-height: 460px; outline: none; }
.dsh-axl-graph-toolbar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: color-mix(in srgb, var(--dsw-alias-bg-base) 92%, var(--dsw-alias-bg-layer-1)); flex-wrap: wrap; }
.dsh-axl-graph-title { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 650; color: var(--dsw-alias-label-primary); }
.dsh-axl-graph-stat { font-size: 11px; color: var(--dsw-alias-label-secondary); padding: 1px 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); }
.dsh-axl-graph-stat.is-warn { color: var(--dsw-alias-state-warn-primary); }
.dsh-axl-graph-spacer { flex: 1 1 auto; }
.dsh-axl-graph-search { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); }
.dsh-axl-graph-query { width: 120px; border: 0; outline: none; background: transparent; color: var(--dsw-alias-label-primary); font-size: 12px; }
.dsh-axl-graph-zoom { min-width: 40px; text-align: center; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }
.dsh-axl-graph-viewport { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background-color: var(--dsw-alias-bg-base); background-image: radial-gradient(color-mix(in srgb, var(--dsw-alias-label-primary) 13%, transparent) 1px, transparent 1px); background-size: 24px 24px; cursor: grab; }
.dsh-axl-graph-viewport:active { cursor: grabbing; }
.dsh-axl-graph-svg { display: block; width: 100%; height: 100%; }
.dsh-axl-graph-edge { stroke: color-mix(in srgb, var(--dsw-alias-label-secondary) 42%, transparent); stroke-width: 1.2; transition: opacity .18s ease, stroke .18s ease; }
.dsh-axl-graph-edge.is-tag { stroke-dasharray: 3 4; stroke: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 48%, transparent); }
.dsh-axl-graph-edge.is-dim { opacity: .12; }
.dsh-axl-graph-node { cursor: pointer; transition: opacity .2s ease; }
.dsh-axl-graph-dot { fill: color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, var(--dsw-alias-bg-layer-1)); stroke: var(--dsw-alias-brand-primary); stroke-width: 1.4; transition: fill .18s ease, r .18s ease; }
.dsh-axl-graph-node.is-tag .dsh-axl-graph-dot { fill: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 18%, var(--dsw-alias-bg-layer-1)); stroke: var(--dsw-alias-state-warn-primary); }
.dsh-axl-graph-node:hover .dsh-axl-graph-dot { fill: color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, var(--dsw-alias-bg-layer-1)); }
.dsh-axl-graph-node.is-selected .dsh-axl-graph-dot { fill: var(--dsw-alias-brand-primary); stroke: var(--dsw-alias-brand-primary); }
.dsh-axl-graph-node.is-neighbour .dsh-axl-graph-dot { fill: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, var(--dsw-alias-bg-layer-1)); }
.dsh-axl-graph-node.is-connect-source .dsh-axl-graph-dot { stroke-width: 3; fill: var(--dsw-alias-brand-primary); }
.dsh-axl-graph-node.is-dim { opacity: .16; }
.dsh-axl-graph-node:focus-visible { outline: none; }
.dsh-axl-graph-node:focus-visible .dsh-axl-graph-dot { stroke: var(--dsw-alias-brand-primary); stroke-width: 3; }
.dsh-axl-graph-node:focus-visible .dsh-axl-graph-label { fill: var(--dsw-alias-brand-primary); }
.dsh-axl-graph-label { font-size: 10.5px; fill: var(--dsw-alias-label-primary); pointer-events: none; user-select: none; paint-order: stroke; stroke: var(--dsw-alias-bg-base); stroke-width: 3px; stroke-linejoin: round; }
.dsh-axl-graph-settling { position: absolute; right: 14px; top: 12px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); padding: 3px 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); animation: dsh-axl-pulse 1.2s ease-in-out infinite; }
.dsh-axl-graph-hintbar { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-radius: 999px; font-size: 11.5px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1)); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); animation: dsh-axl-pop .18s ease both; }
.dsh-axl-graph-hintbar.is-bottom { top: auto; bottom: 14px; color: var(--dsw-alias-label-secondary); }
.dsh-axl-graph-empty { flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dsh-axl-graph-empty strong { color: var(--dsw-alias-label-primary); font-size: 14px; }
.dsh-axl-graph-empty span { max-width: 360px; font-size: 12px; line-height: 1.5; }
@media (max-width: 1200px) { .dsh-axl-graph-title { display: none; } .dsh-axl-graph-query { width: 84px; } }
`

CSS_CHUNKS.push(GRAPH_CSS)

// Mind-graph unit tests: link parsing, graph building, deterministic force layout.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, '..', 'src', 'client')
const parts = fs
  .readdirSync(clientDir)
  .filter((name) => name.endsWith('.js'))
  .sort()

const source =
  parts.map((name) => fs.readFileSync(path.join(clientDir, name), 'utf8')).join('\n') +
  '\n;return { graphModel, model, normalizeSnapshot }\n'

const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect() {},
  useLayoutEffect() {},
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
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

const api = new Function('require', 'window', 'document', 'fetch', source)(
  (id) => (id === 'react' ? react : {}),
  { addEventListener() {}, removeEventListener() {} },
  documentStub,
  async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) }),
)

const { graphModel } = api

let passed = 0
const failures = []
const check = (name, fn) => {
  try {
    fn()
    passed += 1
  } catch (error) {
    failures.push(name + ' :: ' + ((error && error.message) || String(error)))
  }
}
const ok = (condition, message) => {
  if (!condition) throw new Error(message || 'expected truthy')
}
const equal = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error((message || 'values differ') + ': ' + JSON.stringify(actual) + ' !== ' + JSON.stringify(expected))
  }
}
const near = (actual, expected, tolerance, message) => {
  if (!(Math.abs(actual - expected) <= tolerance)) throw new Error((message || 'not close') + ': ' + actual + ' vs ' + expected)
}

/* ------------------------------------------------------------------ fixture */

const stamp = '2026-01-01T00:00:00.000Z'
const doc = (id, title, content, extra) =>
  Object.assign({ id, workspaceId: 'ws-1', parentId: null, kind: 'doc', title, status: 'active', tags: [], favorite: false, trashed: false, order: 0, createdAt: stamp, updatedAt: stamp, content }, extra || {})

const snapshot = {
  workspaces: [{ id: 'ws-1', name: 'Studio' }, { id: 'ws-2', name: 'Other' }],
  nodes: [
    doc('doc-a', 'Alpha', 'Links to [[Beta]] and [[ beta |the second]] and [[Gamma#Intro]].\n\n[explicit](note:doc-b)'),
    doc('doc-b', 'Beta', '[back](alexandrie://doc-a) plus [[Missing note]] and ![[Gamma]]', { tags: ['x', 'y'] }),
    doc('doc-c', 'Gamma', 'No outgoing links, but [[Gamma]] is a self link.', { tags: ['x'] }),
    doc('doc-d', 'Delta', 'Cross-workspace [[Alpha]]', { workspaceId: 'ws-2' }),
    doc('doc-z', 'Zombie', '[[Alpha]]', { trashed: true }),
  ],
  settings: {},
  ui: {},
  canvas: { items: [], links: [] },
  graph: { showTags: false, showLabels: true, scopeAll: false },
}

/* -------------------------------------------------------------------- checks */

check('wiki links parse title, heading, alias and embed', () => {
  const links = graphModel.graphLinksOf('[[One]] [[Two|alias]] [[Three#Heading]] ![[Four]]')
  equal(links.map((link) => link.target), ['One', 'Two', 'Three', 'Four'])
  equal(links[1].alias, 'alias')
  equal(links[0].kind, 'wiki')
  equal(graphModel.graphLinksOf('plain [text](https://example.com)'), [])
})

check('markdown note links parse both schemes', () => {
  const links = graphModel.graphLinksOf('[a](note:doc-1) [b](alexandrie://doc-2)')
  equal(links.map((link) => link.target), ['doc-1', 'doc-2'])
  equal(links.every((link) => link.kind === 'markdown'), true)
})

check('buildGraph resolves titles case-insensitively and dedupes edges', () => {
  const graph = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1' })
  equal(graph.nodes.filter((node) => node.kind === 'doc').map((node) => node.id).sort(), ['doc-a', 'doc-b', 'doc-c'])
  const pairs = graph.edges.map((edge) => [edge.from, edge.to].sort().join('>')).sort()
  equal(pairs, ['doc-a>doc-b', 'doc-a>doc-c', 'doc-b>doc-c'], 'unexpected edge set')
  equal(graph.edges.filter((edge) => edge.from === 'doc-a' && edge.to === 'doc-b').length, 1, 'duplicate edge kept')
  equal(graph.nodes.find((node) => node.id === 'doc-a').degree, 2, 'mutual links must not double the degree')
  equal(graph.edges.some((edge) => edge.to.includes('Missing')), false, 'unknown target became a node')
  equal(graph.edges.some((edge) => edge.from === edge.to), false, 'self link kept')
})

check('orphans only count documents without link edges', () => {
  const graph = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1' })
  const branches = graphModel.buildGraph({ nodes: [doc('solo', 'Solo', 'nothing')], workspaces: [] }, {})
  equal(branches.orphans.map((node) => node.id), ['solo'])
  equal(graph.orphans.length, 0)
})

check('large graphs keep spreading instead of collapsing to the origin', () => {
  const big = { nodes: [], workspaces: [] }
  for (let index = 0; index < 1000; index += 1) big.nodes.push(doc('big-' + index, 'Note ' + index, 'no links'))
  const graph = graphModel.buildGraph(big, { scopeAll: true })
  equal(graph.nodes.length, 1000)
  let positions = graphModel.initialGraphPositions(graph)
  for (let step = 0; step < 120; step += 1) positions = graphModel.graphStep(graph, positions)
  const radius = Math.max(...Object.values(positions).map((point) => Math.sqrt(point.x * point.x + point.y * point.y)))
  ok(Number.isFinite(radius) && radius > 120, 'nodes collapsed at ' + radius.toFixed(2))
})

check('scopeAll widens the graph to every workspace', () => {
  const local = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1' })
  const all = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1', scopeAll: true })
  equal(local.nodes.length, 3)
  equal(all.nodes.length, 4, 'trashed or foreign documents leaked in')
  ok(all.edges.some((edge) => edge.from === 'doc-d' && edge.to === 'doc-a'), 'cross-workspace link missing')
})

check('tag nodes appear only when requested', () => {
  const plain = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1' })
  const tagged = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1', showTags: true })
  equal(plain.nodes.filter((node) => node.kind === 'tag').length, 0)
  equal(tagged.nodes.filter((node) => node.kind === 'tag').map((node) => node.id).sort(), ['tag:x', 'tag:y'])
  equal(tagged.edges.filter((edge) => edge.kind === 'tag').length, 3)
  equal(tagged.orphans.every((node) => node.kind === 'doc'), true, 'a tag leaked into orphans')
})

check('initial positions are deterministic, finite and ring-shaped', () => {
  const graph = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1' })
  const first = graphModel.initialGraphPositions(graph)
  const second = graphModel.initialGraphPositions(graph)
  equal(first, second)
  for (const node of graph.nodes) {
    ok(Number.isFinite(first[node.id].x) && Number.isFinite(first[node.id].y), 'non-finite seed for ' + node.id)
  }
  const single = graphModel.initialGraphPositions({ nodes: [{ id: 'only', kind: 'doc' }], edges: [] })
  equal([single.only.x, single.only.y], [0, 0])
})

check('layoutGraph runs to a finite, stable and spread-out layout', () => {
  const graph = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1' })
  const first = graphModel.layoutGraph(graph, { iterations: 120 })
  const second = graphModel.layoutGraph(graph, { iterations: 120 })
  equal(first, second)
  const points = Object.keys(first).map((id) => first[id])
  ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), 'NaN in layout')
  const spread = Math.max(...points.map((point) => Math.hypot(point.x, point.y)))
  ok(spread > 20, 'layout collapsed to a point (' + spread + ')')
})

check('layout handles empty, one-node and disconnected graphs', () => {
  equal(graphModel.layoutGraph({ nodes: [], edges: [] }, { iterations: 10 }), {})
  const single = graphModel.layoutGraph({ nodes: [{ id: 'solo', kind: 'doc' }], edges: [] }, { iterations: 30 })
  ok(Number.isFinite(single.solo.x), 'single node went non-finite')
  const isolates = Array.from({ length: 12 }, (unused, index) => ({ id: 'n' + index, kind: 'doc' }))
  const laid = graphModel.layoutGraph({ nodes: isolates, edges: [] }, { iterations: 80 })
  ok(Object.values(laid).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), 'isolates went non-finite')
})

check('400 nodes / 800 edges settle inside the performance budget', () => {
  const nodes = Array.from({ length: 400 }, (unused, index) => ({ id: 'n' + index, kind: 'doc' }))
  const edges = []
  for (let index = 0; index < 800; index += 1) {
    const from = index % 400
    const to = (index * 7 + 13) % 400
    if (from !== to) edges.push({ id: 'e' + index, from: 'n' + from, to: 'n' + to })
  }
  const started = Date.now()
  const positions = graphModel.layoutGraph({ nodes, edges }, { iterations: 60 })
  const elapsed = Date.now() - started
  ok(elapsed < 5000, 'layout too slow: ' + elapsed + 'ms')
  ok(Object.values(positions).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)), 'large layout went non-finite')
})

check('hash and signature are stable fingerprints', () => {
  equal(graphModel.graphHash('Alpha'), graphModel.graphHash('Alpha'))
  ok(graphModel.graphHash('Alpha') !== graphModel.graphHash('Beta'), 'hash collided')
  const one = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1' })
  const two = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1', showTags: true })
  ok(graphModel.graphSignature(one) !== graphModel.graphSignature(two), 'signature ignored new nodes')
})

check('fit centres the layout and zoom keeps its anchor', () => {
  const graph = graphModel.buildGraph(snapshot, { workspaceId: 'ws-1' })
  const positions = graphModel.layoutGraph(graph, { iterations: 40 })
  const view = graphModel.graphFit(graph, positions, { w: 900, h: 560 }, 60)
  const bounds = graphModel.graphBounds(graph, positions)
  const centreX = (bounds.x + bounds.w / 2) * view.zoom + view.x
  const centreY = (bounds.y + bounds.h / 2) * view.zoom + view.y
  near(centreX, 450, 0.5, 'layout is not horizontally centred')
  near(centreY, 280, 0.5, 'layout is not vertically centred')
  const anchor = { x: 300, y: 200 }
  const zoomed = graphModel.graphZoom({ x: 10, y: 20, zoom: 1 }, 1.5, anchor)
  near((anchor.x - zoomed.x) / zoomed.zoom, anchor.x - 10, 0.001)
  near((anchor.y - zoomed.y) / zoomed.zoom, anchor.y - 20, 0.001)
})

console.log('graph: ' + passed + ' checks passed')
if (failures.length > 0) {
  for (const failure of failures) console.error('FAIL ' + failure)
  process.exit(1)
}

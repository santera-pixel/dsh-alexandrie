// dsh-alexandrie — host half.
//
// Owns the authoritative knowledge-base document store for the browser half:
//   <DSH_HOME>/alexandrie/data.json
// Every mutation from the Web GUI arrives over the plugin's own HTTP route
// (`/dsh-alexandrie/*`), is validated here, serialized through one write queue and
// persisted atomically. The browser half never writes to disk directly.
//
// Route style follows the shipped `dsh-taskboard` plugin (ctx.webServer.register with
// exact/prefix kinds + plain JSON bodies), which is the proven pattern on this host.

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildArchive, mimeFromName, parseArchive, remapSnapshot } from './archive.js'

/** Cordis plugin name. */
export const name = 'dsh-alexandrie'
/** The browser carrier is required: without it the UI has no data source. */
export const inject = ['webServer']

const ROUTE_PREFIX = '/dsh-alexandrie'
const DATA_FILE = 'data.json'
// Layout blocks (canvas + graph prefs) in their own file. A pre-canvas build rebuilds
// data.json from a fixed key list and drops both blocks, but it never reads or writes
// this file, so the layout survives a downgrade and is merged back on the next load.
const LAYOUT_FILE = 'layout.json'
const LAYOUT_VERSION = 1
const MEDIA_DIR = 'media'
const STORE_DIR = 'alexandrie'
const STORE_VERSION = 1
/** Refuse absurd bodies early instead of filling the disk. */
const MAX_BODY_BYTES = 24 * 1024 * 1024
/** Attachments are base64 JSON, so the decoded ceiling is a little below the body cap. */
const MAX_MEDIA_BYTES = 12 * 1024 * 1024

/** An error that already knows the HTTP status it must be reported with. */
class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/** Absolute directory that holds plugin data, resolving DSH_HOME the same way the harness does. */
function storeDirectory() {
  const fromEnv = (process.env.DSH_HOME || '').trim()
  const home = fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
  return join(home, STORE_DIR)
}

/** The Harness home that owns `storages/workspace.json`. */
function harnessHome() {
  const fromEnv = (process.env.DSH_HOME || '').trim()
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** Safe project ids: the Harness uses UUIDs, but never trust a file blindly. */
const PROJECT_ID = /^[A-Za-z0-9_-]{1,120}$/

/**
 * Last segment of a path from either platform: the Harness file can hold a Windows path while
 * the host runs elsewhere (CI), and `node:path.basename` is platform-specific.
 */
const pathLeaf = (value) => String(value || '').split(/[\\/]+/).filter(Boolean).pop() || ''

/**
 * Read the Harness project list (workspaces) without ever writing to it.
 * A missing or broken file is reported as an empty list plus a warning, because
 * the notebook must still open when the harness file is temporarily unreadable.
 */
async function readProjects() {
  const directory = join(harnessHome(), 'storages')
  const source = join(directory, 'workspace.json')
  const result = { projects: [], defaultProjectId: null, directory, source, exists: false, warning: null }
  let raw
  try {
    raw = await readFile(source, 'utf8')
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return result
    result.warning = 'workspace.json is unreadable: ' + (error && error.message ? error.message : String(error))
    return result
  }
  result.exists = true
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    result.warning = 'workspace.json is not valid JSON'
    return result
  }
  const table = parsed !== null && typeof parsed === 'object' && parsed.tables && typeof parsed.tables === 'object' && parsed.tables.workspaces && typeof parsed.tables.workspaces === 'object' ? parsed.tables.workspaces : {}
  const listed = parsed !== null && typeof parsed === 'object' && parsed.global && Array.isArray(parsed.global.workspaceIds) ? parsed.global.workspaceIds : []
  const ids = []
  const seen = new Set()
  for (const id of listed) {
    if (typeof id !== 'string' || !PROJECT_ID.test(id) || id === '__proto__' || seen.has(id)) continue
    if (table[id] === null || typeof table[id] !== 'object') continue
    ids.push(id)
    seen.add(id)
  }
  for (const id of Object.keys(table)) {
    if (!PROJECT_ID.test(id) || id === '__proto__' || seen.has(id)) continue
    if (table[id] === null || typeof table[id] !== 'object') continue
    ids.push(id)
    seen.add(id)
  }
  for (const id of ids) {
    const entry = table[id]
    const projectPath = typeof entry.path === 'string' ? entry.path.slice(0, 1024) : ''
    const rawTitle = typeof entry.title === 'string' ? entry.title.trim() : ''
    result.projects.push({
      id,
      title: rawTitle !== '' ? rawTitle : pathLeaf(projectPath) || 'Project',
      path: projectPath,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    })
  }
  const preferred = parsed.global && typeof parsed.global.defaultWorkspaceId === 'string' ? parsed.global.defaultWorkspaceId : null
  result.defaultProjectId = preferred !== null && seen.has(preferred) ? preferred : ids[0] || null
  return result
}

/** Empty store shape, also the shape the client expects for a first run. */
function emptyStore() {
  return {
    version: STORE_VERSION,
    revision: 0,
    updatedAt: new Date().toISOString(),
    snapshot: null,
  }
}

/** Read the store file; a missing or unreadable file degrades to the empty store. */
async function readStore(file) {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyStore()
    return {
      version: Number.isFinite(parsed.version) ? parsed.version : STORE_VERSION,
      revision: Number.isFinite(parsed.revision) ? parsed.revision : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      snapshot: parsed.snapshot ?? null,
    }
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return emptyStore()
    throw error
  }
}

/** Validate the shape the client is allowed to persist. Throws with a readable reason. */
function validateSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new HttpError(400, 'snapshot must be an object')
  }
  if (!Array.isArray(snapshot.workspaces)) throw new HttpError(400, 'snapshot.workspaces must be an array')
  if (!Array.isArray(snapshot.nodes)) throw new HttpError(400, 'snapshot.nodes must be an array')
  if (snapshot.nodes.length > 20000) throw new HttpError(400, 'snapshot.nodes exceeds 20000 entries')
  for (const node of snapshot.nodes) {
    if (node === null || typeof node !== 'object') throw new HttpError(400, 'snapshot.nodes entries must be objects')
    if (typeof node.id !== 'string' || node.id === '') throw new HttpError(400, 'snapshot.nodes[].id must be a non-empty string')
    if (node.content !== undefined && typeof node.content !== 'string') throw new HttpError(400, 'snapshot.nodes[].content must be a string')
  }
  return snapshot
}

/**
 * The layout half of a snapshot: `canvas` and `graph`. Older builds rebuild a snapshot
 * from a fixed key list that has no room for either, so the current build keeps its own
 * copy of just these two blocks. Returns null when the payload carries neither, which
 * means the sender is an older client and must not be allowed to erase the copy.
 */
function layoutOf(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null
  const canvas = snapshot.canvas
  const graph = snapshot.graph
  if (canvas === undefined && graph === undefined) return null
  return {
    canvas: canvas !== null && typeof canvas === 'object' && !Array.isArray(canvas) ? canvas : { items: [], links: [] },
    graph:
      graph !== null && typeof graph === 'object' && !Array.isArray(graph)
        ? graph
        : { showTags: false, showLabels: true, scopeAll: false },
  }
}

/** Read the layout copy; missing, unreadable or malformed degrades to "no copy". */
async function readLayout(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const canvas = parsed.canvas
    if (canvas === null || typeof canvas !== 'object' || !Array.isArray(canvas.items) || !Array.isArray(canvas.links)) return null
    return {
      canvas: { items: canvas.items, links: canvas.links },
      graph: parsed.graph !== null && typeof parsed.graph === 'object' && !Array.isArray(parsed.graph) ? parsed.graph : null,
    }
  } catch {
    return null
  }
}

const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** A canvas is empty when it carries neither cards nor links (or is not a canvas at all). */
function canvasIsEmpty(canvas) {
  if (canvas === null || typeof canvas !== 'object' || Array.isArray(canvas)) return true
  const items = Array.isArray(canvas.items) ? canvas.items.length : 0
  const links = Array.isArray(canvas.links) ? canvas.links.length : 0
  return items === 0 && links === 0
}

/**
 * Drop cards whose document no longer exists and links whose endpoints did not survive.
 * Documents edited or deleted in the old build stay authoritative; the restored layout
 * only relocates the cards that still make sense, so no orphan reference can be served.
 */
function pruneCanvas(canvas, nodeIds) {
  const items = []
  const itemIds = new Set()
  for (const item of Array.isArray(canvas.items) ? canvas.items : []) {
    if (item === null || typeof item !== 'object') continue
    const kind = item.kind === 'doc' || item.kind === 'media' ? item.kind : null
    const refId = typeof item.refId === 'string' ? item.refId : ''
    if (kind === null || refId === '') continue
    if (kind === 'doc' && !nodeIds.has(refId)) continue
    const id = kind + ':' + refId
    if (itemIds.has(id)) continue
    itemIds.add(id)
    items.push({
      id,
      kind,
      refId,
      x: Math.round(finite(item.x, 0)),
      y: Math.round(finite(item.y, 0)),
      w: Math.round(Math.min(760, Math.max(180, finite(item.w, 300)))),
      h: Math.round(Math.min(760, Math.max(140, finite(item.h, 240)))),
      z: Math.round(finite(item.z, items.length)),
    })
  }
  const links = []
  const pairs = new Set()
  for (const link of Array.isArray(canvas.links) ? canvas.links : []) {
    if (link === null || typeof link !== 'object') continue
    const from = typeof link.from === 'string' ? link.from : ''
    const to = typeof link.to === 'string' ? link.to : ''
    if (from === '' || to === '' || from === to) continue
    if (!itemIds.has(from) || !itemIds.has(to)) continue
    const pair = [from, to].sort()
    const key = pair[0] + '::' + pair[1]
    if (pairs.has(key)) continue
    pairs.add(key)
    links.push({ id: 'link:' + key, from, to })
  }
  return { items, links }
}

/**
 * Merge the layout copy back into what is on disk after a downgrade. Only `canvas` and
 * `graph` are touched: workspaces, nodes, settings, ui and unknown blocks stay exactly
 * as the old build left them. Returns the snapshot to serve plus what had to be repaired.
 */
function restoreSnapshot(snapshot, layout) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { snapshot, restored: false, pruned: 0 }
  if (layout === null) return { snapshot, restored: false, pruned: 0 }
  const merged = Object.assign({}, snapshot)
  let restored = false
  let pruned = 0
  if (canvasIsEmpty(snapshot.canvas) && !canvasIsEmpty(layout.canvas)) {
    const nodeIds = new Set((Array.isArray(snapshot.nodes) ? snapshot.nodes : []).map((node) => node.id))
    const before = layout.canvas.items.length
    merged.canvas = pruneCanvas(layout.canvas, nodeIds)
    pruned = before - merged.canvas.items.length
    restored = true
  }
  if (merged.graph === undefined && layout.graph !== null) {
    merged.graph = layout.graph
    restored = true
  }
  return { snapshot: merged, restored, pruned }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function sendError(response, status, message) {
  sendJson(response, status, { ok: false, error: { message: String(message) } })
}

/** Collect a request body with a hard byte ceiling. */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let stopped = false
    request.on('data', (chunk) => {
      if (stopped) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        stopped = true
        reject(new HttpError(413, 'request body too large'))
        // Drain instead of destroying the socket: the client still needs to read the 413.
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) return resolve(null)
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new HttpError(400, 'request body is not valid JSON'))
      }
    })
    request.on('error', reject)
  })
}

/** Collect a binary request body (ZIP import) with a hard byte ceiling. */
function readRawBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let stopped = false
    request.on('data', (chunk) => {
      if (stopped) return
      size += chunk.length
      if (size > limit) {
        stopped = true
        reject(new HttpError(413, 'request body too large'))
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

/**
 * Mount the host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const directory = storeDirectory()
  const file = join(directory, DATA_FILE)
  /** One queue so concurrent saves cannot interleave. */
  let queue = Promise.resolve()

  const prepare = async () => {
    await mkdir(directory, { recursive: true })
    return file
  }

  const layoutFile = join(directory, LAYOUT_FILE)

  /** Persist the layout copy atomically. This file is the only survivor of a downgrade. */
  const writeLayout = async (layout) => {
    await prepare()
    const payload = { version: LAYOUT_VERSION, savedAt: new Date().toISOString(), canvas: layout.canvas, graph: layout.graph }
    const tmp = `${layoutFile}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(payload), 'utf8')
    await rename(tmp, layoutFile)
  }

  /** First load of an archive that predates the copy: keep a layout-only copy from now on. */
  const seedLayout = () => {
    const run = async () => {
      if ((await readLayout(layoutFile)) !== null) return
      const current = await readStore(file)
      const layout = layoutOf(current.snapshot)
      if (layout === null) return
      await writeLayout(layout)
      console.log('[dsh-alexandrie] layout copy created')
    }
    const started = queue.then(run, run)
    queue = started.catch(() => undefined)
    return started
  }

  /**
   * What the client should see: the archive on disk with the layout copy merged back in
   * when a downgrade stripped it. Reading never rewrites data.json; the next save does.
   */
  const readSnapshot = async () => {
    const store = await readStore(file)
    const layout = await readLayout(layoutFile)
    const restored = restoreSnapshot(store.snapshot, layout)
    if (layout === null) {
      await seedLayout().catch((error) => {
        console.warn('[dsh-alexandrie] could not create ' + LAYOUT_FILE + ': ' + ((error && error.message) || String(error)))
      })
    }
    if (!restored.restored) return store
    return Object.assign({}, store, { snapshot: restored.snapshot })
  }

  /** Persist a validated snapshot atomically (tmp file + rename). */
  const persist = (snapshot, options = {}) => {
    const run = async () => {
      await prepare()
      const current = await readStore(file)
      const revision = Math.max(current.revision, 0) + 1
      const updatedAt = new Date().toISOString()
      // Layout first: if the process dies between the two writes, data.json still holds
      // the previous complete snapshot and the next save repairs both files.
      const layout = layoutOf(snapshot)
      if (layout !== null) {
        try {
          await writeLayout(layout)
        } catch (error) {
          console.warn('[dsh-alexandrie] could not refresh ' + LAYOUT_FILE + ': ' + ((error && error.message) || String(error)))
        }
      }
      const payload = { version: STORE_VERSION, revision, updatedAt, snapshot }
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await writeFile(tmp, JSON.stringify(payload), 'utf8')
      await rename(tmp, file)
      return { revision, updatedAt, conflict: false }
    }
    const started = queue.then(run, run)
    queue = started.catch(() => undefined)
    return started
  }

  const mediaDirectory = join(directory, MEDIA_DIR)

  const prepareMedia = async () => {
    await mkdir(mediaDirectory, { recursive: true })
    return mediaDirectory
  }

  const mediaId = () => 'media-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

  /** Metadata sidecar for one attachment (`<id>.json` next to the bytes). */
  const readMediaEntry = async (id) => {
    try {
      const raw = await readFile(join(mediaDirectory, id + '.json'), 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object' || parsed.id !== id) return null
      return parsed
    } catch {
      return null
    }
  }

  const listMedia = async () => {
    await prepareMedia()
    const names = await readdir(mediaDirectory)
    const entries = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const entry = await readMediaEntry(name.slice(0, -'.json'.length))
      if (entry !== null) entries.push(entry)
    }
    entries.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
    return entries
  }

  const writeMedia = async (entry, data) => {
    await prepareMedia()
    await writeFile(join(mediaDirectory, entry.id), data)
    await writeFile(join(mediaDirectory, entry.id + '.json'), JSON.stringify(entry), 'utf8')
    return entry
  }

  const sendMedia = async (response, entry, download) => {
    const data = await readFile(join(mediaDirectory, entry.id))
    const name = String(entry.name || entry.id).replace(/["\\\r\n]/g, '_')
    response.writeHead(200, {
      'content-type': entry.mime || mimeFromName(entry.name),
      'content-length': data.length,
      'cache-control': 'private, max-age=300',
      'content-disposition': (download ? 'attachment' : 'inline') + '; filename="' + name + '"',
    })
    response.end(data)
  }

  const handler = async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const suffix = url.pathname.slice(ROUTE_PREFIX.length) || '/'
    const method = (request.method || 'GET').toUpperCase()
    try {
      if (suffix === '/health' || suffix === '/health/') {
        let exists = false
        let size = 0
        try {
          const info = await stat(file)
          exists = true
          size = info.size
        } catch {
          exists = false
        }
        sendJson(response, 200, { ok: true, value: { directory, file, exists, size: exists ? size : 0 } })
        return
      }
      if (suffix === '/state' || suffix === '/state/') {
        if (method !== 'GET') return sendError(response, 405, 'method not allowed')
        const store = await readSnapshot()
        sendJson(response, 200, { ok: true, value: store })
        return
      }
      if (suffix === '/projects' || suffix === '/projects/') {
        if (method !== 'GET') return sendError(response, 405, 'method not allowed')
        sendJson(response, 200, { ok: true, value: await readProjects() })
        return
      }
      if (suffix === '/save' || suffix === '/save/') {
        if (method !== 'POST') return sendError(response, 405, 'method not allowed')
        const body = await readBody(request)
        if (body === null || typeof body !== 'object') return sendError(response, 400, 'body must be a JSON object')
        const snapshot = validateSnapshot(body.snapshot)
        if (Buffer.byteLength(JSON.stringify(snapshot)) > MAX_BODY_BYTES) return sendError(response, 413, 'snapshot too large')
        const result = await persist(snapshot, body)
        sendJson(response, 200, { ok: true, value: result })
        return
      }
      if (suffix === '/export' || suffix === '/export/') {
        const store = await readSnapshot()
        const body = JSON.stringify(store.snapshot ?? { workspaces: [], nodes: [], settings: {}, ui: {} }, null, 2)
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="alexandrie-export-${new Date().toISOString().slice(0, 10)}.json"`,
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body),
        })
        response.end(body)
        return
      }
      if (suffix === '/archive/export' || suffix === '/archive/export/') {
        if (method !== 'GET') return sendError(response, 405, 'method not allowed')
        const store = await readSnapshot()
        const snapshot = store.snapshot ?? { version: 1, workspaces: [], nodes: [], settings: {}, ui: {} }
        const entries = await listMedia()
        const files = []
        for (const entry of entries) {
          try {
            files.push({ id: entry.id, name: entry.name, mime: entry.mime, data: await readFile(join(mediaDirectory, entry.id)) })
          } catch {
            // A sidecar without bytes is skipped rather than failing the whole export.
          }
        }
        const archive = buildArchive({ snapshot, media: files })
        response.writeHead(200, {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="alexandrie-${new Date().toISOString().slice(0, 10)}.zip"`,
          'cache-control': 'no-store',
          'content-length': archive.length,
        })
        response.end(archive)
        return
      }
      if (suffix === '/archive/import' || suffix === '/archive/import/') {
        if (method !== 'POST') return sendError(response, 405, 'method not allowed')
        const raw = await readRawBody(request, MAX_BODY_BYTES)
        if (raw.length === 0) return sendError(response, 400, 'archive body is empty')
        let parsed
        try {
          parsed = parseArchive(raw)
        } catch (error) {
          throw new HttpError(400, 'archive is not a readable ZIP: ' + ((error && error.message) || String(error)))
        }
        if (parsed.snapshot === null) return sendError(response, 400, 'archive contained no documents')
        const remapped = remapSnapshot(parsed.snapshot, parsed.media.map((item) => Object.assign({ originalId: item.id }, item)))
        const createdAt = new Date().toISOString()
        const stored = []
        for (const item of remapped.media) {
          const entry = { id: item.id, name: item.name, mime: item.mime, size: item.size, createdAt }
          await writeMedia(entry, item.data)
          stored.push(entry)
        }
        sendJson(response, 200, {
          ok: true,
          value: {
            snapshot: remapped.snapshot,
            media: stored,
            notes: remapped.snapshot.nodes.filter((node) => node.kind === 'doc').length,
            warnings: parsed.warnings,
          },
        })
        return
      }
      if (suffix === '/media' || suffix === '/media/') {
        if (method === 'GET') {
          const entries = await listMedia()
          sendJson(response, 200, {
            ok: true,
            value: { entries, total: entries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0), directory: mediaDirectory },
          })
          return
        }
        if (method === 'POST') {
          const body = await readBody(request)
          if (body === null || typeof body !== 'object') return sendError(response, 400, 'body must be a JSON object')
          const name = String(body.name || '').trim()
          if (name === '') return sendError(response, 400, 'name is required')
          const base64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : ''
          if (base64 === '') return sendError(response, 400, 'dataBase64 is required')
          let data
          try {
            data = Buffer.from(base64, 'base64')
          } catch {
            return sendError(response, 400, 'dataBase64 is not valid base64')
          }
          if (data.length === 0) return sendError(response, 400, 'attachment is empty')
          if (data.length > MAX_MEDIA_BYTES) return sendError(response, 413, 'attachment exceeds 12 MB')
          const entry = {
            id: mediaId(),
            name: name.slice(0, 160),
            mime: String(body.mime || mimeFromName(name)),
            size: data.length,
            createdAt: new Date().toISOString(),
          }
          await writeMedia(entry, data)
          sendJson(response, 200, { ok: true, value: entry })
          return
        }
        return sendError(response, 405, 'method not allowed')
      }
      if (suffix.startsWith('/media/')) {
        const rest = suffix.slice('/media/'.length).replace(/\/+$/, '')
        if (rest === '') return sendError(response, 404, 'unknown endpoint: ' + suffix)
        const id = decodeURIComponent(rest)
        if (!/^[A-Za-z0-9-]+$/.test(id)) return sendError(response, 400, 'invalid media id')
        const entry = await readMediaEntry(id)
        if (entry === null) return sendError(response, 404, 'attachment not found')
        if (method === 'GET') {
          await sendMedia(response, entry, url.searchParams.get('download') === '1')
          return
        }
        if (method === 'DELETE') {
          await unlink(join(mediaDirectory, id)).catch(() => undefined)
          await unlink(join(mediaDirectory, id + '.json')).catch(() => undefined)
          sendJson(response, 200, { ok: true, value: { id, removed: true } })
          return
        }
        return sendError(response, 405, 'method not allowed')
      }
      sendError(response, 404, `unknown endpoint: ${suffix}`)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      sendError(response, status, (error && error.message) || String(error))
    }
  }

  const disposers = [ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })]
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  }, 'dsh-alexandrie: routes')

  console.log(`[dsh-alexandrie] host mounted; data file ${file}`)
}

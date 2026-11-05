// Alexandrie archive: one ZIP that carries every note, the manifest and the media files.
//
// Layout
//   manifest.json              authoritative snapshot + media index
//   notes/<id>-<slug>.md       human-readable copy of every document
//   media/<id>--<name>         binary attachments
//   README.txt                 what this archive is
//
// Import prefers manifest.json; a ZIP full of Markdown files (no manifest) is imported
// as a fresh workspace so an archive produced by hand still works.

import { buildZip, parseZip } from './zip.js'

export const ARCHIVE_FORMAT = 'dsh-alexandrie/archive'
export const ARCHIVE_VERSION = 1

/** URL-safe file name; keeps unicode letters, drops everything that breaks a shell. */
export function slugify(value, fallback = 'untitled') {
  const text = String(value === undefined || value === null ? '' : value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
  return text === '' ? fallback : text
}

/** Safe attachment file name: keeps the extension, strips path separators. */
function safeFileName(name) {
  const base = String(name === undefined || name === null ? 'file' : name).split(/[\\/]/).pop() || 'file'
  return base.replace(/[^\p{Letter}\p{Number}._-]+/gu, '_').slice(0, 80)
}

function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(name || ''))
  return match === null ? '' : match[1].toLowerCase()
}

const EXT_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  zip: 'application/zip', html: 'text/html', css: 'text/css', js: 'text/javascript',
}

export function mimeFromName(name) {
  return EXT_MIME[extensionOf(name)] || 'application/octet-stream'
}

function stamp() {
  return new Date().toISOString()
}

function newId(prefix) {
  const random = Math.random().toString(36).slice(2, 10)
  return prefix + '-' + Date.now().toString(36) + random
}

/** Media entry list of a node (always an array). */
export function mediaOf(node) {
  return node !== null && typeof node === 'object' && Array.isArray(node.media) ? node.media : []
}

/**
 * Build the archive buffer.
 * @param {{snapshot: object, media?: {id: string, name: string, mime: string, data: Buffer}[], exportedAt?: string}} input
 */
export function buildArchive(input) {
  const snapshot = input.snapshot
  const media = Array.isArray(input.media) ? input.media : []
  const exportedAt = input.exportedAt || stamp()
  const entries = []
  const notes = Array.isArray(snapshot.nodes) ? snapshot.nodes.filter((node) => node.kind === 'doc' && node.trashed !== true) : []

  for (const node of notes) {
    const name = 'notes/' + String(node.id) + '-' + slugify(node.title) + '.md'
    const heading = /^#\s/.test(String(node.content || '').trimStart()) ? '' : '# ' + String(node.title || 'Untitled') + '\n\n'
    entries.push({ name, data: heading + String(node.content || '') })
  }

  for (const item of media) {
    if (item === null || typeof item !== 'object' || !Buffer.isBuffer(item.data)) continue
    const id = String(item.id || newId('media'))
    entries.push({ name: 'media/' + id + '--' + safeFileName(item.name), data: item.data })
  }

  const manifest = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt,
    snapshot,
    media: media.map((item) => ({ id: String(item.id), name: String(item.name || ''), mime: String(item.mime || mimeFromName(item.name)) })),
  }

  entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) })
  entries.push({
    name: 'README.txt',
    data:
      'Alexandrie archive\n' +
      '==================\n\n' +
      'manifest.json   authoritative document tree and settings\n' +
      'notes/*.md      a plain-Markdown copy of every document\n' +
      'media/*         attachments referenced by the documents\n\n' +
      'Import the ZIP from the Alexandrie settings panel to restore everything.\n' +
      'Exported at ' + exportedAt + '\n',
  })

  return buildZip(entries)
}

function validateSnapshotShape(snapshot) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) return 'snapshot must be an object'
  if (!Array.isArray(snapshot.workspaces)) return 'snapshot.workspaces must be an array'
  if (!Array.isArray(snapshot.nodes)) return 'snapshot.nodes must be an array'
  for (const node of snapshot.nodes) {
    if (node === null || typeof node !== 'object') return 'every node must be an object'
    if (typeof node.id !== 'string' || node.id === '') return 'every node needs a non-empty id'
  }
  return null
}

/** Build a snapshot out of loose Markdown files (an archive without a manifest). */
function snapshotFromMarkdown(markdown, workspaceName) {
  const now = stamp()
  const workspace = { id: newId('ws'), name: workspaceName, icon: 'book', createdAt: now, updatedAt: now }
  const nodes = markdown.map((file, index) => ({
    id: newId('doc'),
    workspaceId: workspace.id,
    parentId: null,
    kind: 'doc',
    title: file.title,
    content: file.content,
    status: 'active',
    tags: [],
    favorite: false,
    trashed: false,
    order: index,
    createdAt: now,
    updatedAt: now,
  }))
  return {
    version: 1,
    workspaces: [workspace],
    nodes,
    settings: { view: 'list', editorMode: 'split', fontSize: 15, autoSave: true, showLineNumbers: true, sort: 'manual' },
    ui: { activeWorkspaceId: workspace.id, activeNodeId: nodes[0] ? nodes[0].id : null, expanded: [] },
  }
}

/**
 * Read an archive buffer.
 * @param {Buffer} buffer
 * @returns {{snapshot: object|null, media: {id: string, name: string, mime: string, data: Buffer}[], warnings: string[]}}
 */
export function parseArchive(buffer) {
  const entries = parseZip(buffer)
  const warnings = []
  const byName = new Map(entries.map((entry) => [entry.name, entry.data]))

  let snapshot = null
  let mediaIndex = []
  const manifestBuffer = byName.get('manifest.json')
  if (manifestBuffer !== undefined) {
    try {
      const manifest = JSON.parse(manifestBuffer.toString('utf8'))
      if (manifest.format !== ARCHIVE_FORMAT) warnings.push('manifest.json has an unknown format tag')
      const problem = validateSnapshotShape(manifest.snapshot)
      if (problem === null) snapshot = manifest.snapshot
      else warnings.push('manifest.json is not usable: ' + problem)
      if (Array.isArray(manifest.media)) mediaIndex = manifest.media
    } catch {
      warnings.push('manifest.json is not valid JSON')
    }
  }

  const markdown = entries
    .filter((entry) => entry.name.startsWith('notes/') && entry.name.endsWith('.md'))
    .map((entry) => {
      const base = entry.name.slice('notes/'.length).replace(/\.md$/, '')
      const title = base.replace(/^[^-]+-/, '').replace(/-+/g, ' ').trim() || base
      return { title, content: entry.data.toString('utf8') }
    })

  if (snapshot === null && markdown.length > 0) {
    snapshot = snapshotFromMarkdown(markdown, 'Imported notes')
    warnings.push('archive had no usable manifest; documents were rebuilt from the Markdown files')
  }

  const media = []
  for (const entry of entries) {
    if (!entry.name.startsWith('media/')) continue
    const filePart = entry.name.slice('media/'.length)
    const split = filePart.indexOf('--')
    const rawId = split >= 0 ? filePart.slice(0, split) : filePart
    const name = split >= 0 ? filePart.slice(split + 2) : filePart
    const indexed = mediaIndex.find((item) => item !== null && typeof item === 'object' && String(item.id) === rawId)
    media.push({
      id: rawId,
      name: String((indexed && indexed.name) || name),
      mime: String((indexed && indexed.mime) || mimeFromName(name)),
      data: entry.data,
    })
  }

  return { snapshot, media, warnings }
}

// The canvas is a snapshot block, but its cards point at documents and
// attachments by id. An import must rebuild those pointers in the same pass as
// node/media ids, or the layout either disappears or dangles. Anything whose
// target did not survive the import is dropped rather than kept as a card that
// cannot be opened.

function canvasIn(snapshot) {
  const canvas = snapshot && snapshot.canvas
  return canvas !== null && typeof canvas === 'object' ? canvas : null
}

function canvasCards(snapshot, nodeIds, mediaIds) {
  const canvas = canvasIn(snapshot)
  const items = []
  const bySourceId = new Map()
  if (canvas === null || !Array.isArray(canvas.items)) return { items, bySourceId }
  for (const raw of canvas.items) {
    if (raw === null || typeof raw !== 'object') continue
    const kind = raw.kind === 'doc' || raw.kind === 'media' ? raw.kind : null
    const refId = typeof raw.refId === 'string' && raw.refId !== '' ? raw.refId : ''
    if (kind === null || refId === '') continue
    const nextRef = kind === 'doc' ? nodeIds.get(refId) : mediaIds.get(refId)
    if (typeof nextRef !== 'string') continue
    const id = kind + ':' + nextRef
    if (items.some((item) => item.id === id)) continue
    items.push({
      id,
      kind,
      refId: nextRef,
      x: Number.isFinite(raw.x) ? raw.x : 0,
      y: Number.isFinite(raw.y) ? raw.y : 0,
      w: Number.isFinite(raw.w) ? raw.w : 300,
      h: Number.isFinite(raw.h) ? raw.h : 240,
      z: Number.isFinite(raw.z) ? raw.z : items.length,
    })
    bySourceId.set(String(raw.id), id)
  }
  return { items, bySourceId }
}

function canvasLinks(snapshot, bySourceId) {
  const canvas = canvasIn(snapshot)
  const links = []
  if (canvas === null || !Array.isArray(canvas.links)) return links
  const seen = new Set()
  for (const raw of canvas.links) {
    if (raw === null || typeof raw !== 'object') continue
    const from = bySourceId.get(String(raw.from))
    const to = bySourceId.get(String(raw.to))
    if (typeof from !== 'string' || typeof to !== 'string' || from === to) continue
    const pair = [from, to].sort()
    const key = pair[0] + '::' + pair[1]
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ id: 'link:' + key, from: pair[0], to: pair[1] })
  }
  return links
}

function canvasGraph(snapshot) {
  const graph = snapshot && snapshot.graph
  if (graph === null || typeof graph !== 'object') return { showTags: false, showLabels: true, scopeAll: false }
  return { showTags: graph.showTags === true, showLabels: graph.showLabels !== false, scopeAll: graph.scopeAll === true }
}

/**
 * Give an imported snapshot fresh identifiers so merging can never collide, and
 * attach freshly stored media entries back onto their documents.
 * @param {object} snapshot
 * @param {{name: string, mime: string, size: number, data: Buffer}[]} mediaFiles
 * @param {{workspaceName?: string}} [options]
 */
export function remapSnapshot(snapshot, mediaFiles, options = {}) {
  const now = stamp()
  const workspaceIds = new Map()
  const nodeIds = new Map()
  const mediaIds = new Map()
  const workspaceName = options.workspaceName || 'Imported'

  const workspaces = snapshot.workspaces.map((workspace) => {
    const id = newId('ws')
    workspaceIds.set(String(workspace.id), id)
    return {
      id,
      name: String(workspace.name || workspaceName),
      icon: typeof workspace.icon === 'string' ? workspace.icon : 'book',
      createdAt: typeof workspace.createdAt === 'string' ? workspace.createdAt : now,
      updatedAt: now,
    }
  })

  const stored = mediaFiles.map((item) => {
    const id = newId('media')
    if (item.originalId !== undefined) mediaIds.set(String(item.originalId), id)
    return { id, name: safeFileName(item.name), mime: item.mime || mimeFromName(item.name), size: item.size, data: item.data }
  })

  const nodes = snapshot.nodes.map((node) => {
    const id = newId('doc')
    nodeIds.set(String(node.id), id)
    const media = mediaOf(node)
      .map((item) => {
        const file = stored.find((entry) => entry.id === mediaIds.get(String(item && item.id)))
        if (file === undefined) return null
        return { id: file.id, name: file.name, mime: file.mime, size: file.size, uploadedAt: now }
      })
      .filter(Boolean)
    return {
      id,
      workspaceId: workspaceIds.get(String(node.workspaceId)) || (workspaces[0] && workspaces[0].id) || newId('ws'),
      parentId: node.parentId === null || node.parentId === undefined ? null : nodeIds.get(String(node.parentId)) || null,
      kind: node.kind === 'folder' ? 'folder' : 'doc',
      title: String(node.title || 'Untitled'),
      content: typeof node.content === 'string' ? node.content : '',
      status: node.status === 'draft' || node.status === 'done' || node.status === 'active' ? node.status : 'draft',
      tags: Array.isArray(node.tags) ? node.tags.filter((tag) => typeof tag === 'string' && tag !== '') : [],
      favorite: node.favorite === true,
      trashed: false,
      media,
      order: Number.isFinite(node.order) ? node.order : 0,
      createdAt: typeof node.createdAt === 'string' ? node.createdAt : now,
      updatedAt: now,
    }
  })

  const cards = canvasCards(snapshot, nodeIds, mediaIds)

  return {
    snapshot: {
      version: 1,
      workspaces,
      nodes,
      settings: snapshot.settings !== null && typeof snapshot.settings === 'object' ? snapshot.settings : {},
      ui: { activeWorkspaceId: workspaces[0] ? workspaces[0].id : null, activeNodeId: null, expanded: [] },
      canvas: { items: cards.items, links: canvasLinks(snapshot, cards.bySourceId) },
      graph: canvasGraph(snapshot),
    },
    media: stored,
  }
}

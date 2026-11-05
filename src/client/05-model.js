// Domain model: pure helpers over the snapshot plus the mutations the UI applies through
// store.commit(). Nothing here touches React or the network.

const STATUS_ORDER = ['draft', 'active', 'done']
const STATUS_META = {
  draft: { label: 'Draft', token: 'var(--dsw-alias-state-idle-primary)' },
  active: { label: 'Active', token: 'var(--dsw-alias-brand-primary)' },
  done: { label: 'Done', token: 'var(--dsw-alias-state-success-primary)' },
}

const statusLabelOf = (status) => (STATUS_META[status] || STATUS_META.draft).label
const statusTokenOf = (status) => (STATUS_META[status] || STATUS_META.draft).token

const workspacesOf = (snapshot) => snapshot.workspaces.slice()

const workspaceById = (snapshot, id) => snapshot.workspaces.find((workspace) => workspace.id === id) || null

const nodeById = (snapshot, id) => snapshot.nodes.find((node) => node.id === id) || null

const aliveNodes = (snapshot) => snapshot.nodes.filter((node) => node.trashed !== true)

const trashedNodes = (snapshot) => snapshot.nodes.filter((node) => node.trashed === true)

/** Direct children of a parent (null = workspace root), already ordered. */
function childrenOf(snapshot, workspaceId, parentId) {
  return aliveNodes(snapshot)
    .filter((node) => node.workspaceId === workspaceId && (node.parentId || null) === (parentId || null))
    .sort((left, right) => (left.order || 0) - (right.order || 0))
}

/** Ancestor chain from the workspace down to the node itself. */
function nodeTrail(snapshot, nodeId) {
  const trail = []
  let current = nodeById(snapshot, nodeId)
  let guard = 0
  while (current !== null && guard < 64) {
    trail.unshift(current)
    current = current.parentId ? nodeById(snapshot, current.parentId) : null
    guard += 1
  }
  return trail
}

/** Ids of the node and everything nested under it. */
function subtreeIds(snapshot, nodeId) {
  const ids = [nodeId]
  let cursor = 0
  while (cursor < ids.length) {
    const parent = ids[cursor]
    cursor += 1
    for (const node of snapshot.nodes) {
      if ((node.parentId || null) === parent && ids.indexOf(node.id) < 0) ids.push(node.id)
    }
  }
  return ids
}

const wordCountOf = (text) => {
  const cleaned = String(text || '').replace(/[`*_>#\-\[\]\(\)!|]/g, ' ')
  const matches = cleaned.match(/[\p{L}\p{N}']+/gu)
  return matches === null ? 0 : matches.length
}

const readingMinutesOf = (text) => Math.max(1, Math.round(wordCountOf(text) / 220))

/** Tag -> usage count across live documents. */
function collectTags(snapshot) {
  const counts = new Map()
  for (const node of aliveNodes(snapshot)) {
    if (node.kind !== 'doc' || !Array.isArray(node.tags)) continue
    for (const tag of node.tags) {
      const key = String(tag || '').trim()
      if (key === '') continue
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
}

/** Deterministic hue so a tag keeps its colour across sessions (FNV-1a, spread over 360°). */
function tagHue(tag) {
  const text = String(tag || '')
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash) % 360
}

function relativeTime(iso) {
  if (typeof iso !== 'string' || iso === '') return 'never'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown'
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 90) return 'a minute ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} mo ago`
  return `${Math.round(months / 12)} y ago`
}

/** Subsequence fuzzy score; null when the query does not match at all. */
function fuzzyScore(query, text) {
  const needle = String(query || '').trim().toLowerCase()
  const haystack = String(text || '').toLowerCase()
  if (needle === '') return 0
  if (haystack === '') return null
  const direct = haystack.indexOf(needle)
  if (direct >= 0) return 1000 - direct * 3 - (haystack.length - needle.length)
  let score = 0
  let position = 0
  let streak = 0
  for (const character of needle) {
    const found = haystack.indexOf(character, position)
    if (found < 0) return null
    streak = found === position ? streak + 1 : 0
    score += 20 + streak * 8 - Math.min(12, found - position)
    position = found + 1
  }
  return Math.max(1, score)
}

/** Split text into segments for highlight rendering. */
function matchSegments(text, query) {
  const source = String(text || '')
  const needle = String(query || '').trim()
  if (needle === '') return [{ text: source, hit: false }]
  const lowerSource = source.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  const segments = []
  let cursor = 0
  while (cursor < source.length) {
    const found = lowerSource.indexOf(lowerNeedle, cursor)
    if (found < 0) {
      segments.push({ text: source.slice(cursor), hit: false })
      break
    }
    if (found > cursor) segments.push({ text: source.slice(cursor, found), hit: false })
    segments.push({ text: source.slice(found, found + needle.length), hit: true })
    cursor = found + needle.length
  }
  return segments.length === 0 ? [{ text: source, hit: false }] : segments
}

/**
 * Markdown syntax stripped for one-line previews (board cards, search snippets): a card should
 * read like the note, not like its source. Links keep their label, headings lose the hashes,
 * tables and callout fences collapse to spaces.
 */
function plainExcerpt(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*:::\s*\w*.*$/gm, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*\|?[\s:|-]{6,}\|?\s*$/gm, ' ')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Snippet with a little surrounding context, used by the search results list. */
function excerptFor(text, query, radius = 90) {
  const source = plainExcerpt(text)
  const needle = String(query || '').trim()
  if (needle === '' || source === '') return source.slice(0, radius)
  const found = source.toLowerCase().indexOf(needle.toLowerCase())
  if (found < 0) return source.slice(0, radius)
  const start = Math.max(0, found - Math.floor(radius / 2))
  const end = Math.min(source.length, found + needle.length + Math.floor(radius / 2))
  return (start > 0 ? '…' : '') + source.slice(start, end) + (end < source.length ? '…' : '')
}

/** Depth-first list of documents in a workspace, for the board and pickers. */
function docsOf(snapshot, workspaceId) {
  return aliveNodes(snapshot).filter((node) => node.kind === 'doc' && (workspaceId === undefined || node.workspaceId === workspaceId))
}

/** Attachments of a node, always an array. */
function mediaOf(node) {
  return node !== null && typeof node === 'object' && Array.isArray(node.media) ? node.media : []
}

/** Every attachment in the snapshot, newest first, for the media sandbox. */
function allMedia(snapshot) {
  const entries = []
  for (const node of aliveNodes(snapshot)) {
    for (const item of mediaOf(node)) {
      entries.push({ media: item, node })
    }
  }
  entries.sort((left, right) => String(right.media.uploadedAt || '').localeCompare(String(left.media.uploadedAt || '')))
  return entries
}

function nextOrder(snapshot, workspaceId, parentId) {
  const siblings = childrenOf(snapshot, workspaceId, parentId)
  return siblings.length === 0 ? 0 : Math.max(...siblings.map((node) => node.order || 0)) + 1
}

/** Guard against dropping a folder into its own subtree. */
function canReparent(snapshot, nodeId, parentId) {
  if (nodeId === parentId) return false
  if (parentId === null) return true
  return subtreeIds(snapshot, nodeId).indexOf(parentId) < 0
}

const stamp = (node) => {
  node.updatedAt = nowIso()
}

// ---------------------------------------------------------------------------
// Projects: every notebook mirrors one project from the Harness workspace list.
// A workspace carries `projectId` (the Harness id) and `path`; the old single
// "My knowledge base" notebook is adopted by the default project on first sync,
// so notes written before projects existed are never orphaned.
// ---------------------------------------------------------------------------

const isProjectWorkspace = (workspace) =>
  workspace !== null && typeof workspace === 'object' && typeof workspace.projectId === 'string' && workspace.projectId !== ''

/** Stable, readable id so a project's notebook survives reloads and imports. */
function projectWorkspaceId(projectId) {
  const safe = String(projectId || '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return 'ws-proj-' + (safe === '' ? 'project' : safe)
}

function projectFolderName(path) {
  const parts = String(path || '').split(/[\\/]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : ''
}

function projectDisplayName(project) {
  const title = String((project && project.title) || '').trim()
  if (title !== '') return title
  return projectFolderName(project && project.path) || 'Project'
}

/** Deterministic dot colour so each project keeps a recognisable accent. */
const projectHue = (projectId) => tagHue('project:' + String(projectId || ''))

function uniqueWorkspaceId(draft, base) {
  let id = base
  let counter = 2
  while (draft.workspaces.some((workspace) => workspace !== null && workspace.id === id)) {
    id = base + '-' + counter
    counter += 1
  }
  return id
}

function normalizeProjects(projects) {
  const list = []
  const seen = new Set()
  for (const entry of Array.isArray(projects) ? projects : []) {
    if (entry === null || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '' || id === '__proto__' || id === 'prototype' || id === 'constructor' || seen.has(id)) continue
    seen.add(id)
    list.push({
      id,
      title: projectDisplayName(entry).slice(0, 200),
      path: typeof entry.path === 'string' ? entry.path.slice(0, 1024) : '',
    })
  }
  return list
}

function adoptProject(workspace, project) {
  workspace.projectId = project.id
  workspace.path = project.path
  workspace.name = project.title
  workspace.icon = workspace.icon || 'book'
  if (workspace.projectMissing === true) delete workspace.projectMissing
  workspace.updatedAt = nowIso()
}

/**
 * Reconcile the snapshot with the Harness project list:
 * create a notebook per new project, rename/path-update existing ones, adopt a
 * single legacy notebook into the default project, and flag vanished projects
 * instead of deleting their documents.
 */
function syncProjects(draft, projects, defaultProjectId) {
  const list = normalizeProjects(projects)
  const summary = { projects: list.length, created: 0, linked: 0, updated: 0, missing: 0, changed: false, activeWorkspaceId: draft.ui.activeWorkspaceId }
  if (list.length === 0) return summary

  draft.workspaces = draft.workspaces.filter((workspace) => workspace !== null && typeof workspace === 'object')
  const byProject = new Map()
  for (const workspace of draft.workspaces) {
    if (!isProjectWorkspace(workspace)) continue
    if (!byProject.has(workspace.projectId)) byProject.set(workspace.projectId, workspace)
  }

  const known = new Set(list.map((project) => project.id))

  // First migration: a single unbound notebook becomes the default project's notebook.
  if (byProject.size === 0) {
    const unbound = draft.workspaces.filter((workspace) => !isProjectWorkspace(workspace))
    if (unbound.length === 1) {
      const target = list.find((project) => project.id === defaultProjectId) || list[0]
      adoptProject(unbound[0], target)
      byProject.set(target.id, unbound[0])
      summary.linked += 1
      summary.changed = true
    }
  }

  const ordered = []
  for (const project of list) {
    let workspace = byProject.get(project.id)
    if (workspace === undefined) {
      // A hand-made notebook that already points at this project keeps its notes.
      workspace = draft.workspaces.find(
        (candidate) =>
          !isProjectWorkspace(candidate) &&
          ((candidate.path || '') === project.path || (candidate.path || '') === '' && candidate.name === project.title),
      )
      if (workspace !== undefined) {
        adoptProject(workspace, project)
        byProject.set(project.id, workspace)
        summary.linked += 1
        summary.changed = true
      }
    }
    if (workspace === undefined) {
      workspace = {
        id: uniqueWorkspaceId(draft, projectWorkspaceId(project.id)),
        name: project.title,
        icon: 'book',
        color: 'brand',
        projectId: project.id,
        path: project.path,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      draft.workspaces.push(workspace)
      byProject.set(project.id, workspace)
      summary.created += 1
      summary.changed = true
    } else {
      let touched = false
      if (workspace.name !== project.title) {
        workspace.name = project.title
        touched = true
      }
      if ((workspace.path || '') !== project.path) {
        workspace.path = project.path
        touched = true
      }
      if (workspace.projectMissing === true) {
        delete workspace.projectMissing
        touched = true
      }
      if (touched) {
        workspace.updatedAt = nowIso()
        summary.updated += 1
        summary.changed = true
      }
    }
    ordered.push(workspace)
  }

  // Projects that disappeared from the Harness stay readable but are flagged.
  for (const workspace of draft.workspaces) {
    if (!isProjectWorkspace(workspace) || known.has(workspace.projectId)) continue
    if (workspace.projectMissing !== true) {
      workspace.projectMissing = true
      workspace.updatedAt = nowIso()
      summary.missing += 1
      summary.changed = true
    }
    ordered.push(workspace)
  }
  for (const workspace of draft.workspaces) {
    if (!isProjectWorkspace(workspace)) ordered.push(workspace)
  }

  if (ordered.length !== draft.workspaces.length || ordered.some((workspace, index) => workspace !== draft.workspaces[index])) {
    draft.workspaces = ordered
    summary.changed = true
  }

  const active = draft.workspaces.find((workspace) => workspace.id === draft.ui.activeWorkspaceId)
  if (active === undefined) {
    const preferred = byProject.get(defaultProjectId) || ordered[0] || null
    if (preferred !== null) {
      draft.ui.activeWorkspaceId = preferred.id
      draft.ui.activeNodeId = null
      summary.activeWorkspaceId = preferred.id
      summary.changed = true
    }
  }
  return summary
}

/**
 * Link (or re-link) one notebook to a project. When the project already has a
 * notebook, the documents are moved into it instead of leaving a duplicate.
 */
function bindWorkspaceToProject(draft, workspaceId, project) {
  const source = draft.workspaces.find((workspace) => workspace.id === workspaceId)
  if (source === undefined || project === null || typeof project !== 'object') return null
  const id = typeof project.id === 'string' ? project.id.trim() : ''
  if (id === '') return null
  const normalized = { id, title: projectDisplayName(project), path: typeof project.path === 'string' ? project.path : '' }
  if (source.projectId === normalized.id) return { merged: false, workspace: source, moved: 0 }

  const existing = draft.workspaces.find((workspace) => workspace.id !== workspaceId && workspace.projectId === normalized.id)
  if (existing !== undefined) {
    let moved = 0
    for (const node of draft.nodes) {
      if (node.workspaceId !== workspaceId) continue
      node.workspaceId = existing.id
      node.order = nextOrder(draft, existing.id, node.parentId || null)
      stamp(node)
      moved += 1
    }
    draft.workspaces = draft.workspaces.filter((workspace) => workspace.id !== workspaceId)
    if (draft.ui.activeWorkspaceId === workspaceId) draft.ui.activeWorkspaceId = existing.id
    existing.projectMissing = false
    delete existing.projectMissing
    if (!existing.path) existing.path = normalized.path
    return { merged: true, workspace: existing, moved }
  }

  adoptProject(source, normalized)
  return { merged: false, workspace: source, moved: 0 }
}

const model = {
  STATUS_ORDER,
  STATUS_META,
  statusLabelOf,
  statusTokenOf,
  workspacesOf,
  workspaceById,
  nodeById,
  aliveNodes,
  trashedNodes,
  childrenOf,
  nodeTrail,
  subtreeIds,
  wordCountOf,
  readingMinutesOf,
  collectTags,
  tagHue,
  relativeTime,
  fuzzyScore,
  matchSegments,
  excerptFor,
  docsOf,
  mediaOf,
  allMedia,
  nextOrder,
  canReparent,
  isProjectWorkspace,
  projectWorkspaceId,
  projectFolderName,
  projectDisplayName,
  projectHue,
  syncProjects,
  bindWorkspaceToProject,

  createWorkspace(draft, name) {
    const workspace = {
      id: uid('ws'),
      name: String(name || 'Untitled workspace').trim() || 'Untitled workspace',
      icon: 'book',
      color: 'brand',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    draft.workspaces.push(workspace)
    draft.ui.activeWorkspaceId = workspace.id
    draft.ui.activeNodeId = null
    return workspace
  },

  renameWorkspace(draft, workspaceId, name) {
    const workspace = draft.workspaces.find((entry) => entry.id === workspaceId)
    if (workspace === undefined) return
    workspace.name = String(name || '').trim() || workspace.name
    workspace.updatedAt = nowIso()
  },

  removeWorkspace(draft, workspaceId) {
    const victimIds = subtreeIds(draft, workspaceId)
    draft.nodes = draft.nodes.filter((node) => node.workspaceId !== workspaceId)
    draft.workspaces = draft.workspaces.filter((workspace) => workspace.id !== workspaceId)
    if (draft.ui.activeWorkspaceId === workspaceId) {
      draft.ui.activeWorkspaceId = draft.workspaces.length > 0 ? draft.workspaces[0].id : null
    }
    if (draft.ui.activeNodeId && victimIds.indexOf(draft.ui.activeNodeId) >= 0) draft.ui.activeNodeId = null
  },

  createNode(draft, options) {
    const parentId = options.parentId || null
    const kind = options.kind === 'folder' ? 'folder' : 'doc'
    const node = {
      id: uid(kind === 'folder' ? 'dir' : 'doc'),
      workspaceId: options.workspaceId,
      parentId,
      kind,
      title: String(options.title || (kind === 'folder' ? 'New folder' : 'Untitled')).trim(),
      icon: kind === 'folder' ? 'folder' : 'doc',
      status: 'draft',
      tags: [],
      favorite: false,
      trashed: false,
      order: nextOrder(draft, options.workspaceId, parentId),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      content: kind === 'doc' ? String(options.content || '# ' + String(options.title || 'Untitled').trim() + '\n\n') : '',
    }
    draft.nodes.push(node)
    draft.ui.activeNodeId = kind === 'doc' ? node.id : draft.ui.activeNodeId
    return node
  },

  renameNode(draft, nodeId, title) {
    const node = nodeById(draft, nodeId)
    if (node === null) return
    node.title = String(title || '').trim() || node.title
    stamp(node)
  },

  setContent(draft, nodeId, content) {
    const node = nodeById(draft, nodeId)
    if (node === null) return
    node.content = content
    stamp(node)
  },

  setStatus(draft, nodeId, status) {
    const node = nodeById(draft, nodeId)
    if (node === null || STATUS_ORDER.indexOf(status) < 0) return
    node.status = status
    stamp(node)
  },

  toggleFavorite(draft, nodeId) {
    const node = nodeById(draft, nodeId)
    if (node === null) return
    node.favorite = node.favorite !== true
    stamp(node)
  },

  /** Soft delete: the node and its subtree stay in the file, flagged as trashed. */
  trashNode(draft, nodeId) {
    const ids = subtreeIds(draft, nodeId)
    for (const node of draft.nodes) {
      if (ids.indexOf(node.id) < 0) continue
      node.trashed = true
      node.trashedAt = nowIso()
    }
    if (draft.ui.activeNodeId && ids.indexOf(draft.ui.activeNodeId) >= 0) draft.ui.activeNodeId = null
  },

  restoreNode(draft, nodeId) {
    const node = nodeById(draft, nodeId)
    if (node === null) return
    const parent = node.parentId ? nodeById(draft, node.parentId) : null
    if (parent !== null && parent.trashed === true) {
      node.parentId = null
      node.workspaceId = parent.workspaceId
    }
    const ids = subtreeIds(draft, nodeId)
    for (const entry of draft.nodes) {
      if (ids.indexOf(entry.id) < 0) continue
      entry.trashed = false
      delete entry.trashedAt
    }
    draft.ui.activeNodeId = nodeId
  },

  purgeNode(draft, nodeId) {
    const ids = subtreeIds(draft, nodeId)
    // Purging is permanent: drop the canvas cards (and their links) that pointed at
    // these documents or at the attachments they owned, so the canvas never keeps ghosts.
    const dropped = new Set(ids.map((id) => 'doc:' + id))
    for (const node of draft.nodes) {
      if (ids.indexOf(node.id) < 0) continue
      for (const media of mediaOf(node)) dropped.add('media:' + String(media.id))
    }
    draft.nodes = draft.nodes.filter((node) => ids.indexOf(node.id) < 0)
    if (draft.canvas !== undefined && draft.canvas !== null) {
      draft.canvas.items = (Array.isArray(draft.canvas.items) ? draft.canvas.items : []).filter((item) => item !== null && !dropped.has(item.id))
      draft.canvas.links = (Array.isArray(draft.canvas.links) ? draft.canvas.links : []).filter(
        (link) => link !== null && !dropped.has(link.from) && !dropped.has(link.to),
      )
    }
  },

  /** Move a node to another folder/workspace, keeping sibling order sane. */
  moveNode(draft, nodeId, parentId, workspaceId) {
    const node = nodeById(draft, nodeId)
    if (node === null) return false
    if (!canReparent(draft, nodeId, parentId)) return false
    const targetWorkspace = workspaceId || node.workspaceId
    node.parentId = parentId || null
    node.workspaceId = targetWorkspace
    node.order = nextOrder(draft, targetWorkspace, parentId || null)
    stamp(node)
    return true
  },

  /** Reorder one step up or down among its siblings. */
  nudgeOrder(draft, nodeId, delta) {
    const node = nodeById(draft, nodeId)
    if (node === null) return
    const siblings = childrenOf(draft, node.workspaceId, node.parentId)
    const index = siblings.findIndex((entry) => entry.id === nodeId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= siblings.length) return
    const other = nodeById(draft, siblings[target].id)
    const mine = node.order || 0
    node.order = other.order || 0
    other.order = mine
    stamp(node)
    stamp(other)
  },

  addTag(draft, nodeId, tag) {
    const node = nodeById(draft, nodeId)
    if (node === null) return
    const value = String(tag || '').trim().replace(/^#/, '')
    if (value === '') return
    if (!Array.isArray(node.tags)) node.tags = []
    if (node.tags.indexOf(value) < 0) node.tags.push(value)
    stamp(node)
  },

  removeTag(draft, nodeId, tag) {
    const node = nodeById(draft, nodeId)
    if (node === null || !Array.isArray(node.tags)) return
    node.tags = node.tags.filter((entry) => entry !== tag)
    stamp(node)
  },

  setNodeIcon(draft, nodeId, icon) {
    const node = nodeById(draft, nodeId)
    if (node === null) return
    node.icon = icon
  },

  /** Attach an uploaded file to a document. */
  addMedia(draft, nodeId, entry) {
    const node = nodeById(draft, nodeId)
    if (node === null || entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') return
    if (!Array.isArray(node.media)) node.media = []
    if (node.media.some((item) => item !== null && item.id === entry.id)) return
    node.media.push({
      id: entry.id,
      name: String(entry.name || 'file'),
      mime: String(entry.mime || 'application/octet-stream'),
      size: Number(entry.size) || 0,
      uploadedAt: entry.createdAt || nowIso(),
    })
    stamp(node)
  },

  removeMedia(draft, nodeId, mediaId) {
    const node = nodeById(draft, nodeId)
    if (node === null || !Array.isArray(node.media)) return
    node.media = node.media.filter((item) => item === null || item.id !== mediaId)
    if (draft.canvas !== undefined && draft.canvas !== null) {
      const id = 'media:' + String(mediaId)
      draft.canvas.items = (Array.isArray(draft.canvas.items) ? draft.canvas.items : []).filter((item) => item !== null && item.id !== id)
      draft.canvas.links = (Array.isArray(draft.canvas.links) ? draft.canvas.links : []).filter((link) => link !== null && link.from !== id && link.to !== id)
    }
    stamp(node)
  },

  patchSettings(draft, patch) {
    draft.settings = Object.assign({}, draft.settings, patch)
  },

  patchUi(draft, patch) {
    draft.ui = Object.assign({}, draft.ui, patch)
  },

  toggleExpanded(draft, id) {
    const expanded = Array.isArray(draft.ui.expanded) ? draft.ui.expanded.slice() : []
    const index = expanded.indexOf(id)
    if (index >= 0) expanded.splice(index, 1)
    else expanded.push(id)
    draft.ui.expanded = expanded
  },

  isExpanded(snapshot, id) {
    return Array.isArray(snapshot.ui.expanded) && snapshot.ui.expanded.indexOf(id) >= 0
  },
}

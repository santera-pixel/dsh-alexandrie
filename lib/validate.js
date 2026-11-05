// Nested validation for snapshots arriving over the plugin's HTTP route.
//
// `normalizeSnapshot` in the browser half repairs what it can, but the host is the
// authority: a snapshot reaches /save or /archive/import as arbitrary JSON. This module
// resolves every reference (workspaces, nodes, attachments, canvas cards and links)
// before persistence and rejects snapshots written by a build newer than this one.
// Every error carries the exact JSON path it applies to, e.g. `nodes[12].media[0].id`.
//
// Callers get a result instead of an exception:
//   { ok: true, errors: [] } | { ok: false, errors: [{ path, message }] }
// `prepareSnapshot` additionally runs migrations in order before validating.

export const CURRENT_VERSION = 1
export const MAX_NODES = 20000

const MAX_ERRORS = 50
const GRAPH_KEYS = ['showTags', 'showLabels', 'scopeAll']

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isText(value) {
  return typeof value === 'string' && value !== ''
}

function problem(errors, path, message) {
  if (errors.length < MAX_ERRORS) errors.push({ path, message })
}

/** Copy own top-level keys without letting `__proto__` rewrite the result's prototype. */
function copyOwn(snapshot) {
  const next = {}
  for (const key of Object.keys(snapshot)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    next[key] = snapshot[key]
  }
  return next
}

/**
 * Older store shapes are upgraded before validation. Each entry moves exactly one
 * version forward; the loop in `prepareSnapshot` keeps applying them until the
 * snapshot reaches `CURRENT_VERSION`.
 */
export const MIGRATIONS = [
  {
    from: 0,
    to: 1,
    // Version 0 predates both layout blocks. Adding them here mirrors what the client
    // normaliser would write, so the migrated snapshot is indistinguishable from a
    // fresh save by the current build.
    migrate(snapshot) {
      const next = copyOwn(snapshot)
      if (next.canvas === undefined) next.canvas = { items: [], links: [] }
      if (next.graph === undefined) next.graph = { showTags: false, showLabels: true, scopeAll: false }
      next.version = 1
      return next
    },
  },
]

/** Version-only gate, used where the caller must not migrate (archive import). */
export function checkVersion(snapshot) {
  const errors = []
  if (!isObject(snapshot)) {
    problem(errors, 'snapshot', 'must be an object')
    return { ok: false, errors }
  }
  const version = snapshot.version
  if (version === undefined) return { ok: true, errors }
  if (!Number.isInteger(version) || version < 0) {
    problem(errors, 'version', 'must be a non-negative integer')
  } else if (version > CURRENT_VERSION) {
    problem(errors, 'version', `snapshot version ${version} is newer than this build supports (${CURRENT_VERSION}); update Scriptorium before saving it`)
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Walk parent chains with a two-colour mark. A node already on the current chain is a
 * cycle; the reported id lets the caller name the exact path that closes the loop.
 */
function findCycle(ids, idSet, parents, onCycle) {
  const state = new Map()
  for (const start of ids) {
    if (state.get(start) === 2) continue
    const chain = []
    let current = start
    while (current !== undefined && current !== null) {
      if (!idSet.has(current)) break
      if (state.get(current) === 1) {
        onCycle(current)
        break
      }
      if (state.get(current) === 2) break
      state.set(current, 1)
      chain.push(current)
      current = parents.get(current)
    }
    for (const id of chain) state.set(id, 2)
  }
}

/** Validate one snapshot. Unknown top-level blocks are deliberately ignored. */
export function validateSnapshot(snapshot, options = {}) {
  const errors = []
  const maxNodes = Number.isInteger(options.maxNodes) ? options.maxNodes : MAX_NODES
  if (!isObject(snapshot)) {
    problem(errors, 'snapshot', 'must be an object')
    return { ok: false, errors }
  }

  const version = checkVersion(snapshot)
  for (const error of version.errors) problem(errors, error.path, error.message)

  const workspaceIds = new Set()
  const workspaceIndex = new Map()
  const workspaceParents = new Map()
  if (!Array.isArray(snapshot.workspaces)) {
    problem(errors, 'workspaces', 'must be an array')
  } else {
    snapshot.workspaces.forEach((workspace, index) => {
      const path = `workspaces[${index}]`
      if (!isObject(workspace)) {
        problem(errors, path, 'must be an object')
        return
      }
      if (!isText(workspace.id)) {
        problem(errors, path + '.id', 'must be a non-empty string')
        return
      }
      if (workspaceIds.has(workspace.id)) {
        problem(errors, path + '.id', `duplicate workspace id "${workspace.id}"`)
        return
      }
      workspaceIds.add(workspace.id)
      workspaceIndex.set(workspace.id, index)
      if (workspace.parentId !== undefined && workspace.parentId !== null) {
        if (!isText(workspace.parentId)) problem(errors, path + '.parentId', 'must be a non-empty string or null')
        else workspaceParents.set(workspace.id, workspace.parentId)
      }
    })
    for (const [id, parentId] of workspaceParents) {
      if (!workspaceIds.has(parentId)) {
        problem(errors, `workspaces[${workspaceIndex.get(id)}].parentId`, `references missing workspace "${parentId}"`)
      }
    }
    findCycle([...workspaceIds], workspaceIds, workspaceParents, (id) => {
      problem(errors, `workspaces[${workspaceIndex.get(id)}].parentId`, 'creates a parent cycle')
    })
  }

  const nodeIds = new Set()
  const nodeIndex = new Map()
  const nodeParents = new Map()
  const mediaIds = new Set()
  if (!Array.isArray(snapshot.nodes)) {
    problem(errors, 'nodes', 'must be an array')
  } else if (snapshot.nodes.length > maxNodes) {
    problem(errors, 'nodes', `must contain at most ${maxNodes} entries`)
  } else {
    snapshot.nodes.forEach((node, index) => {
      const path = `nodes[${index}]`
      if (!isObject(node)) {
        problem(errors, path, 'must be an object')
        return
      }
      let usableId = false
      if (!isText(node.id)) {
        problem(errors, path + '.id', 'must be a non-empty string')
      } else if (nodeIds.has(node.id)) {
        problem(errors, path + '.id', `duplicate node id "${node.id}"`)
      } else {
        nodeIds.add(node.id)
        nodeIndex.set(node.id, index)
        usableId = true
      }
      if (!isText(node.workspaceId)) {
        problem(errors, path + '.workspaceId', 'must be a non-empty string')
      } else if (!workspaceIds.has(node.workspaceId)) {
        problem(errors, path + '.workspaceId', `references missing workspace "${node.workspaceId}"`)
      }
      if (node.title !== undefined && typeof node.title !== 'string') problem(errors, path + '.title', 'must be a string')
      if (node.content !== undefined && typeof node.content !== 'string') problem(errors, path + '.content', 'must be a string')
      if (node.tags !== undefined) {
        if (!Array.isArray(node.tags)) problem(errors, path + '.tags', 'must be an array')
        else {
          node.tags.forEach((tag, tagIndex) => {
            if (!isText(tag)) problem(errors, `${path}.tags[${tagIndex}]`, 'must be a non-empty string')
          })
        }
      }
      if (node.media !== undefined) {
        if (!Array.isArray(node.media)) problem(errors, path + '.media', 'must be an array')
        else {
          node.media.forEach((entry, mediaIndex) => {
            const mediaPath = `${path}.media[${mediaIndex}]`
            if (!isObject(entry)) {
              problem(errors, mediaPath, 'must be an object')
              return
            }
            if (!isText(entry.id)) {
              problem(errors, mediaPath + '.id', 'must be a non-empty string')
            } else if (mediaIds.has(entry.id)) {
              problem(errors, mediaPath + '.id', `duplicate attachment id "${entry.id}"`)
            } else {
              mediaIds.add(entry.id)
            }
            if (entry.name !== undefined && typeof entry.name !== 'string') problem(errors, mediaPath + '.name', 'must be a string')
            if (entry.mime !== undefined && typeof entry.mime !== 'string') problem(errors, mediaPath + '.mime', 'must be a string')
            if (entry.size !== undefined && !(typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0)) {
              problem(errors, mediaPath + '.size', 'must be a non-negative number')
            }
            if (entry.uploadedAt !== undefined && typeof entry.uploadedAt !== 'string') problem(errors, mediaPath + '.uploadedAt', 'must be a string')
          })
        }
      }
      if (node.parentId !== undefined && node.parentId !== null) {
        if (!isText(node.parentId)) problem(errors, path + '.parentId', 'must be a non-empty string or null')
        else if (usableId) nodeParents.set(node.id, node.parentId)
      }
    })
    for (const [id, parentId] of nodeParents) {
      const index = nodeIndex.get(id)
      if (!nodeIds.has(parentId)) {
        problem(errors, `nodes[${index}].parentId`, `references missing node "${parentId}"`)
        continue
      }
      const node = snapshot.nodes[index]
      const parent = snapshot.nodes[nodeIndex.get(parentId)]
      if (isObject(node) && isObject(parent) && node.workspaceId !== parent.workspaceId) {
        problem(errors, `nodes[${index}].parentId`, `parent node "${parentId}" belongs to another workspace`)
      }
    }
    findCycle([...nodeIds], nodeIds, nodeParents, (id) => {
      problem(errors, `nodes[${nodeIndex.get(id)}].parentId`, 'creates a parent cycle')
    })
  }

  if (snapshot.canvas !== undefined) {
    if (!isObject(snapshot.canvas)) {
      problem(errors, 'canvas', 'must be an object')
    } else {
      const itemIds = new Set()
      const items = snapshot.canvas.items
      if (items !== undefined && !Array.isArray(items)) {
        problem(errors, 'canvas.items', 'must be an array')
      } else if (Array.isArray(items)) {
        items.forEach((item, index) => {
          const path = `canvas.items[${index}]`
          if (!isObject(item)) {
            problem(errors, path, 'must be an object')
            return
          }
          const kind = item.kind
          const refId = item.refId
          if (kind !== 'doc' && kind !== 'media') problem(errors, path + '.kind', 'must be "doc" or "media"')
          if (!isText(refId)) {
            problem(errors, path + '.refId', 'must be a non-empty string')
          } else if (kind === 'doc' && !nodeIds.has(refId)) {
            problem(errors, path + '.refId', `references missing node "${refId}"`)
          } else if (kind === 'media' && !mediaIds.has(refId)) {
            problem(errors, path + '.refId', `references missing attachment "${refId}"`)
          }
          if (!isText(item.id)) {
            problem(errors, path + '.id', 'must be a non-empty string')
          } else {
            if (isText(refId) && (kind === 'doc' || kind === 'media')) {
              const expected = kind + ':' + refId
              if (item.id !== expected) problem(errors, path + '.id', `must be "${expected}" for this ${kind} card`)
            }
            if (itemIds.has(item.id)) problem(errors, path + '.id', `duplicate canvas item id "${item.id}"`)
            itemIds.add(item.id)
          }
        })
      }
      const links = snapshot.canvas.links
      if (links !== undefined && !Array.isArray(links)) {
        problem(errors, 'canvas.links', 'must be an array')
      } else if (Array.isArray(links)) {
        links.forEach((link, index) => {
          const path = `canvas.links[${index}]`
          if (!isObject(link)) {
            problem(errors, path, 'must be an object')
            return
          }
          if (!isText(link.id)) problem(errors, path + '.id', 'must be a non-empty string')
          if (!isText(link.from) || !itemIds.has(link.from)) {
            problem(errors, path + '.from', `references missing canvas item "${String(link.from)}"`)
          }
          if (!isText(link.to) || !itemIds.has(link.to)) {
            problem(errors, path + '.to', `references missing canvas item "${String(link.to)}"`)
          }
          if (isText(link.from) && link.from === link.to) problem(errors, path + '.to', 'must not link a card to itself')
        })
      }
    }
  }

  if (snapshot.graph !== undefined) {
    if (!isObject(snapshot.graph)) {
      problem(errors, 'graph', 'must be an object')
    } else {
      for (const key of Object.keys(snapshot.graph)) {
        if (GRAPH_KEYS.indexOf(key) < 0) problem(errors, 'graph.' + key, 'is not a known graph preference')
        else if (typeof snapshot.graph[key] !== 'boolean') problem(errors, 'graph.' + key, 'must be a boolean')
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Version gate + ordered migrations + validation. `migratedFrom` is the version the
 * caller sent when a migration ran, or null when the snapshot was already current.
 */
export function prepareSnapshot(snapshot, options = {}) {
  if (!isObject(snapshot)) {
    return { ok: false, errors: [{ path: 'snapshot', message: 'must be an object' }], snapshot: null, migratedFrom: null }
  }
  const version = snapshot.version === undefined ? CURRENT_VERSION : snapshot.version
  if (!Number.isInteger(version) || version < 0) {
    return { ok: false, errors: [{ path: 'version', message: 'must be a non-negative integer' }], snapshot: null, migratedFrom: null }
  }
  if (version > CURRENT_VERSION) {
    return {
      ok: false,
      errors: [
        {
          path: 'version',
          message: `snapshot version ${version} is newer than this build supports (${CURRENT_VERSION}); update Scriptorium before saving it`,
        },
      ],
      snapshot: null,
      migratedFrom: null,
    }
  }
  let prepared = snapshot
  let cursor = version
  const migratedFrom = cursor < CURRENT_VERSION ? cursor : null
  while (cursor < CURRENT_VERSION) {
    const step = MIGRATIONS.find((migration) => migration.from === cursor)
    if (step === undefined) {
      return { ok: false, errors: [{ path: 'version', message: `no migration from version ${cursor}` }], snapshot: null, migratedFrom }
    }
    prepared = step.migrate(prepared)
    cursor = step.to
  }
  const result = validateSnapshot(prepared, options)
  return { ok: result.ok, errors: result.errors, snapshot: prepared, migratedFrom }
}

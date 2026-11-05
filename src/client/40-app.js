// >>>>>>>>>>>>>>>>>>>>>>>>>>>> 40-app.js >>>>>>>>>>>>>>>>>>>>>>>>>>>>
// Application shell: header, view routing, overlays, toasts and every user action.

const VIEWS = [
  { id: 'doc', label: 'Documents', icon: 'doc' },
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'media', label: 'Media', icon: 'image' },
  { id: 'canvas', label: 'Canvas', icon: 'canvas' },
  { id: 'graph', label: 'Graph', icon: 'graph' },
]

function slugify(text) {
  return String(text || 'document')
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'document'
}

function EmptyState({ icon, title, hint, action }) {
  return h(
    'div',
    { className: 'dsh-scr-empty' },
    h('div', { className: 'dsh-scr-empty-icon' }, h(Icon, { name: icon, size: 22 })),
    h('div', { className: 'dsh-scr-empty-title' }, title),
    hint ? h('div', { className: 'dsh-scr-empty-hint' }, hint) : null,
    action || null,
  )
}

function DocumentList({ nodes, snapshot, onOpen, actions, emptyHint, showRestore }) {
  if (nodes.length === 0) {
    return h(EmptyState, { icon: 'doc', title: 'Nothing here yet', hint: emptyHint })
  }
  return h(
    'div',
    { className: 'dsh-scr-list', style: { padding: '14px 18px' } },
    nodes.map((node) => {
      const stats = markdownStats(node.content || '')
      const workspace = model.workspaceById(snapshot, node.workspaceId)
      return h(
        'div',
        {
          key: node.id,
          className: 'dsh-scr-list-row',
          role: 'button',
          tabIndex: 0,
          onClick: () => (showRestore ? null : onOpen(node.id)),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !showRestore) onOpen(node.id)
          },
        },
        h('span', { className: 'dsh-scr-tree-kind' }, h(Icon, { name: node.icon || 'doc', size: 15 })),
        h(
          'div',
          { className: 'dsh-scr-list-main' },
          h('span', { className: 'dsh-scr-list-title' }, node.title),
          h(
            'span',
            { className: 'dsh-scr-list-sub' },
            (workspace ? workspace.name + ' Â· ' : '') +
              model.statusLabelOf(node.status) +
              ' Â· ' +
              stats.words +
              ' words Â· ' +
              (showRestore ? 'trashed ' + model.relativeTime(node.trashedAt) : 'edited ' + model.relativeTime(node.updatedAt)),
          ),
        ),
        h(
          'span',
          { className: 'dsh-scr-list-actions' },
          showRestore
            ? [
                h(IconButton, { key: 'r', icon: 'restore', label: 'Restore', onClick: () => actions.restoreNode(node.id) }),
                h(IconButton, { key: 'p', icon: 'close', label: 'Delete forever', danger: true, onClick: () => actions.purgeNode(node.id) }),
              ]
            : [
                h(IconButton, {
                  key: 's',
                  icon: 'star',
                  label: node.favorite ? 'Unfavourite' : 'Favourite',
                  active: node.favorite === true,
                  onClick: () => actions.toggleFavorite(node.id),
                }),
                h(IconButton, { key: 't', icon: 'trash', label: 'Trash', danger: true, onClick: () => actions.trashNode(node.id) }),
              ],
        ),
      )
    }),
  )
}

function FolderView({ snapshot, node, actions }) {
  const children = model.childrenOf(snapshot, node.workspaceId, node.id)
  return h(
    'div',
    { className: 'dsh-scr-view' },
    h(
      'div',
      { className: 'dsh-scr-doc-head' },
      h('input', {
        className: 'dsh-scr-doc-title',
        value: node.title,
        onChange: (event) => actions.renameNode(node.id, event.target.value),
      }),
      h(
        'div',
        { className: 'dsh-scr-doc-meta' },
        h('span', null, children.length + ' item(s)'),
        h('span', { className: 'dsh-scr-doc-meta-sep' }, 'Â·'),
        h('span', null, 'Edited ' + model.relativeTime(node.updatedAt)),
        h('span', { className: 'dsh-scr-spacer', style: { flex: '1 1 auto' } }),
        h('button', { type: 'button', className: 'dsh-scr-btn', onClick: () => actions.createFolder(node.id) }, h(Icon, { name: 'folder', size: 14 }), 'Folder'),
        h('button', { type: 'button', className: 'dsh-scr-btn is-primary', onClick: () => actions.createDoc(node.id) }, h(Icon, { name: 'plus', size: 14 }), 'Document'),
      ),
    ),
    h(DocumentList, {
      nodes: children,
      snapshot,
      actions,
      onOpen: actions.openNode,
      emptyHint: 'This folder is empty. Add a document to get started.',
    }),
  )
}

/** Read a File as base64 (attachment upload) or as raw bytes (ZIP import). */
function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject((reader.error && reader.error.message) || 'could not read file')
    reader.readAsDataURL(file)
  })
}

function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result || new ArrayBuffer(0)))
    reader.onerror = () => reject((reader.error && reader.error.message) || 'could not read file')
    reader.readAsArrayBuffer(file)
  })
}

/** Save a Blob/bytes through a temporary object URL. */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files && input.files[0]
      resolve(file || null)
    }
    input.click()
  })
}

function App({ store }) {
  const [tick, setTick] = React.useState(0)
  const [view, setView] = React.useState('doc')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [toasts, setToasts] = React.useState([])
  const [tagFilter, setTagFilter] = React.useState(null)
  const [query, setQuery] = React.useState('')
  const [previewMedia, setPreviewMedia] = React.useState(null)
  const [busy, setBusy] = React.useState(null)
  const bootedRef = React.useRef(false)
  const projectSyncedRef = React.useRef(false)

  React.useEffect(() => {
    const unsubscribe = store.subscribe(() => setTick((value) => value + 1))
    if (!bootedRef.current) {
      bootedRef.current = true
      if (store.state.status !== 'ready') void store.load()
    }
    return unsubscribe
  }, [])

  const snapshot = store.state.snapshot
  const ui = snapshot.ui || {}
  const settings = snapshot.settings || {}
  const activeNode = ui.activeNodeId ? model.nodeById(snapshot, ui.activeNodeId) : null
  const activeWorkspace = ui.activeWorkspaceId ? model.workspaceById(snapshot, ui.activeWorkspaceId) : null
  const projectState = store.state.projects || { status: 'idle', projects: [] }
  const projectList = Array.isArray(projectState.projects) ? projectState.projects : []
  // Project mode kicks in as soon as the host reports projects, or when the stored
  // snapshot already has bound notebooks (so the UI does not flip while loading).
  const projectMode = projectList.length > 0 || snapshot.workspaces.some((workspace) => model.isProjectWorkspace(workspace) || workspace.projectMissing === true)
  const projectLoading = projectState.status === 'loading'

  const notify = React.useCallback((message, kind) => {
    const id = uid('toast')
    setToasts((current) => current.concat([{ id, message, kind: kind || 'info' }]))
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 2800)
  }, [])

  const commit = (mutator, options) => store.commit(mutator, options)

  const actions = {
    view,
    notify,
    setTagFilter,
    selectTag: (tag) => {
      if (tagFilter === tag) {
        setTagFilter(null)
        setView('doc')
        return
      }
      setTagFilter(tag)
      setView('tag')
    },
    openView: (name) => {
      if (name === 'favorites' || name === 'trash') setView(name)
      else if (VIEWS.some((entry) => entry.id === name)) setView(name)
      else setView('doc')
    },
    openNode: (id) => {
      setView('doc')
      commit((draft) => model.patchUi(draft, { activeNodeId: id }))
    },
    toggleExpanded: (id) => commit((draft) => model.toggleExpanded(draft, id)),
    selectWorkspace: (id) => commit((draft) => model.patchUi(draft, { activeWorkspaceId: id, activeNodeId: null })),
    createWorkspace: (name) => commit((draft) => model.createWorkspace(draft, name), { immediate: true }),
    renameWorkspace: (id, name) => commit((draft) => model.renameWorkspace(draft, id, name)),
    removeWorkspace: (id) => {
      commit((draft) => model.removeWorkspace(draft, id), { immediate: true })
      notify('Workspace deleted', 'info')
    },
    syncProjects: async (options = {}) => {
      try {
        const result = await store.syncProjects()
        if (result.projects.length === 0) {
          if (options.silent !== true) notify('No DSH projects found — create one in the Harness first', 'info')
          return null
        }
        let summary = null
        commit((draft) => {
          summary = model.syncProjects(draft, result.projects, result.defaultProjectId)
        }, { immediate: true })
        if (options.silent !== true && summary !== null) {
          const parts = []
          if (summary.created > 0) parts.push(summary.created + ' created')
          if (summary.linked > 0) parts.push(summary.linked + ' linked')
          if (summary.updated > 0) parts.push(summary.updated + ' updated')
          if (summary.missing > 0) parts.push(summary.missing + ' missing')
          notify(parts.length === 0 ? 'Project notebooks are up to date' : 'Projects: ' + parts.join(', '), 'success')
        }
        return summary
      } catch (error) {
        if (options.silent !== true) notify('Project sync failed: ' + ((error && error.message) || String(error)), 'error')
        return null
      }
    },
    bindWorkspace: (workspaceId, projectId) => {
      const project = projectList.find((entry) => entry.id === projectId)
      if (project === undefined) return
      let result = null
      commit((draft) => {
        result = model.bindWorkspaceToProject(draft, workspaceId, project)
      }, { immediate: true })
      if (result === null) return
      if (result.merged === true) notify('Linked to ' + project.title + ' — merged ' + result.moved + ' document(s)', 'success')
      else notify('Linked to ' + project.title, 'success')
    },
    createDoc: (parentId) => {
      if (!ui.activeWorkspaceId) {
        notify('Create a workspace first', 'error')
        return
      }
      setView('doc')
      commit(
        (draft) => {
          const node = model.createNode(draft, {
            workspaceId: draft.ui.activeWorkspaceId,
            parentId: parentId || null,
            kind: 'doc',
            title: 'Untitled',
            content: '# Untitled\n\n',
          })
          model.patchUi(draft, { activeNodeId: node.id })
        },
        { immediate: true },
      )
    },
    createFolder: (parentId) => {
      if (!ui.activeWorkspaceId) {
        notify('Create a workspace first', 'error')
        return
      }
      commit((draft) => model.createNode(draft, { workspaceId: draft.ui.activeWorkspaceId, parentId: parentId || null, kind: 'folder', title: 'New folder' }), { immediate: true })
    },
    renameNode: (id, title) => commit((draft) => model.renameNode(draft, id, title)),
    setContent: (id, content) => commit((draft) => model.setContent(draft, id, content)),
    setStatus: (id, status) => commit((draft) => model.setStatus(draft, id, status)),
    toggleFavorite: (id) => commit((draft) => model.toggleFavorite(draft, id)),
    trashNode: (id) => {
      commit((draft) => model.trashNode(draft, id), { immediate: true })
      notify('Moved to trash', 'info')
    },
    restoreNode: (id) => {
      commit((draft) => model.restoreNode(draft, id), { immediate: true })
      notify('Restored', 'success')
    },
    purgeNode: (id) => {
      commit((draft) => model.purgeNode(draft, id), { immediate: true })
      notify('Deleted forever', 'info')
    },
    moveNode: (id, parentId, workspaceId) => {
      let moved = false
      commit(
        (draft) => {
          moved = model.moveNode(draft, id, parentId, workspaceId)
          if (moved) model.patchUi(draft, { expanded: (draft.ui.expanded || []).indexOf(parentId) >= 0 ? draft.ui.expanded : (draft.ui.expanded || []).concat([parentId]) })
        },
        { immediate: true },
      )
      if (!moved) notify('Cannot move a folder into itself', 'error')
    },
    addTag: (id, tag) => commit((draft) => model.addTag(draft, id, tag)),
    removeTag: (id, tag) => commit((draft) => model.removeTag(draft, id, tag)),
    patchSettings: (patch) => commit((draft) => model.patchSettings(draft, patch)),
    patchUi: (patch) => commit((draft) => model.patchUi(draft, patch)),
    openSettings: () => setSettingsOpen(true),
    saveNow: () => store.saveNow(),
    reload: () => void store.load(),
    emptyTrash: () => commit((draft) => { draft.nodes = draft.nodes.filter((node) => node.trashed !== true) }, { immediate: true }),
    exportDocument: (id) => {
      const node = model.nodeById(snapshot, id)
      if (node === null) return
      downloadText(slugify(node.title) + '.md', node.content || '', 'text/markdown')
      notify('Document exported', 'success')
    },
    exportArchive: () => {
      downloadText('scriptorium-archive-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(snapshot, null, 2))
      notify('JSON archive exported', 'success')
    },
    exportZip: async () => {
      setBusy('export')
      try {
        const response = await fetch(ROUTE_BASE + '/archive/export')
        if (!response.ok) {
          const detail = await response.text()
          throw new Error(detail === '' ? 'HTTP ' + response.status : detail)
        }
        downloadBlob('scriptorium-' + new Date().toISOString().slice(0, 10) + '.zip', await response.blob())
        notify('ZIP exported: notes, media and metadata', 'success')
      } catch (error) {
        notify('Export failed: ' + ((error && error.message) || String(error)), 'error')
      } finally {
        setBusy(null)
      }
    },
    importArchive: async () => {
      const file = await pickFile('.json,application/json')
      if (file === null) return
      try {
        const parsed = parseJsonArchive(await file.text())
        let merged = null
        commit((draft) => {
          merged = mergeSnapshot(draft, parsed)
          draft.workspaces = merged.workspaces
          draft.nodes = merged.nodes
          draft.canvas = merged.canvas
        }, { immediate: true })
        notify('Merged ' + parsed.nodes.length + ' item(s) from JSON', 'success')
      } catch (error) {
        notify('Import failed: ' + ((error && error.message) || String(error)), 'error')
      }
    },
    importZip: async () => {
      const file = await pickFile('.zip,application/zip')
      if (file === null) return
      setBusy('import')
      try {
        const bytes = await readFileBytes(file)
        const result = await apiRaw('/archive/import', { method: 'POST', body: bytes, contentType: 'application/zip' })
        commit((draft) => {
          const merged = mergeSnapshot(draft, result.snapshot)
          draft.workspaces = merged.workspaces
          draft.nodes = merged.nodes
          draft.canvas = merged.canvas
        }, { immediate: true })
        const counts = result.notes + ' document(s)' + (result.media.length > 0 ? ' and ' + result.media.length + ' attachment(s)' : '')
        notify('Imported ' + counts, 'success')
      } catch (error) {
        notify('ZIP import failed: ' + ((error && error.message) || String(error)), 'error')
      } finally {
        setBusy(null)
      }
    },
    uploadMedia: async (nodeId, files) => {
      if (!files || files.length === 0) return
      setBusy('media')
      try {
        for (const file of Array.from(files)) {
          const dataBase64 = await readFileBase64(file)
          const entry = await api('/media', { method: 'POST', body: { name: file.name, mime: file.type, dataBase64 } })
          commit((draft) => {
            model.addMedia(draft, nodeId, entry)
            const node = model.nodeById(draft, nodeId)
            const attached = node === null ? null : model.mediaOf(node).find((item) => item.id === entry.id) || null
            // New attachments land on the media canvas beside the document that owns them.
            if (attached !== null) canvasSyncMedia(draft, [{ media: attached, node }])
          }, { immediate: true })
        }
        notify(files.length === 1 ? 'Attachment added' : files.length + ' attachments added', 'success')
      } catch (error) {
        notify('Upload failed: ' + ((error && error.message) || String(error)), 'error')
      } finally {
        setBusy(null)
      }
    },
    removeMedia: async (nodeId, mediaId) => {
      commit((draft) => model.removeMedia(draft, nodeId, mediaId), { immediate: true })
      try {
        await apiRaw('/media/' + encodeURIComponent(mediaId), { method: 'DELETE' })
        notify('Attachment removed', 'info')
      } catch {
        notify('Attachment unlinked (the file stays on disk)', 'info')
      }
    },
    openPreview: (media) => setPreviewMedia(media),
    closePreview: () => setPreviewMedia(null),
    connectNodes: (sourceId, targetId) => {
      const source = model.nodeById(snapshot, sourceId)
      const target = model.nodeById(snapshot, targetId)
      if (source === null || target === null || sourceId === targetId) return
      const link = '[[' + target.title + ']]'
      const content = typeof source.content === 'string' ? source.content : ''
      if (content.indexOf(link) >= 0) {
        notify('Those documents are already linked', 'info')
        return
      }
      const body = content.replace(/\s*$/, '')
      const next = body === '' ? link + '\n' : body + '\n\n' + link + '\n'
      commit((draft) => model.setContent(draft, sourceId, next))
      notify('Linked to ' + target.title, 'success')
    },
    busy,
  }

  // Mirror the Harness project list once the notebook is ready. Silent on boot:
  // infrastructure work should not greet the user with a toast.
  React.useEffect(() => {
    if (store.state.status === 'loading') {
      projectSyncedRef.current = false
      return
    }
    if (store.state.status !== 'ready' || projectSyncedRef.current) return
    projectSyncedRef.current = true
    void actions.syncProjects({ silent: true })
  }, [store.state.status])

  const commands = React.useMemo(() => {
    const list = [
      { id: 'new-doc', title: 'New document', hint: 'Ctrl+N', group: 'Create', icon: 'plus', run: () => actions.createDoc(null) },
      { id: 'new-folder', title: 'New folder', group: 'Create', icon: 'folder', run: () => actions.createFolder(null) },
      ...(projectMode
        ? [{ id: 'sync-projects', title: 'Sync project notebooks', group: 'Projects', icon: 'refresh', run: () => actions.syncProjects() }]
        : [{ id: 'new-workspace', title: 'New workspace', group: 'Create', icon: 'book', run: () => actions.createWorkspace('New workspace') }]),
      { id: 'view-doc', title: 'Go to documents', group: 'Navigate', icon: 'doc', run: () => setView('doc') },
      { id: 'view-board', title: 'Go to board', group: 'Navigate', icon: 'board', run: () => setView('board') },
      { id: 'view-media', title: 'Go to media sandbox', group: 'Navigate', icon: 'image', run: () => setView('media') },
      { id: 'view-canvas', title: 'Go to media canvas', group: 'Navigate', icon: 'canvas', run: () => setView('canvas') },
      { id: 'view-graph', title: 'Go to mind graph', group: 'Navigate', icon: 'graph', run: () => setView('graph') },
      { id: 'view-favorites', title: 'Go to favourites', group: 'Navigate', icon: 'star', run: () => setView('favorites') },
      { id: 'view-trash', title: 'Go to trash', group: 'Navigate', icon: 'trash', run: () => setView('trash') },
      { id: 'search', title: 'Search documents', hint: 'Ctrl+K', group: 'Navigate', icon: 'search', run: () => setSearchOpen(true) },
      { id: 'save', title: 'Save now', hint: 'Ctrl+S', group: 'Data', icon: 'save', run: () => actions.saveNow() },
      { id: 'export', title: 'Export JSON archive', group: 'Data', icon: 'download', run: () => actions.exportArchive() },
      { id: 'export-zip', title: 'Export ZIP with media', group: 'Data', icon: 'archive', run: () => actions.exportZip() },
      { id: 'import', title: 'Import JSON archive', group: 'Data', icon: 'upload', run: () => actions.importArchive() },
      { id: 'import-zip', title: 'Import ZIP archive', group: 'Data', icon: 'upload', run: () => actions.importZip() },
      { id: 'settings', title: 'Open settings', group: 'Data', icon: 'settings', run: () => setSettingsOpen(true) },
    ]
    const docs = model.aliveNodes(snapshot).filter((node) => node.kind === 'doc' && node.workspaceId === ui.activeWorkspaceId)
    for (const node of docs.slice(0, 40)) {
      list.push({ id: 'doc-' + node.id, title: node.title, hint: 'Document', group: 'Documents', icon: node.icon || 'doc', run: () => actions.openNode(node.id) })
    }
    return list
  }, [snapshot, ui.activeWorkspaceId, view])

  React.useEffect(() => {
    const onKeyDown = (event) => {
      const meta = event.ctrlKey || event.metaKey
      const target = event.target
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (event.key === 'Escape') {
        if (settingsOpen) setSettingsOpen(false)
        else if (paletteOpen) setPaletteOpen(false)
        else if (searchOpen) setSearchOpen(false)
        else if (previewMedia !== null) setPreviewMedia(null)
        else if (view === 'tag') {
          setTagFilter(null)
          setView('doc')
        }
        return
      }
      // Everything else stays out of the way while the caret is inside a field: the editor
      // owns Ctrl+S and Ctrl+B/I there, and Ctrl+N while typing in a title would be a surprise.
      if (typing) return
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        actions.saveNow()
        return
      }
      if (meta && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        actions.createDoc(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const favorites = model.aliveNodes(snapshot).filter((node) => node.favorite === true && node.kind === 'doc')
  const trashed = model.trashedNodes(snapshot)
  const tags = model.collectTags(snapshot)
  const filteredFavorites = tagFilter === null ? favorites : favorites.filter((node) => Array.isArray(node.tags) && node.tags.indexOf(tagFilter) >= 0)

  const renderMain = () => {
    if (store.state.status === 'loading') {
      return h('div', { className: 'dsh-scr-skeleton' }, [0, 1, 2, 3].map((index) => h('div', { key: index, className: 'dsh-scr-skeleton-line' })))
    }
    if (store.state.status === 'error') {
      return h(EmptyState, {
        icon: 'warning',
        title: 'Could not load your knowledge base',
        hint: store.state.error || 'The host store did not respond.',
        action: h('button', { type: 'button', className: 'dsh-scr-btn is-primary', onClick: () => store.load() }, 'Retry'),
      })
    }
    if (snapshot.workspaces.length === 0) {
      if (projectMode) {
        return h(EmptyState, {
          icon: 'book',
          title: 'No project notebooks yet',
          hint: projectState.error
            ? 'Project sync failed: ' + projectState.error
            : 'Notebooks mirror the projects in your Harness workspace list. Create a project there, then sync.',
          action: h(
            'button',
            { type: 'button', className: 'dsh-scr-btn is-primary', disabled: projectLoading, onClick: () => actions.syncProjects() },
            h(Icon, { name: 'refresh', size: 14 }),
            projectLoading ? 'Syncing…' : 'Sync projects',
          ),
        })
      }
      return h(EmptyState, {
        icon: 'book',
        title: 'Create your first workspace',
        hint: 'Workspaces group documents, folders and boards. Everything is stored locally in your DSH home.',
        action: h('button', { type: 'button', className: 'dsh-scr-btn is-primary', onClick: () => actions.createWorkspace('My knowledge base') }, h(Icon, { name: 'plus', size: 14 }), 'New workspace'),
      })
    }
    if (view === 'tag') {
      const tagged =
        tagFilter === null
          ? []
          : model.aliveNodes(snapshot).filter(
              (node) => node.kind === 'doc' && (!ui.activeWorkspaceId || node.workspaceId === ui.activeWorkspaceId) && Array.isArray(node.tags) && node.tags.indexOf(tagFilter) >= 0,
            )
      return h(
        'div',
        { className: 'dsh-scr-view' },
        h(
          'div',
          { className: 'dsh-scr-doc-head' },
          h('div', { className: 'dsh-scr-doc-title', style: { fontSize: 20 } }, tagFilter === null ? 'Tag' : '#' + tagFilter),
          h(
            'div',
            { className: 'dsh-scr-doc-meta' },
            h('span', null, tagged.length + ' tagged document(s)'),
            h('span', { className: 'dsh-scr-doc-meta-sep' }, 'Â·'),
            h('button', { type: 'button', className: 'dsh-scr-btn', onClick: () => actions.selectTag(tagFilter) }, 'Clear filter'),
          ),
        ),
        h(DocumentList, {
          nodes: tagged,
          snapshot,
          actions,
          onOpen: actions.openNode,
          emptyHint: 'No document carries this tag yet. Open a document and add it from the tag row.',
        }),
      )
    }
    if (view === 'media') {
      return h('div', { className: 'dsh-scr-view' }, h(MediaLibrary, { snapshot, actions, onPreview: actions.openPreview }))
    }
    if (view === 'board') {
      return h(KanbanBoard, {
        store,
        snapshot,
        workspaceId: ui.activeWorkspaceId || undefined,
        onOpen: (id) => {
          actions.openNode(id)
          setView('doc')
        },
      })
    }
    if (view === 'canvas') {
      return h('div', { className: 'dsh-scr-view dsh-scr-view-fill' }, h(MediaCanvas, {
        store,
        snapshot,
        workspaceId: ui.activeWorkspaceId || undefined,
        onOpen: actions.openNode,
        onPreview: actions.openPreview,
        notify,
      }))
    }
    if (view === 'graph') {
      return h('div', { className: 'dsh-scr-view dsh-scr-view-fill' }, h(MindGraph, {
        store,
        snapshot,
        workspaceId: ui.activeWorkspaceId || undefined,
        onOpen: actions.openNode,
        onConnect: actions.connectNodes,
        notify,
      }))
    }
    if (view === 'favorites') {
      return h(
        'div',
        { className: 'dsh-scr-view' },
        h(
          'div',
          { className: 'dsh-scr-doc-head' },
          h('div', { className: 'dsh-scr-doc-title', style: { fontSize: 20 } }, 'Favourites'),
          h(
            'div',
            { className: 'dsh-scr-doc-meta' },
            h('span', null, filteredFavorites.length + ' starred document(s)'),
            tagFilter === null ? null : h('span', { className: 'dsh-scr-chip is-active' }, '#' + tagFilter),
          ),
        ),
        h(DocumentList, { nodes: filteredFavorites, snapshot, actions, onOpen: actions.openNode, emptyHint: 'Star a document with the star icon to pin it here.' }),
      )
    }
    if (view === 'trash') {
      return h(
        'div',
        { className: 'dsh-scr-view' },
        h(
          'div',
          { className: 'dsh-scr-doc-head' },
          h('div', { className: 'dsh-scr-doc-title', style: { fontSize: 20 } }, 'Trash'),
          h(
            'div',
            { className: 'dsh-scr-doc-meta' },
            h('span', null, trashed.length + ' document(s)'),
            h('span', { className: 'dsh-scr-spacer', style: { flex: '1 1 auto' } }),
            h('button', { type: 'button', className: 'dsh-scr-btn is-danger', disabled: trashed.length === 0, onClick: () => { actions.emptyTrash(); notify('Trash emptied', 'success') } }, h(Icon, { name: 'trash', size: 14 }), 'Empty trash'),
          ),
        ),
        h(DocumentList, { nodes: trashed, snapshot, actions, onOpen: actions.openNode, showRestore: true, emptyHint: 'Deleted documents stay here until you empty the trash.' }),
      )
    }
    if (!ui.activeWorkspaceId) {
      return h(EmptyState, {
        icon: 'book',
        title: 'No project selected',
        hint: projectMode ? 'Pick a project in the sidebar, or press sync to mirror the Harness workspace list.' : 'Pick a workspace in the sidebar, or create a new one.',
      })
    }
    if (activeNode === null) {
      return h(EmptyState, {
        icon: 'doc',
        title: 'Select a document',
        hint: 'Choose a note from the sidebar, or create a new document to start writing.',
        action: h('button', { type: 'button', className: 'dsh-scr-btn is-primary', onClick: () => actions.createDoc(null) }, h(Icon, { name: 'plus', size: 14 }), 'New document'),
      })
    }
    if (activeNode.kind === 'folder') return h(FolderView, { snapshot, node: activeNode, actions })
    if (activeNode.trashed === true) {
      return h(EmptyState, {
        icon: 'trash',
        title: 'This document is in the trash',
        hint: 'Restore it to keep editing, or delete it permanently.',
        action: h('button', { type: 'button', className: 'dsh-scr-btn is-primary', onClick: () => actions.restoreNode(activeNode.id) }, h(Icon, { name: 'restore', size: 14 }), 'Restore'),
      })
    }
    return h(DocumentEditor, { store, snapshot, node: activeNode, ui, actions })
  }

  return h(
    'div',
    { className: 'dsh-scr-root' },
    h(
      'header',
      { className: 'dsh-scr-header' },
      h(
        'div',
        { className: 'dsh-scr-brand' },
        h('span', { className: 'dsh-scr-brand-mark' }, h(Icon, { name: 'book', size: 15 })),
        h('span', { className: 'dsh-scr-brand-name' }, 'Scriptorium'),
      ),
      h(IconButton, { icon: 'sidebar', label: 'Toggle sidebar', onClick: () => actions.patchUi({ sidebarCollapsed: !ui.sidebarCollapsed }) }),
      h(
        'div',
        { className: 'dsh-scr-crumbs' },
        activeWorkspace
          ? h(
              'span',
              { className: 'dsh-scr-crumb', title: activeWorkspace.path || activeWorkspace.name },
              activeWorkspace.projectMissing === true ? h('span', { className: 'dsh-scr-ws-chip' }, 'missing') : null,
              activeWorkspace.name,
            )
          : null,
        activeNode && activeWorkspace && activeNode.kind === 'doc' ? h('span', { className: 'dsh-scr-crumb-sep' }, '/') : null,
        activeNode && activeNode.kind === 'doc' ? h('span', { className: 'dsh-scr-crumb' }, activeNode.title) : null,
      ),
      h(
        'button',
        { type: 'button', className: 'dsh-scr-searchbtn', onClick: () => setSearchOpen(true) },
        h(Icon, { name: 'search', size: 13 }),
        h('span', { style: { flex: '1 1 auto' } }, 'Search documentsâ€¦'),
        h('span', { className: 'dsh-scr-kbd' }, 'Ctrl K'),
      ),
      h(
        'div',
        { className: 'dsh-scr-seg' },
        VIEWS.map((entry) =>
          h(
            'button',
            {
              key: entry.id,
              type: 'button',
              className: cx('dsh-scr-seg-btn', view === entry.id && 'is-active'),
              onClick: () => setView(entry.id),
            },
            h(Icon, { name: entry.icon, size: 12 }),
            entry.label,
          ),
        ),
      ),
      h(IconButton, { icon: 'plus', label: 'New document (Ctrl+N)', onClick: () => actions.createDoc(null) }),
      h(IconButton, { icon: 'command', label: 'Command palette (Ctrl+K)', onClick: () => setPaletteOpen(true) }),
      h(IconButton, { icon: 'settings', label: 'Settings', onClick: () => setSettingsOpen(true) }),
    ),
    h(
      'div',
      { className: 'dsh-scr-body', 'data-tick': tick },
      h(Sidebar, {
        snapshot,
        ui,
        actions,
        tags,
        activeTag: tagFilter,
        projects: projectList,
        projectMode,
        projectLoading,
        onSync: () => actions.syncProjects(),
        onBind: actions.bindWorkspace,
      }),
      h('main', { className: 'dsh-scr-main' }, h('div', { className: 'dsh-scr-main-scroll' }, renderMain())),
    ),

    searchOpen
      ? h(
          'div',
          {
            className: 'dsh-scr-backdrop',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) setSearchOpen(false)
            },
          },
          h(SearchOverlay, {
            snapshot,
            query,
            workspaceId: null,
            onQueryChange: setQuery,
            onClose: () => setSearchOpen(false),
            onPick: (node) => {
              setSearchOpen(false)
              actions.openNode(node.id)
            },
          }),
        )
      : null,
    paletteOpen ? h(CommandPalette, { commands, onClose: () => setPaletteOpen(false) }) : null,
    previewMedia === null ? null : h(MediaPreview, { media: previewMedia, onClose: actions.closePreview }),
    settingsOpen ? h(SettingsModal, { snapshot, store, actions, onClose: () => setSettingsOpen(false) }) : null,

    h(
      'div',
      { className: 'dsh-scr-toast-stack' },
      toasts.map((toast) =>
        h(
          'div',
          { key: toast.id, className: cx('dsh-scr-toast', toast.kind === 'error' && 'is-error', toast.kind === 'success' && 'is-success') },
          h(Icon, { name: toast.kind === 'error' ? 'warning' : toast.kind === 'success' ? 'check' : 'sparkles', size: 14 }),
          toast.message,
        ),
      ),
    ),
  )
}


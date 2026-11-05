// Sidebar shell: workspace switcher, nested document tree, tag cloud and footer actions.

function SidebarSection({ title, count, children, action }) {
  return h(
    'section',
    { className: 'dsh-scr-section' },
    h(
      'div',
      { className: 'dsh-scr-section-head' },
      h('span', { className: 'dsh-scr-section-title' }, title),
      count === undefined ? null : h('span', { className: 'dsh-scr-section-count' }, String(count)),
      action || null,
    ),
    children,
  )
}

/** Two trailing path segments, enough to tell same-named projects apart. */
function shortProjectPath(path) {
  const parts = String(path || '').split(/[\\/]+/).filter(Boolean)
  return parts.slice(-2).join(' / ')
}

/**
 * Workspaces are project notebooks: one mirror per DSH project.
 * In project mode a bound notebook cannot be renamed or deleted (the host owns
 * its identity), but an unbound notebook can be linked to a project and a
 * vanished project is only flagged, never removed automatically.
 */
function WorkspaceList({
  snapshot,
  activeWorkspaceId,
  projects,
  projectMode,
  projectLoading,
  onSelect,
  onCreate,
  onRename,
  onRemove,
  onBind,
  onSync,
}) {
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [editingId, setEditingId] = React.useState(null)
  const [editDraft, setEditDraft] = React.useState('')

  const commitCreate = () => {
    const name = draft.trim()
    setCreating(false)
    setDraft('')
    if (name !== '') onCreate(name)
  }

  const commitRename = () => {
    const id = editingId
    const name = editDraft.trim()
    setEditingId(null)
    if (id !== null && name !== '') onRename(id, name)
  }

  const bound = []
  const missing = []
  const unbound = []
  for (const workspace of snapshot.workspaces) {
    if (workspace.projectMissing === true) missing.push(workspace)
    else if (model.isProjectWorkspace(workspace)) bound.push(workspace)
    else unbound.push(workspace)
  }
  const projectList = Array.isArray(projects) ? projects : []

  const renderRow = (workspace) => {
    const active = workspace.id === activeWorkspaceId
    const isBound = model.isProjectWorkspace(workspace) && workspace.projectMissing !== true
    const isMissing = workspace.projectMissing === true
    if (workspace.id === editingId) {
      return h('input', {
        key: workspace.id,
        className: 'dsh-scr-input',
        autoFocus: true,
        value: editDraft,
        style: { margin: '2px 0' },
        onChange: (event) => setEditDraft(event.target.value),
        onBlur: commitRename,
        onKeyDown: (event) => {
          if (event.key === 'Enter') commitRename()
          if (event.key === 'Escape') setEditingId(null)
        },
      })
    }
    return h(
      'div',
      {
        key: workspace.id,
        className: cx('dsh-scr-ws-row', active && 'is-active', isBound && 'is-project', isMissing && 'is-missing'),
        role: 'button',
        tabIndex: 0,
        onClick: () => onSelect(workspace.id),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect(workspace.id)
        },
        onDoubleClick: () => {
          if (isBound) return
          setEditingId(workspace.id)
          setEditDraft(workspace.name)
        },
        title: isBound ? workspace.path || workspace.name : isMissing ? 'This project is no longer in the Harness workspace list' : 'Double-click to rename',
      },
      h('span', {
        className: 'dsh-scr-ws-dot',
        style: model.isProjectWorkspace(workspace) ? { background: 'hsl(' + model.projectHue(workspace.projectId) + ' 65% 55%)' } : undefined,
      }),
      h(
        'span',
        { className: 'dsh-scr-ws-text' },
        h('span', { className: 'dsh-scr-ws-name' }, workspace.name),
        model.isProjectWorkspace(workspace) && workspace.path
          ? h('span', { className: 'dsh-scr-ws-path' }, shortProjectPath(workspace.path))
          : null,
      ),
      isMissing ? h('span', { className: 'dsh-scr-ws-chip' }, 'missing') : null,
      h(
        'span',
        { className: 'dsh-scr-tree-actions' },
        !isBound && projectList.length > 0
          ? h(
              'select',
              {
                className: 'dsh-scr-ws-link',
                value: '',
                title: 'Link this notebook to a project',
                onClick: (event) => event.stopPropagation(),
                onChange: (event) => {
                  const projectId = event.target.value
                  event.target.value = ''
                  if (projectId !== '') onBind(workspace.id, projectId)
                },
              },
              h('option', { value: '' }, 'Link…'),
              projectList.map((project) => h('option', { key: project.id, value: project.id }, project.title)),
            )
          : null,
        !isBound
          ? h(IconButton, {
              icon: 'trash',
              label: isMissing ? 'Delete this notebook and its documents' : 'Delete workspace',
              size: 12,
              className: 'dsh-scr-icon-btn--sm is-danger',
              onClick: (event) => {
                event.stopPropagation()
                onRemove(workspace.id)
              },
            })
          : null,
      ),
    )
  }

  let body = null
  if (projectMode) {
    body = bound.map(renderRow)
    if (missing.length > 0) body = body.concat([h('div', { key: 'g-missing', className: 'dsh-scr-ws-group' }, 'Project not found'), missing.map(renderRow)])
    if (unbound.length > 0) body = body.concat([h('div', { key: 'g-unbound', className: 'dsh-scr-ws-group' }, 'Not linked'), unbound.map(renderRow)])
  } else {
    body = snapshot.workspaces.map(renderRow)
  }

  return h(
    SidebarSection,
    {
      title: projectMode ? 'Projects' : 'Workspaces',
      count: projectMode ? bound.length + missing.length : snapshot.workspaces.length,
      action: projectMode
        ? h(IconButton, {
            icon: 'refresh',
            label: projectLoading ? 'Syncing projects…' : 'Sync with Harness projects',
            size: 14,
            className: cx('dsh-scr-icon-btn--sm', projectLoading && 'is-spinning'),
            disabled: projectLoading,
            onClick: onSync,
          })
        : h(IconButton, { icon: 'plus', label: 'New workspace', size: 14, className: 'dsh-scr-icon-btn--sm', onClick: () => setCreating(true) }),
    },
    h('div', { className: 'dsh-scr-ws-list' }, body),
    !projectMode && creating
      ? h('input', {
          className: 'dsh-scr-input',
          autoFocus: true,
          placeholder: 'Workspace name',
          value: draft,
          style: { margin: '2px 0' },
          onChange: (event) => setDraft(event.target.value),
          onBlur: commitCreate,
          onKeyDown: (event) => {
            if (event.key === 'Enter') commitCreate()
            if (event.key === 'Escape') { setCreating(false); setDraft('') }
          },
        })
      : null,
    projectMode && bound.length === 0 && missing.length === 0
      ? h('div', { className: 'dsh-scr-ws-empty' }, projectLoading ? 'Loading projects…' : 'No project notebooks yet — press refresh.')
      : null,
  )
}

/**
 * One row of the document tree. Folders expand, documents open; both drag onto a folder
 * to reparent, and both support inline renaming.
 */
function TreeNode({ snapshot, node, depth, activeId, actions, expandedIds, onDragNode }) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(node.title)
  const [dropTarget, setDropTarget] = React.useState(false)
  const isFolder = node.kind === 'folder'
  const children = isFolder ? model.childrenOf(snapshot, node.workspaceId, node.id) : []
  const open = expandedIds.indexOf(node.id) >= 0
  const active = node.id === activeId

  const commit = () => {
    const title = draft.trim()
    setEditing(false)
    if (title !== '' && title !== node.title) actions.renameNode(node.id, title)
    else setDraft(node.title)
  }

  const stop = (event) => {
    event.stopPropagation()
    event.preventDefault()
  }

  return h(
    'div',
    { className: 'dsh-scr-tree-node' },
    h(
      'div',
      {
        className: cx('dsh-scr-tree-row', active && 'is-active', dropTarget && 'is-dragover'),
        style: { paddingLeft: 6 + depth * 13 },
        draggable: !editing,
        onClick: () => (isFolder ? actions.toggleExpanded(node.id) : actions.openNode(node.id)),
        onDoubleClick: () => {
          setDraft(node.title)
          setEditing(true)
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            if (isFolder) actions.toggleExpanded(node.id)
            else actions.openNode(node.id)
          }
          if (event.key === 'F2') setEditing(true)
          if (event.key === 'Delete') actions.trashNode(node.id)
        },
        tabIndex: 0,
        role: 'treeitem',
        'aria-expanded': isFolder ? open : undefined,
        onDragStart: (event) => {
          event.dataTransfer.setData('text/plain', node.id)
          event.dataTransfer.effectAllowed = 'move'
          onDragNode(node.id)
        },
        onDragEnd: () => onDragNode(null),
        onDragOver: (event) => {
          if (!isFolder) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTarget(true)
        },
        onDragLeave: () => setDropTarget(false),
        onDrop: (event) => {
          if (!isFolder) return
          event.preventDefault()
          event.stopPropagation()
          setDropTarget(false)
          const dragged = event.dataTransfer.getData('text/plain')
          if (dragged && dragged !== node.id) actions.moveNode(dragged, node.id, node.workspaceId)
        },
      },
      h(
        'button',
        {
          type: 'button',
          className: cx('dsh-scr-tree-chevron', open && 'is-open', !isFolder && 'is-hidden'),
          tabIndex: -1,
          onClick: (event) => {
            stop(event)
            actions.toggleExpanded(node.id)
          },
        },
        h(Icon, { name: 'chevron', size: 12 }),
      ),
      h('span', { className: 'dsh-scr-tree-kind' }, h(Icon, { name: node.icon || (isFolder ? 'folder' : 'doc'), size: 14 })),
      editing
        ? h('input', {
            className: 'dsh-scr-input',
            autoFocus: true,
            value: draft,
            style: { padding: '2px 6px', fontSize: 12.5 },
            onClick: stop,
            onChange: (event) => setDraft(event.target.value),
            onBlur: commit,
            onKeyDown: (event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                setDraft(node.title)
                setEditing(false)
              }
            },
          })
        : h('span', { className: 'dsh-scr-tree-label', title: node.title }, node.title),
      node.status === 'done' ? h('span', { className: 'dsh-scr-tree-badge' }, '✓') : null,
      h(
        'span',
        { className: 'dsh-scr-tree-actions' },
        isFolder
          ? h(IconButton, { icon: 'plus', label: 'New document here', size: 12, className: 'dsh-scr-icon-btn--sm', onClick: (event) => { stop(event); actions.createDoc(node.id) } })
          : null,
        h(IconButton, {
          icon: 'star',
          label: node.favorite ? 'Remove from favourites' : 'Add to favourites',
          size: 12,
          className: cx('dsh-scr-icon-btn--sm', node.favorite && 'is-active'),
          onClick: (event) => { stop(event); actions.toggleFavorite(node.id) },
        }),
        h(IconButton, { icon: 'trash', label: 'Move to trash', size: 12, className: 'dsh-scr-icon-btn--sm is-danger', onClick: (event) => { stop(event); actions.trashNode(node.id) } }),
      ),
    ),
    isFolder
      ? h(
          'div',
          { className: cx('dsh-scr-tree-children', open && 'is-open'), style: { marginLeft: 6 + depth * 13 } },
          h(
            'div',
            null,
            children.length === 0
              ? h('div', { className: 'dsh-scr-tree-row', style: { paddingLeft: 22, opacity: 0.55, cursor: 'default' } }, h('span', { className: 'dsh-scr-tree-label' }, 'Empty folder'))
              : children.map((child) =>
                  h(TreeNode, {
                    key: child.id,
                    snapshot,
                    node: child,
                    depth: depth + 1,
                    activeId,
                    actions,
                    expandedIds,
                    onDragNode,
                  }),
                ),
          ),
        )
      : null,
  )
}

function TagCloud({ tags, activeTag, onPick }) {
  if (tags.length === 0) {
    return h('div', { className: 'dsh-scr-field-hint', style: { padding: '2px 6px 8px' } }, 'Tag a document to see it here.')
  }
  return h(
    'div',
    { className: 'dsh-scr-chip-wrap', style: { padding: '2px 6px 6px' } },
    tags.slice(0, 24).map((entry) => {
      const hue = model.tagHue(entry.tag)
      const active = entry.tag === activeTag
      return h(
        'button',
        {
          key: entry.tag,
          type: 'button',
          className: cx('dsh-scr-chip', active && 'is-active'),
          style: {
            background: `hsla(${hue}, 65%, 55%, ${active ? 0.3 : 0.16})`,
            color: `hsl(${hue}, 62%, ${active ? 45 : 62}%)`,
            borderColor: active ? `hsl(${hue}, 62%, 55%)` : 'transparent',
          },
          onClick: () => onPick(active ? null : entry.tag),
          title: `${entry.count} document(s)`,
        },
        '#' + entry.tag,
        h('span', { className: 'dsh-scr-tree-badge' }, String(entry.count)),
      )
    }),
  )
}

function Sidebar({ snapshot, ui, actions, tags, activeTag, projects, projectMode, projectLoading, onSync, onBind }) {
  const workspaceId = ui.activeWorkspaceId
  const roots = workspaceId ? model.childrenOf(snapshot, workspaceId, null) : []
  const draggingRef = React.useRef(null)
  const onDragNode = (id) => {
    draggingRef.current = id
  }
  const trashCount = model.trashedNodes(snapshot).length
  const favoriteCount = model.aliveNodes(snapshot).filter((node) => node.favorite === true).length

  return h(
    'aside',
    { className: cx('dsh-scr-sidebar', ui.sidebarCollapsed && 'is-collapsed') },
    h(
      'div',
      { className: 'dsh-scr-sidebar-scroll' },
      h(WorkspaceList, {
        snapshot,
        activeWorkspaceId: workspaceId,
        projects,
        projectMode,
        projectLoading,
        onSelect: actions.selectWorkspace,
        onCreate: actions.createWorkspace,
        onRename: actions.renameWorkspace,
        onRemove: actions.removeWorkspace,
        onBind,
        onSync,
      }),
      workspaceId
        ? h(
            SidebarSection,
            {
              title: 'Documents',
              count: roots.length,
              action: h(
                'span',
                { style: { display: 'flex', gap: 2 } },
                h(IconButton, { icon: 'folder', label: 'New folder', size: 13, className: 'dsh-scr-icon-btn--sm', onClick: () => actions.createFolder(null) }),
                h(IconButton, { icon: 'plus', label: 'New document', size: 13, className: 'dsh-scr-icon-btn--sm', onClick: () => actions.createDoc(null) }),
              ),
            },
            h(
              'div',
              { className: 'dsh-scr-tree', role: 'tree' },
              roots.length === 0
                ? h('div', { className: 'dsh-scr-field-hint', style: { padding: '4px 6px' } }, 'No documents yet — create one with the + button.')
                : roots.map((node) =>
                    h(TreeNode, {
                      key: node.id,
                      snapshot,
                      node,
                      depth: 0,
                      activeId: ui.activeNodeId,
                      actions,
                      expandedIds: Array.isArray(ui.expanded) ? ui.expanded : [],
                      onDragNode,
                    }),
                  ),
            ),
          )
        : null,
      h(SidebarSection, { title: 'Shortcuts' },
        h(
          'div',
          { className: 'dsh-scr-tree' },
          h(
            'div',
            {
              className: cx('dsh-scr-tree-row', actions.view === 'favorites' && 'is-active'),
              onClick: () => actions.openView('favorites'),
              role: 'button',
              tabIndex: 0,
            },
            h('span', { className: 'dsh-scr-tree-chevron is-hidden' }),
            h('span', { className: 'dsh-scr-tree-kind' }, h(Icon, { name: 'star', size: 14 })),
            h('span', { className: 'dsh-scr-tree-label' }, 'Favourites'),
            h('span', { className: 'dsh-scr-tree-badge' }, String(favoriteCount)),
          ),
          h(
            'div',
            {
              className: cx('dsh-scr-tree-row', actions.view === 'trash' && 'is-active'),
              onClick: () => actions.openView('trash'),
              role: 'button',
              tabIndex: 0,
            },
            h('span', { className: 'dsh-scr-tree-chevron is-hidden' }),
            h('span', { className: 'dsh-scr-tree-kind' }, h(Icon, { name: 'trash', size: 14 })),
            h('span', { className: 'dsh-scr-tree-label' }, 'Trash'),
            h('span', { className: 'dsh-scr-tree-badge' }, String(trashCount)),
          ),
        ),
      ),
      h(SidebarSection, { title: 'Tags', count: tags.length },
        h(TagCloud, { tags, activeTag, onPick: actions.selectTag }),
      ),
    ),
    h(
      'div',
      { className: 'dsh-scr-sidebar-footer' },
      h(IconButton, { icon: 'settings', label: 'Settings', onClick: actions.openSettings }),
      h(IconButton, { icon: 'upload', label: 'Import archive', onClick: actions.importArchive }),
      h(IconButton, { icon: 'download', label: 'Export archive', onClick: actions.exportArchive }),
      h('span', { className: 'dsh-scr-spacer' }),
      h(IconButton, { icon: 'sidebar', label: 'Collapse sidebar', onClick: () => actions.patchUi({ sidebarCollapsed: !ui.sidebarCollapsed }) }),
    ),
  )
}

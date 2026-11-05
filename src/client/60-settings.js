// Settings overlay: appearance, behaviour, storage and data maintenance.

function SettingsRow({ title, hint, children }) {
  return h(
    'div',
    { className: 'dsh-scr-switch-row' },
    h('div', { className: 'dsh-scr-switch-text' }, h('span', { className: 'dsh-scr-switch-title' }, title), hint ? h('span', { className: 'dsh-scr-switch-hint' }, hint) : null),
    children,
  )
}

function SettingsSwitch({ value, onChange, label }) {
  return h(
    'button',
    {
      type: 'button',
      className: cx('dsh-scr-switch', value && 'is-on'),
      role: 'switch',
      'aria-checked': value === true,
      'aria-label': label,
      onClick: () => onChange(!value),
    },
    h('span', { className: 'dsh-scr-switch-knob' }),
  )
}

function formatBytes(size) {
  const value = Number(size)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return value + ' B'
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB'
  return (value / (1024 * 1024)).toFixed(2) + ' MB'
}

function SettingsModal({ snapshot, store, actions, onClose }) {
  const settings = snapshot.settings || {}
  const storage = store.state.storage || {}
  const stats = markdownStats
  const docs = model.aliveNodes(snapshot).filter((node) => node.kind === 'doc')
  const words = docs.reduce((total, node) => total + model.wordCountOf(node.content), 0)
  const trashed = model.trashedNodes(snapshot).length
  const media = allMedia(snapshot)
  const projectState = store.state.projects || { status: 'idle', projects: [] }
  const projectCount = Array.isArray(projectState.projects) ? projectState.projects.length : 0
  const linkedCount = snapshot.workspaces.filter((workspace) => model.isProjectWorkspace(workspace)).length
  const missingCount = snapshot.workspaces.filter((workspace) => workspace.projectMissing === true).length

  return h(
    'div',
    {
      className: 'dsh-scr-backdrop',
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose()
      },
    },
    h(
      'div',
      { className: 'dsh-scr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Scriptorium settings' },
      h(
        'div',
        { className: 'dsh-scr-modal-head' },
        h('span', { className: 'dsh-scr-brand-mark' }, h(Icon, { name: 'settings', size: 15 })),
        h('span', { className: 'dsh-scr-modal-title' }, 'Settings'),
        h(IconButton, { icon: 'close', label: 'Close settings', onClick: onClose }),
      ),
      h(
        'div',
        { className: 'dsh-scr-modal-body' },
        h(
          'div',
          { className: 'dsh-scr-stats' },
          h('div', { className: 'dsh-scr-stat' }, h('div', { className: 'dsh-scr-stat-value' }, String(docs.length)), h('div', { className: 'dsh-scr-stat-label' }, 'Documents')),
          h('div', { className: 'dsh-scr-stat' }, h('div', { className: 'dsh-scr-stat-value' }, words.toLocaleString()), h('div', { className: 'dsh-scr-stat-label' }, 'Words')),
          h('div', { className: 'dsh-scr-stat' }, h('div', { className: 'dsh-scr-stat-value' }, String(snapshot.workspaces.length)), h('div', { className: 'dsh-scr-stat-label' }, projectCount > 0 ? 'Projects' : 'Workspaces')),
          h('div', { className: 'dsh-scr-stat' }, h('div', { className: 'dsh-scr-stat-value' }, formatBytes(storage.size)), h('div', { className: 'dsh-scr-stat-label' }, 'On disk')),
        ),

        h('div', { className: 'dsh-scr-field-label', style: { marginTop: 4 } }, 'Appearance'),
        h(
          SettingsRow,
          { title: 'Editor layout', hint: 'How the Markdown editor and preview share the pane.' },
          h(
            'span',
            { className: 'dsh-scr-seg' },
            EDITOR_MODES.map((mode) =>
              h(
                'button',
                {
                  key: mode.id,
                  type: 'button',
                  className: cx('dsh-scr-seg-btn', (settings.editorMode || 'split') === mode.id && 'is-active'),
                  onClick: () => actions.patchSettings({ editorMode: mode.id }),
                },
                h(Icon, { name: mode.icon, size: 12 }),
                mode.label,
              ),
            ),
          ),
        ),
        h(
          SettingsRow,
          { title: 'Text size', hint: 'Applies to the editor and the rendered preview.' },
          h(
            'span',
            { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('input', {
              type: 'range',
              min: 13,
              max: 19,
              step: 1,
              value: settings.fontSize || 15,
              style: { width: 120, accentColor: 'var(--dsw-alias-brand-primary)' },
              onChange: (event) => actions.patchSettings({ fontSize: Number(event.target.value) }),
            }),
            h('span', { style: { fontSize: 12, width: 30 } }, (settings.fontSize || 15) + 'px'),
          ),
        ),

        h('div', { className: 'dsh-scr-field-label', style: { marginTop: 10 } }, 'Behaviour'),
        h(
          SettingsRow,
          { title: 'Auto-save', hint: 'Persist changes to the host file shortly after you stop typing.' },
          h(SettingsSwitch, { value: settings.autoSave !== false, label: 'Auto-save', onChange: (value) => actions.patchSettings({ autoSave: value }) }),
        ),
        h(
          SettingsRow,
          { title: 'Save on close', hint: 'Flush pending edits when the panel is hidden.' },
          h(SettingsSwitch, { value: settings.saveOnClose !== false, label: 'Save on close', onChange: (value) => actions.patchSettings({ saveOnClose: value }) }),
        ),

        h('div', { className: 'dsh-scr-field-label', style: { marginTop: 10 } }, 'Storage'),
        h(
          'div',
          { className: 'dsh-scr-field' },
          h(
            'div',
            { className: 'dsh-scr-field-hint', style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, wordBreak: 'break-all' } },
            storage.file || 'Resolving storage location…',
          ),
          h(
            'div',
            { className: 'dsh-scr-field-hint' },
            'Revision ' + String(store.state.revision) + ' · updated ' + model.relativeTime(store.state.updatedAt) + ' · ' + trashed + ' item(s) in trash',
          ),
          h(
            'div',
            { className: 'dsh-scr-field-hint' },
            media.length + ' attachment(s) · ' + formatBytes(media.reduce((total, entry) => total + (Number(entry.size) || 0), 0)) + ' in the media sandbox',
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 } },
          h('button', { type: 'button', className: 'dsh-scr-btn', onClick: () => { actions.saveNow(); actions.notify('Saved to disk', 'success') } }, h(Icon, { name: 'save', size: 14 }), 'Save now'),
          h('button', { type: 'button', className: 'dsh-scr-btn is-primary', onClick: actions.exportZip }, h(Icon, { name: 'archive', size: 14 }), 'Export ZIP'),
          h('button', { type: 'button', className: 'dsh-scr-btn', onClick: actions.importZip }, h(Icon, { name: 'upload', size: 14 }), 'Import ZIP'),
          h('button', { type: 'button', className: 'dsh-scr-btn', onClick: actions.exportArchive }, h(Icon, { name: 'download', size: 14 }), 'Export JSON'),
          h('button', { type: 'button', className: 'dsh-scr-btn', onClick: actions.importArchive }, h(Icon, { name: 'upload', size: 14 }), 'Import JSON'),
          h('button', { type: 'button', className: 'dsh-scr-btn', onClick: () => { actions.reload(); actions.notify('Reloaded from disk', 'success') } }, h(Icon, { name: 'refresh', size: 14 }), 'Reload from disk'),
        ),

        h('div', { className: 'dsh-scr-field-label', style: { marginTop: 10 } }, 'Projects'),
        h(
          SettingsRow,
          { title: 'Project notebooks', hint: 'Notebooks mirror the Harness project list; the plugin reads that list and never changes it.' },
          h(
            'button',
            { type: 'button', className: 'dsh-scr-btn', disabled: projectState.status === 'loading', onClick: () => actions.syncProjects() },
            h(Icon, { name: 'refresh', size: 14 }),
            projectState.status === 'loading' ? 'Syncing…' : 'Sync now',
          ),
        ),
        h(
          'div',
          { className: 'dsh-scr-field-hint' },
          projectCount + ' project(s) · ' + linkedCount + ' linked · ' + missingCount + ' missing',
          projectState.directory ? ' · ' + projectState.directory : '',
        ),
        projectState.warning ? h('div', { className: 'dsh-scr-field-hint' }, projectState.warning) : null,

        h('div', { className: 'dsh-scr-field-label', style: { marginTop: 10 } }, 'Maintenance'),
        h(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-scr-btn is-danger',
              disabled: trashed === 0,
              onClick: () => {
                if (trashed === 0) return
                actions.emptyTrash()
                actions.notify('Trash emptied', 'success')
              },
            },
            h(Icon, { name: 'trash', size: 14 }),
            'Empty trash (' + trashed + ')',
          ),
        ),
        h(
          'p',
          { className: 'dsh-scr-field-hint', style: { marginTop: 2 } },
          'Scriptorium keeps everything in a single JSON file inside your DSH home. Deleted documents stay in the trash until you empty it.',
        ),
      ),
      h(
        'div',
        { className: 'dsh-scr-modal-foot' },
        h('span', { className: 'dsh-scr-field-hint' }, 'dsh-scriptorium 0.1.0'),
        h('span', { className: 'dsh-scr-spacer', style: { flex: '1 1 auto' } }),
        h('button', { type: 'button', className: 'dsh-scr-btn is-primary', onClick: onClose }, 'Done'),
      ),
    ),
  )
}

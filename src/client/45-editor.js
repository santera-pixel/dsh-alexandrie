// Document editor: title, status, tags, formatting toolbar, split panes and preview.

const EDITOR_MODES = [
  { id: 'write', label: 'Write', icon: 'edit' },
  { id: 'split', label: 'Split', icon: 'columns' },
  { id: 'preview', label: 'Preview', icon: 'eye' },
]

/**
 * Replace the whole textarea value through the browser edit command so the native undo stack
 * survives a toolbar click. Returns false when the command is unavailable or did not take.
 */
function insertIntoTextarea(textarea, result) {
  if (!textarea || result === undefined || result === null) return false
  if (typeof document === 'undefined' || document === null || typeof document.execCommand !== 'function') return false
  try {
    const previous = textarea.value
    const previousStart = textarea.selectionStart
    const previousEnd = textarea.selectionEnd
    textarea.focus()
    textarea.setSelectionRange(0, previous.length)
    const replaced = document.execCommand('insertText', false, result.value)
    if (replaced !== true || textarea.value !== result.value) {
      textarea.value = previous
      textarea.setSelectionRange(previousStart, previousEnd)
      return false
    }
    return true
  } catch (error) {
    return false
  }
}

/** Wrap the current selection (or insert a placeholder) and keep the caret sensible. */
function applyWrap(textarea, before, after, placeholder) {
  if (!textarea) return null
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const value = textarea.value
  const selected = value.slice(start, end) || placeholder || ''
  const next = value.slice(0, start) + before + selected + after + value.slice(end)
  const caret = start + before.length + selected.length
  return { value: next, selectionStart: start + before.length, selectionEnd: caret }
}

/** Prefix every line touched by the selection; a second click on the same style removes it. */
function applyLinePrefix(textarea, prefix, ordered) {
  if (!textarea) return null
  const value = textarea.value
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const lineStart = value.lastIndexOf('\n', start - 1) + 1
  const lineEnd = value.indexOf('\n', end)
  const stop = lineEnd < 0 ? value.length : lineEnd
  const block = value.slice(lineStart, stop)
  const lines = block.split('\n')
  const task = /[-*+]\s+\[[ xX]\]\s/.test(prefix)
  const quote = /^\s*>\s*$/.test(prefix) || prefix.trim() === '>'
  const MARKER = /^(\s*)(?:>\s*|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/
  const isOrdered = (line) => /^\s*\d+[.)]\s+/.test(line)
  const isTask = (line) => /^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)
  const isBullet = (line) => /^\s*[-*+]\s+/.test(line)
  const isQuoted = (line) => /^\s*>\s+/.test(line)
  const styled = (line) => (task ? isTask(line) : ordered ? isOrdered(line) : quote ? isQuoted(line) : isBullet(line))
  const strip = (line) => line.replace(MARKER, '$1')
  const already = lines.every((line) => line.trim() === '' || styled(line))
  const nextBlock = lines
    .map((line, index) => {
      if (line.trim() === '') return line
      const indent = (/^\s*/.exec(line) || [''])[0]
      const body = strip(line).slice(indent.length)
      if (task) return isTask(line) ? line : indent + '- [ ] ' + body
      if (already) return indent + body
      const bullet = ordered ? String(index + 1) + '. ' : prefix
      return indent + bullet + body
    })
    .join('\n')
  return { value: value.slice(0, lineStart) + nextBlock + value.slice(stop), selectionStart: lineStart, selectionEnd: lineStart + nextBlock.length }
}
function TagEditor({ node, onAdd, onRemove }) {
  const [draft, setDraft] = React.useState('')
  const tags = Array.isArray(node.tags) ? node.tags : []
  const commit = () => {
    const value = draft.trim().replace(/^#/, '')
    setDraft('')
    if (value !== '') onAdd(value)
  }
  return h(
    'div',
    { className: 'dsh-scr-chip-wrap', style: { alignItems: 'center' } },
    tags.map((tag) => {
      const hue = model.tagHue(tag)
      return h(
        'span',
        {
          key: tag,
          className: 'dsh-scr-chip',
          style: { background: `hsla(${hue}, 65%, 55%, 0.16)`, color: `hsl(${hue}, 62%, 62%)` },
        },
        '#' + tag,
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-scr-chip-x',
            title: 'Remove tag',
            onClick: () => onRemove(tag),
          },
          '×',
        ),
      )
    }),
    h('input', {
      className: 'dsh-scr-input',
      style: { width: 108, padding: '2px 8px', fontSize: 11.5, borderRadius: 999 },
      placeholder: '+ tag',
      value: draft,
      onChange: (event) => setDraft(event.target.value),
      onBlur: commit,
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
        }
      },
    }),
  )
}

function EditorToolbar({ textareaRef, onApply, onSave }) {
  const run = (builder) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const result = builder(textarea)
    if (result) onApply(result)
  }
  const insert = (text, selectOffset) => () =>
    run((textarea) => {
      const start = textarea.selectionStart
      const value = textarea.value
      return {
        value: value.slice(0, start) + text + value.slice(textarea.selectionEnd),
        selectionStart: start + (selectOffset === undefined ? text.length : selectOffset),
        selectionEnd: start + (selectOffset === undefined ? text.length : selectOffset),
      }
    })

  const button = (icon, label, action) => h(IconButton, { icon, label, onClick: action, className: 'dsh-scr-tool-btn' })
  const sep = () => h('span', { key: 'sep' + Math.random(), className: 'dsh-scr-toolbar-sep' })

  return h(
    'div',
    { className: 'dsh-scr-toolbar' },
    h(
      'div',
      { className: 'dsh-scr-toolbar-group' },
      button('heading', 'Heading', insert('## ')),
      button('bold', 'Bold (Ctrl+B)', () => run((el) => applyWrap(el, '**', '**', 'bold text'))),
      button('italic', 'Italic (Ctrl+I)', () => run((el) => applyWrap(el, '*', '*', 'italic text'))),
      button('strike', 'Strikethrough', () => run((el) => applyWrap(el, '~~', '~~', 'text'))),
      button('code', 'Inline code', () => run((el) => applyWrap(el, '`', '`', 'code'))),
      button('code', 'Code block', insert('\n```js\nconst answer = 42\n```\n')),
    ),
    sep(),
    h(
      'div',
      { className: 'dsh-scr-toolbar-group' },
      button('listUl', 'Bullet list', () => run((el) => applyLinePrefix(el, '- ', false))),
      button('listOl', 'Numbered list', () => run((el) => applyLinePrefix(el, '1. ', true))),
      button('check', 'Task list', () => run((el) => applyLinePrefix(el, '- [ ] ', false))),
      button('quote', 'Quote', () => run((el) => applyLinePrefix(el, '> ', false))),
    ),
    sep(),
    h(
      'div',
      { className: 'dsh-scr-toolbar-group' },
      button('link', 'Link', insert('[label](https://)', 7)),
      button('image', 'Image', insert('![alt](https://)', 6)),
      button('table', 'Table', insert('\n| Column | Column |\n| --- | --- |\n| Cell | Cell |\n')),
      button('hr', 'Divider', insert('\n\n---\n\n')),
      button('sparkles', 'Callout', insert('\n::: note\nA short note.\n:::\n')),
    ),
    h('span', { className: 'dsh-scr-spacer' }),
    h(IconButton, { icon: 'save', label: 'Save now (Ctrl+S)', onClick: onSave, className: 'dsh-scr-tool-btn' }),
  )
}

function DocumentEditor({ store, snapshot, node, ui, actions }) {
  const settings = snapshot.settings || {}
  const mode = settings.editorMode || 'split'
  const [title, setTitle] = React.useState(node.title)
  const [content, setContent] = React.useState(node.content || '')
  const textareaRef = React.useRef(null)
  const previewRef = React.useRef(null)
  const pendingRef = React.useRef(null)
  const currentIdRef = React.useRef(node.id)

  const flush = React.useRef(() => {})
  flush.current = () => {
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending === null) return
    actions.setContent(pending.nodeId, pending.content)
  }

  const scheduleFlush = React.useMemo(
    () =>
      debounce(() => {
        flush.current()
      }, 420),
    [],
  )

  React.useEffect(() => {
    return () => {
      scheduleFlush.cancel()
      flush.current()
    }
  }, [node.id])

  const resetTokenRef = React.useRef(store.state.resetToken || 0)

  React.useEffect(() => {
    const token = store.state.resetToken || 0
    const tokenChanged = token !== resetTokenRef.current
    const nodeChanged = currentIdRef.current !== node.id
    if (!tokenChanged && !nodeChanged) return
    scheduleFlush.cancel()
    if (tokenChanged) {
      // The store took the host copy; the keystrokes it had not flushed are what Reload drops.
      pendingRef.current = null
    } else {
      flush.current()
    }
    resetTokenRef.current = token
    currentIdRef.current = node.id
    setTitle(node.title)
    setContent(node.content || '')
  }, [node.id, node.title, node.content, store.state.resetToken])

  const stageContent = (value) => {
    setContent(value)
    pendingRef.current = { nodeId: node.id, content: value }
    scheduleFlush()
  }

  const applyResult = (result) => {
    const textarea = textareaRef.current
    if (textarea !== null && insertIntoTextarea(textarea, result)) {
      textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
      return
    }
    stageContent(result.value)
    requestAnimationFrame(() => {
      const target = textareaRef.current
      if (target === null) return
      target.focus()
      target.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  const toggleTask = (lineIndex, checked) => {
    stageContent(toggleTaskLine(content, lineIndex, checked))
  }

  const onTextareaKeyDown = (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase()
      const textarea = event.currentTarget
      if (key === 'b') {
        event.preventDefault()
        applyResult(applyWrap(textarea, '**', '**', 'bold text'))
      } else if (key === 'i') {
        event.preventDefault()
        applyResult(applyWrap(textarea, '*', '*', 'italic text'))
      } else if (key === 's') {
        event.preventDefault()
        flush.current()
        actions.saveNow()
      }
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const textarea = event.currentTarget
      const start = textarea.selectionStart
      const value = textarea.value
      applyResult({ value: value.slice(0, start) + '  ' + value.slice(textarea.selectionEnd), selectionStart: start + 2, selectionEnd: start + 2 })
    }
  }

  const syncScroll = (event) => {
    if (mode !== 'split' || previewRef.current === null) return
    const source = event.currentTarget
    const ratio = source.scrollTop / Math.max(1, source.scrollHeight - source.clientHeight)
    const preview = previewRef.current
    preview.scrollTop = ratio * Math.max(0, preview.scrollHeight - preview.clientHeight)
  }

  const stats = markdownStats(content)
  const trail = model.nodeTrail(snapshot, node.id).slice(0, -1)

  return h(
    'div',
    { className: 'dsh-scr-editor dsh-scr-view' },
    h(
      'div',
      { className: 'dsh-scr-doc-head' },
      h('input', {
        className: 'dsh-scr-doc-title',
        value: title,
        'aria-label': 'Document title',
        onChange: (event) => setTitle(event.target.value),
        onBlur: () => {
          const next = title.trim()
          if (next !== '' && next !== node.title) actions.renameNode(node.id, next)
          else setTitle(node.title)
        },
        onKeyDown: (event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
            textareaRef.current && textareaRef.current.focus()
          }
        },
      }),
      h(
        'div',
        { className: 'dsh-scr-doc-meta' },
        trail.length > 0
          ? h(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              trail.map((parent, index) =>
                h('span', { key: parent.id, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                  index > 0 ? h('span', { className: 'dsh-scr-doc-meta-sep' }, '/') : null,
                  h(Icon, { name: parent.icon || 'folder', size: 12 }),
                  parent.title,
                ),
              ),
              h('span', { className: 'dsh-scr-doc-meta-sep' }, '/'),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-scr-status-pill',
            title: 'Cycle status',
            style: { color: model.statusTokenOf(node.status) },
            onClick: () => {
              const order = model.STATUS_ORDER
              const index = order.indexOf(node.status)
              actions.setStatus(node.id, order[(index + 1) % order.length])
            },
          },
          h('span', { className: 'dsh-scr-status-dot' }),
          model.statusLabelOf(node.status),
        ),
        h('span', { className: 'dsh-scr-doc-meta-sep' }, '·'),
        h('span', null, 'Edited ' + model.relativeTime(node.updatedAt)),
        h('span', { className: 'dsh-scr-doc-meta-sep' }, '·'),
        h('span', null, stats.words + ' words'),
        h('span', { className: 'dsh-scr-doc-meta-sep' }, '·'),
        h('span', null, stats.minutes + ' min read'),
        h('span', { className: 'dsh-scr-spacer', style: { flex: '1 1 auto' } }),
        h('span', { className: 'dsh-scr-seg' },
          EDITOR_MODES.map((entry) =>
            h(
              'button',
              {
                key: entry.id,
                type: 'button',
                className: cx('dsh-scr-seg-btn', mode === entry.id && 'is-active'),
                onClick: () => actions.patchSettings({ editorMode: entry.id }),
              },
              h(Icon, { name: entry.icon, size: 12 }),
              entry.label,
            ),
          ),
        ),
        h(IconButton, {
          icon: 'star',
          label: node.favorite ? 'Remove from favourites' : 'Add to favourites',
          active: node.favorite === true,
          onClick: () => actions.toggleFavorite(node.id),
        }),
        h(IconButton, { icon: 'download', label: 'Download as Markdown', onClick: () => actions.exportDocument(node.id) }),
        h(IconButton, { icon: 'trash', label: 'Move to trash', danger: true, onClick: () => actions.trashNode(node.id) }),
      ),
      h(
        'div',
        { className: 'dsh-scr-doc-meta' },
        h(TagEditor, {
          node,
          onAdd: (tag) => actions.addTag(node.id, tag),
          onRemove: (tag) => actions.removeTag(node.id, tag),
        }),
        h('span', { className: 'dsh-scr-spacer', style: { flex: '1 1 auto' } }),
        h(
          'span',
          { className: 'dsh-scr-save-state' },
          h('span', {
            className: cx(
              'dsh-scr-save-dot',
              store.state.saveState === 'saving' && 'is-saving',
              store.state.saveState === 'saved' && 'is-saved',
              store.state.saveState === 'error' && 'is-error',
              store.state.saveState === 'conflict' && 'is-error',
            ),
          }),
          store.state.saveState === 'conflict'
            ? 'Unsaved - resolve conflict'
            : store.state.saveState === 'saving'
              ? 'Saving…'
              : store.state.saveState === 'error'
                ? 'Save failed'
                : 'Saved ' + model.relativeTime(store.state.updatedAt),
        ),
      ),
    ),
    h(EditorToolbar, {
      textareaRef,
      onApply: applyResult,
      onSave: () => {
        flush.current()
        actions.saveNow()
      },
    }),
    h(
      'div',
      { className: 'dsh-scr-panes' },
      mode !== 'preview'
        ? h(
            'div',
            { className: cx('dsh-scr-pane', mode === 'split' ? 'is-edit' : 'is-full') },
            mode === 'split' ? h('div', { className: 'dsh-scr-pane-label' }, 'Markdown') : null,
            h('textarea', {
              ref: textareaRef,
              className: 'dsh-scr-textarea',
              value: content,
              spellCheck: true,
              placeholder: 'Start writing in Markdown…',
              style: { fontSize: (settings.fontSize || 15) + 'px' },
              onChange: (event) => stageContent(event.target.value),
              onKeyDown: onTextareaKeyDown,
              onScroll: syncScroll,
              onBlur: () => flush.current(),
            }),
          )
        : null,
      mode !== 'write'
        ? h(
            'div',
            { className: cx('dsh-scr-pane', mode === 'split' ? 'is-full' : 'is-full') },
            mode === 'split' ? h('div', { className: 'dsh-scr-pane-label' }, 'Preview') : null,
            h(
              'div',
              { ref: previewRef, className: 'dsh-scr-preview', style: { '--scr-md-size': (settings.fontSize || 15) + 'px' } },
              h('div', { className: 'dsh-scr-md' }, renderMarkdown(content, { onToggleTask: toggleTask })),
            ),
          )
        : null,
    ),
    h(
      'section',
      { className: 'dsh-scr-editor-media' },
      h(
        'div',
        { className: 'dsh-scr-editor-mediahead' },
        h('span', { className: 'dsh-scr-editor-mediatitle' }, 'Attachments'),
        h('span', { className: 'dsh-scr-attach-count' }, model.mediaOf(node).length + ' file(s)'),
        actions.busy === 'media' ? h('span', { className: 'dsh-scr-attach-busy' }, 'Uploading…') : null,
      ),
      h(MediaGrid, {
        items: model.mediaOf(node),
        emptyHint: 'Attach an image, PDF, audio or video file — previews open right inside the editor.',
        onUpload: (files) => actions.uploadMedia(node.id, files),
        onPreview: (media) => actions.openPreview(media),
        onRemove: (media) => actions.removeMedia(node.id, media.id),
      }),
    ),
  )
}

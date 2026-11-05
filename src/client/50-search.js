// Search: ranking over the snapshot, the full search overlay, and the Ctrl+K command palette.
// Concatenated into the bundle factory scope (no imports/exports/JSX); `h`, `React`, `cx`,
// `model` helpers and `CSS_CHUNKS` come from the sibling files above this one.

const AXL_SEARCH_LIMIT = 50
const AXL_SEARCH_RECENT = 8
const AXL_SEARCH_EXCERPT_RADIUS = 120

/** Markdown-stripped plain text when the sibling helper exists, raw content otherwise. */
function axlSearchPlainText(value) {
  const text = String(value === undefined || value === null ? '' : value)
  if (typeof markdownPlainText === 'function') {
    try {
      const plain = markdownPlainText(text)
      if (typeof plain === 'string') return plain
    } catch (error) {
      console.warn('[dsh-alexandrie] markdownPlainText failed, falling back to raw content', error)
    }
  }
  return text
}

/** Sort key: numeric updatedAt, invalid/missing dates sort last. */
function axlSearchStampOf(node) {
  const parsed = Date.parse(String((node && node.updatedAt) || ''))
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Content weight: bounded so body hits can never outrank a title hit. */
function axlSearchContentWeight(body, needle) {
  const haystack = String(body === undefined || body === null ? '' : body).toLowerCase()
  const lowerNeedle = String(needle || '').toLowerCase()
  if (haystack === '' || lowerNeedle === '') return 0
  const first = haystack.indexOf(lowerNeedle)
  if (first < 0) return 0
  let hits = 0
  let cursor = 0
  while (hits < 12) {
    const found = haystack.indexOf(lowerNeedle, cursor)
    if (found < 0) break
    hits += 1
    cursor = found + lowerNeedle.length
  }
  return 40 + Math.min(60, hits * 12) - Math.min(20, Math.floor(first / 40))
}

/** Highlight segments -> spans; hit spans carry the shared highlight class. */
function axlSearchSegments(segments) {
  const list = Array.isArray(segments) ? segments : []
  return list.map((segment, index) =>
    segment.hit === true
      ? h('span', { key: 'hit-' + index, className: 'dsh-axl-search-hit' }, segment.text)
      : h('span', { key: 'plain-' + index }, segment.text),
  )
}

/** Search every live document; blank query means "most recently updated". */
function searchDocuments(snapshot, query, options) {
  const opts = options || {}
  const source = snapshot && Array.isArray(snapshot.nodes) ? snapshot.nodes : []
  const needle = String(query === undefined || query === null ? '' : query).trim()
  const includeTrashed = opts.includeTrashed === true
  const workspaceId = opts.workspaceId === undefined || opts.workspaceId === null ? null : String(opts.workspaceId)
  const requested = Number(opts.limit)
  const limit = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : AXL_SEARCH_LIMIT

  const pool = source.filter((node) => {
    if (node === null || typeof node !== 'object') return false
    if (node.kind === 'folder') return false
    if (includeTrashed !== true && node.trashed === true) return false
    if (workspaceId !== null && String(node.workspaceId) !== workspaceId) return false
    return true
  })

  if (needle === '') {
    const recent = pool
      .slice()
      .sort((left, right) => axlSearchStampOf(right) - axlSearchStampOf(left))
      .slice(0, Math.min(AXL_SEARCH_RECENT, limit))
    return recent.map((node) => ({
      node,
      score: 0,
      titleSegments: matchSegments(node.title, ''),
      excerptSegments: matchSegments(excerptFor(axlSearchPlainText(node.content), '', AXL_SEARCH_EXCERPT_RADIUS), ''),
    }))
  }

  const scored = []
  for (const node of pool) {
    const titleScore = fuzzyScore(needle, node.title)
    let tagScore = null
    if (Array.isArray(node.tags)) {
      for (const tag of node.tags) {
        const value = fuzzyScore(needle, tag)
        if (value !== null && (tagScore === null || value > tagScore)) tagScore = value
      }
    }
    const body = axlSearchPlainText(node.content)
    const contentScore = axlSearchContentWeight(body, needle)
    if (titleScore === null && tagScore === null && contentScore === 0) continue
    scored.push({
      node,
      score: (titleScore || 0) * 3 + (tagScore || 0) * 2 + contentScore,
      titleSegments: matchSegments(node.title, needle),
      excerptSegments: matchSegments(excerptFor(body, needle, AXL_SEARCH_EXCERPT_RADIUS), needle),
    })
  }

  scored.sort(
    (left, right) => right.score - left.score || axlSearchStampOf(right.node) - axlSearchStampOf(left.node),
  )
  return scored.slice(0, limit)
}

/** Wrap-around cursor movement shared by both lists. */
function axlSearchStep(index, delta, length) {
  if (length <= 0) return 0
  const base = Math.min(Math.max(index, 0), length - 1)
  return ((base + delta) % length + length) % length
}

function SearchOverlay(props) {
  const input = props || {}
  const snapshot = input.snapshot
  const query = input.query === undefined || input.query === null ? '' : String(input.query)
  const workspaceId = input.workspaceId === undefined ? undefined : input.workspaceId
  const onQueryChange = typeof input.onQueryChange === 'function' ? input.onQueryChange : () => {}
  const onPick = typeof input.onPick === 'function' ? input.onPick : () => {}
  const onClose = typeof input.onClose === 'function' ? input.onClose : () => {}

  const fieldRef = React.useRef(null)
  const listRef = React.useRef(null)
  const selectedState = React.useState(0)
  const selected = selectedState[0]
  const setSelected = selectedState[1]

  const trimmed = query.trim()
  const hasQuery = trimmed !== ''

  const results = React.useMemo(
    () => searchDocuments(snapshot, trimmed, { workspaceId }),
    [snapshot, trimmed, workspaceId],
  )

  const count = results.length
  const activeIndex = count === 0 ? -1 : Math.min(selected, count - 1)

  React.useEffect(() => {
    const field = fieldRef.current
    if (field === null || field === undefined) return
    field.focus()
  }, [])

  React.useEffect(() => {
    setSelected(0)
  }, [trimmed, workspaceId])

  React.useEffect(() => {
    const list = listRef.current
    if (list === null || list === undefined) return
    const row = list.querySelector('[data-index="' + activeIndex + '"]')
    if (row === null || row === undefined) return
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, count])

  const pickAt = (index) => {
    const result = results[index]
    if (result === undefined) return
    onPick(result.node, result)
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected(axlSearchStep(activeIndex, 1, count))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected(axlSearchStep(activeIndex, -1, count))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0) pickAt(activeIndex)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  const renderRow = (result, index) => {
    const node = result.node
    const workspace = workspaceById(snapshot, node.workspaceId)
    const tags = Array.isArray(node.tags) ? node.tags.slice(0, 4) : []
    const excerptText = result.excerptSegments
      .map((segment) => segment.text)
      .join('')
      .trim()
    return h(
      'div',
      {
        key: node.id,
        id: 'dsh-axl-search-row-' + index,
        className: 'dsh-axl-search-row',
        role: 'option',
        'aria-selected': index === activeIndex ? 'true' : 'false',
        'data-index': index,
        'data-selected': index === activeIndex ? 'true' : 'false',
        style: { animationDelay: Math.min(index, 12) * 12 + 'ms' },
        onMouseDown: (event) => event.preventDefault(),
        onMouseEnter: () => setSelected(index),
        onClick: () => pickAt(index),
      },
      h(
        'div',
        { className: 'dsh-axl-search-rowtop' },
        h('span', { className: 'dsh-axl-search-rowtitle' }, axlSearchSegments(result.titleSegments)),
        h('span', { className: 'dsh-axl-search-rowtime' }, relativeTime(node.updatedAt)),
      ),
      h(
        'div',
        { className: 'dsh-axl-search-rowmeta' },
        tags.map((tag) =>
          h('span', { key: 'tag:' + tag, className: 'dsh-axl-search-tag' }, '#' + tag),
        ),
        h(
          'span',
          { className: 'dsh-axl-search-ws' },
          workspace === null || workspace === undefined ? 'Unknown workspace' : workspace.name,
        ),
      ),
      excerptText === ''
        ? h('div', { className: 'dsh-axl-search-excerpt dsh-axl-search-excerpt-empty' }, 'No content yet')
        : h('div', { className: 'dsh-axl-search-excerpt' }, axlSearchSegments(result.excerptSegments)),
    )
  }

  const renderEmpty = () =>
    h(
      'div',
      { className: 'dsh-axl-search-empty' },
      h('span', { className: 'dsh-axl-search-emptytitle' }, 'No documents match “' + trimmed + '”'),
      h(
        'span',
        { className: 'dsh-axl-search-emptysub' },
        'Try a shorter word, a tag name, or another workspace.',
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'dsh-axl-search-clear',
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => onQueryChange(''),
        },
        'Clear search',
      ),
    )

  return h(
    'div',
    {
      className: 'dsh-axl-search-panel',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Search documents',
      onKeyDown,
    },
    h(
      'div',
      { className: 'dsh-axl-search-head' },
      h('span', { className: 'dsh-axl-search-glyph', 'aria-hidden': 'true' }, '⌕'),
      h('input', {
        ref: fieldRef,
        className: 'dsh-axl-search-input',
        type: 'text',
        value: query,
        placeholder: 'Search titles, tags and content…',
        autoComplete: 'off',
        spellCheck: false,
        'aria-label': 'Search query',
        onChange: (event) => onQueryChange(event.target.value),
      }),
      h(
        'span',
        { className: 'dsh-axl-search-count' },
        hasQuery
          ? count === 1
            ? '1 result'
            : count + ' results'
          : count === 1
            ? '1 recent'
            : count + ' recent',
      ),
      h(
        'button',
        { type: 'button', className: 'dsh-axl-search-close', onClick: onClose, 'aria-label': 'Close search' },
        'esc',
      ),
    ),
    hasQuery
      ? null
      : h(
          'div',
          { className: 'dsh-axl-search-hint' },
          h('span', { className: 'dsh-axl-search-hinttitle' }, 'Search across every workspace'),
          h(
            'span',
            { className: 'dsh-axl-search-hintsub' },
            'Matches titles, tags and body text — pass a workspace to narrow it down.',
          ),
        ),
    hasQuery
      ? null
      : count === 0
        ? null
        : h('div', { className: 'dsh-axl-search-section' }, 'Recent documents'),
    h(
      'div',
      {
        ref: listRef,
        className: 'dsh-axl-search-body',
        role: 'listbox',
        'aria-label': 'Search results',
        'aria-activedescendant': activeIndex >= 0 ? 'dsh-axl-search-row-' + activeIndex : undefined,
      },
      count === 0 ? (hasQuery ? renderEmpty() : h('div', { className: 'dsh-axl-search-empty' }, h('span', { className: 'dsh-axl-search-emptysub' }, 'No documents yet — create one to see it here.'))) : results.map(renderRow),
    ),
    h(
      'div',
      { className: 'dsh-axl-search-foot' },
      h('span', null, '↑↓ navigate · ↵ open · esc close'),
      h('span', { className: 'dsh-axl-search-footnote' }, hasQuery ? 'ranked by title, tags, content' : 'by last edit'),
    ),
  )
}

/** Filter + rank palette commands; matches title (×2) and hint (×1). */
const AXL_PALETTE_RECENT = []
const AXL_PALETTE_RECENT_MAX = 5

/** Remember a command id so the palette can float recently used entries to the top. */
function axlPaletteTouch(commandId) {
  if (commandId === undefined || commandId === null) return
  const id = String(commandId)
  if (id === '') return
  const at = AXL_PALETTE_RECENT.indexOf(id)
  if (at >= 0) AXL_PALETTE_RECENT.splice(at, 1)
  AXL_PALETTE_RECENT.unshift(id)
  if (AXL_PALETTE_RECENT.length > AXL_PALETTE_RECENT_MAX) AXL_PALETTE_RECENT.length = AXL_PALETTE_RECENT_MAX
}

function axlPaletteFilter(commands, query) {
  const needle = String(query === undefined || query === null ? '' : query).trim()
  const scored = []
  commands.forEach((command, order) => {
    if (command === null || typeof command !== 'object') return
    const title = String(command.title === undefined || command.title === null ? '' : command.title)
    const hint = String(command.hint === undefined || command.hint === null ? '' : command.hint)
    const recentRank = AXL_PALETTE_RECENT.indexOf(String(command.id === undefined || command.id === null ? '' : command.id))
    const recentBoost = recentRank < 0 ? 0 : (AXL_PALETTE_RECENT_MAX - recentRank) * 4
    if (needle === '') {
      scored.push({ command, score: recentBoost, order })
      return
    }
    const titleScore = fuzzyScore(needle, title)
    const hintScore = fuzzyScore(needle, hint)
    if (titleScore === null && hintScore === null) return
    scored.push({ command, score: (titleScore || 0) * 2 + (hintScore || 0) + recentBoost, order })
  })
  scored.sort((left, right) => right.score - left.score || left.order - right.order)
  return scored.map((entry) => entry.command)
}

/** Group in visual order and stamp each row with its keyboard index. */
function axlPaletteGroups(commands) {
  const names = []
  const buckets = new Map()
  for (const command of commands) {
    const raw = command.group === undefined || command.group === null ? '' : String(command.group).trim()
    const name = raw === '' ? 'Commands' : raw
    if (!buckets.has(name)) {
      buckets.set(name, [])
      names.push(name)
    }
    buckets.get(name).push(command)
  }
  const groups = []
  let cursor = 0
  for (const name of names) {
    const items = buckets.get(name).map((command) => {
      const entry = { command, index: cursor }
      cursor += 1
      return entry
    })
    groups.push({ name, items })
  }
  return groups
}

function axlPaletteIcon(icon) {
  if (icon === undefined || icon === null || icon === false) return null
  if (typeof icon === 'string') {
    return h('span', { className: 'dsh-axl-palette-icon', 'aria-hidden': 'true' }, icon)
  }
  if (typeof icon === 'function') {
    return h('span', { className: 'dsh-axl-palette-icon', 'aria-hidden': 'true' }, h(icon, { size: 15 }))
  }
  return h('span', { className: 'dsh-axl-palette-icon', 'aria-hidden': 'true' }, icon)
}

function CommandPalette(props) {
  const input = props || {}
  const commands = Array.isArray(input.commands) ? input.commands : []
  const onClose = typeof input.onClose === 'function' ? input.onClose : () => {}

  const fieldRef = React.useRef(null)
  const listRef = React.useRef(null)
  const queryState = React.useState('')
  const query = queryState[0]
  const setQuery = queryState[1]
  const selectedState = React.useState(0)
  const selected = selectedState[0]
  const setSelected = selectedState[1]

  const filtered = React.useMemo(() => axlPaletteFilter(commands, query), [commands, query])
  const groups = React.useMemo(() => axlPaletteGroups(filtered), [filtered])
  const count = filtered.length
  const activeIndex = count === 0 ? -1 : Math.min(selected, count - 1)
  const trimmed = query.trim()

  React.useEffect(() => {
    const field = fieldRef.current
    if (field === null || field === undefined) return
    field.focus()
  }, [])

  React.useEffect(() => {
    setSelected(0)
  }, [trimmed])

  React.useEffect(() => {
    const list = listRef.current
    if (list === null || list === undefined) return
    const row = list.querySelector('[data-index="' + activeIndex + '"]')
    if (row === null || row === undefined) return
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, count])

  const runAt = (index) => {
    const command = filtered[index]
    if (command === undefined) return
    axlPaletteTouch(command.id)
    try {
      if (typeof command.run === 'function') command.run()
    } catch (error) {
      console.error('[dsh-alexandrie] command failed', error)
    } finally {
      onClose()
    }
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected(axlSearchStep(activeIndex, 1, count))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected(axlSearchStep(activeIndex, -1, count))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (activeIndex >= 0) runAt(activeIndex)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }

  return h(
    'div',
    {
      className: 'dsh-axl-palette-backdrop',
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose()
      },
    },
    h(
      'div',
      {
        className: 'dsh-axl-palette-card',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Command palette',
        onKeyDown,
        onMouseDown: (event) => event.stopPropagation(),
      },
      h(
        'div',
        { className: 'dsh-axl-palette-head' },
        h('span', { className: 'dsh-axl-palette-glyph', 'aria-hidden': 'true' }, '⌘'),
        h('input', {
          ref: fieldRef,
          className: 'dsh-axl-palette-input',
          type: 'text',
          value: query,
          placeholder: 'Type a command…',
          autoComplete: 'off',
          spellCheck: false,
          'aria-label': 'Command query',
          onChange: (event) => setQuery(event.target.value),
        }),
        h('span', { className: 'dsh-axl-palette-count' }, count === 1 ? '1' : String(count)),
      ),
      h(
        'div',
        {
          ref: listRef,
          className: 'dsh-axl-palette-list',
          role: 'listbox',
          'aria-label': 'Commands',
          'aria-activedescendant': activeIndex >= 0 ? 'dsh-axl-palette-row-' + activeIndex : undefined,
        },
        count === 0
          ? h(
              'div',
              { className: 'dsh-axl-palette-empty' },
              h('span', { className: 'dsh-axl-palette-emptytitle' }, 'No matching command'),
              trimmed === ''
                ? null
                : h('span', { className: 'dsh-axl-palette-emptysub' }, 'Nothing answers “' + trimmed + '”.'),
            )
          : groups.map((group) =>
              h(
                'div',
                { key: 'group:' + group.name, className: 'dsh-axl-palette-group', role: 'presentation' },
                h('div', { className: 'dsh-axl-palette-grouplabel' }, group.name),
                group.items.map((entry) => {
                  const command = entry.command
                  const isActive = entry.index === activeIndex
                  return h(
                    'div',
                    {
                      key: String(command.id === undefined ? group.name + ':' + entry.index : command.id),
                      id: 'dsh-axl-palette-row-' + entry.index,
                      className: 'dsh-axl-palette-row',
                      role: 'option',
                      'aria-selected': isActive ? 'true' : 'false',
                      'data-index': entry.index,
                      'data-selected': isActive ? 'true' : 'false',
                      onMouseDown: (event) => event.preventDefault(),
                      onMouseEnter: () => setSelected(entry.index),
                      onClick: () => runAt(entry.index),
                    },
                    axlPaletteIcon(command.icon),
                    h(
                      'span',
                      { className: 'dsh-axl-palette-rowmain' },
                      h(
                        'span',
                        { className: 'dsh-axl-palette-title' },
                        axlSearchSegments(matchSegments(command.title, trimmed)),
                      ),
                      command.hint === undefined || command.hint === null || String(command.hint) === ''
                        ? null
                        : h('span', { className: 'dsh-axl-palette-hint' }, String(command.hint)),
                    ),
                  )
                }),
              ),
            ),
      ),
      h(
        'div',
        { className: 'dsh-axl-palette-foot' },
        h('span', null, '↑↓ navigate · ↵ run · esc close'),
      ),
    ),
  )
}

const SEARCH_CSS = `
/* ---- dsh-alexandrie search overlay + command palette ---- */
.dsh-axl-search-panel { display:flex; flex-direction:column; width:min(760px,100%); max-height:min(78vh,720px); margin:0 auto; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2); border-radius:16px; overflow:hidden; box-shadow:0 24px 64px -28px color-mix(in srgb, var(--dsw-alias-bg-overlay) 72%, transparent); animation:dsh-axl-search-rise .16s ease-out both; }
.dsh-axl-search-panel:focus-within { border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, var(--dsw-alias-border-l2)); }
.dsh-axl-search-head { display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.dsh-axl-search-glyph { font-size:18px; line-height:1; color:var(--dsw-alias-label-secondary); }
.dsh-axl-search-input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:17px; letter-spacing:.01em; padding:2px 0; }
.dsh-axl-search-input::placeholder { color:var(--dsw-alias-label-secondary); }
.dsh-axl-search-count { font-size:11px; color:var(--dsw-alias-label-secondary); border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:2px 8px; white-space:nowrap; }
.dsh-axl-search-close { font-size:11px; font-family:inherit; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:2px 8px; cursor:pointer; transition:color .15s ease, background-color .15s ease; }
.dsh-axl-search-close:hover { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); }
.dsh-axl-search-hint { display:flex; flex-direction:column; gap:3px; padding:12px 16px 4px; }
.dsh-axl-search-hinttitle { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }
.dsh-axl-search-hintsub { font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsh-axl-search-section { padding:10px 18px 2px; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); }
.dsh-axl-search-body { flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; padding:8px; display:flex; flex-direction:column; gap:2px; }
.dsh-axl-search-row { display:flex; flex-direction:column; gap:5px; padding:10px 12px; border-radius:10px; border:1px solid transparent; cursor:pointer; animation:dsh-axl-search-row-in .2s ease-out both; transition:background-color .18s ease, border-color .18s ease; }
.dsh-axl-search-row[data-selected="true"] { background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-2)); border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent); }
.dsh-axl-search-rowtop { display:flex; align-items:baseline; gap:10px; }
.dsh-axl-search-rowtitle { flex:1; min-width:0; font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-axl-search-rowtime { font-size:11px; color:var(--dsw-alias-label-secondary); white-space:nowrap; }
.dsh-axl-search-rowmeta { display:flex; align-items:center; gap:6px; flex-wrap:wrap; font-size:11px; color:var(--dsw-alias-label-secondary); }
.dsh-axl-search-tag { color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent); border-radius:999px; padding:0 7px; }
.dsh-axl-search-ws { margin-left:auto; opacity:.85; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:45%; }
.dsh-axl-search-excerpt { font-size:12.5px; line-height:1.5; color:var(--dsw-alias-label-secondary); overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.dsh-axl-search-excerpt-empty { font-style:italic; opacity:.7; }
.dsh-axl-search-hit { background:color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); color:var(--dsw-alias-brand-primary); border-radius:4px; padding:0 2px; font-weight:600; }
.dsh-axl-search-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; padding:44px 24px; text-align:center; }
.dsh-axl-search-emptytitle { font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary); }
.dsh-axl-search-emptysub { font-size:12.5px; color:var(--dsw-alias-label-secondary); }
.dsh-axl-search-clear { margin-top:6px; font:inherit; font-size:12px; color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent); border-radius:8px; padding:5px 12px; cursor:pointer; }
.dsh-axl-search-foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 16px; border-top:1px solid var(--dsw-alias-border-l1); font-size:11px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); }
.dsh-axl-search-footnote { opacity:.8; }

.dsh-axl-palette-backdrop { position:fixed; inset:0; z-index:80; display:flex; align-items:flex-start; justify-content:center; padding:14vh 16px 16px; background:color-mix(in srgb, var(--dsw-alias-bg-overlay) 60%, transparent); backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); animation:dsh-axl-palette-fade .14s ease-out both; }
.dsh-axl-palette-card { display:flex; flex-direction:column; width:min(600px,100%); max-height:min(64vh,560px); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border:1px solid var(--dsw-alias-border-l2); border-radius:14px; overflow:hidden; box-shadow:0 30px 72px -32px color-mix(in srgb, var(--dsw-alias-bg-overlay) 82%, transparent); animation:dsh-axl-palette-in .16s ease-out both; }
.dsh-axl-palette-head { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.dsh-axl-palette-glyph { font-size:15px; color:var(--dsw-alias-label-secondary); }
.dsh-axl-palette-input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:15px; padding:2px 0; }
.dsh-axl-palette-input::placeholder { color:var(--dsw-alias-label-secondary); }
.dsh-axl-palette-count { font-size:11px; color:var(--dsw-alias-label-secondary); border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:1px 8px; }
.dsh-axl-palette-list { flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; padding:6px; display:flex; flex-direction:column; gap:2px; }
.dsh-axl-palette-group { display:flex; flex-direction:column; gap:1px; padding-bottom:4px; }
.dsh-axl-palette-grouplabel { padding:8px 10px 4px; font-size:10.5px; letter-spacing:.09em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); }
.dsh-axl-palette-row { display:flex; align-items:center; gap:9px; padding:8px 10px; border-radius:8px; border:1px solid transparent; cursor:pointer; transition:background-color .16s ease, border-color .16s ease; }
.dsh-axl-palette-row[data-selected="true"] { background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, var(--dsw-alias-bg-layer-2)); border-color:color-mix(in srgb, var(--dsw-alias-brand-primary) 32%, transparent); }
.dsh-axl-palette-icon { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:6px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); font-size:13px; flex:none; }
.dsh-axl-palette-row[data-selected="true"] .dsh-axl-palette-icon { color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); }
.dsh-axl-palette-rowmain { display:flex; flex-direction:column; gap:1px; min-width:0; }
.dsh-axl-palette-title { font-size:13.5px; color:var(--dsw-alias-label-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-axl-palette-hint { font-size:11.5px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-axl-palette-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; padding:34px 18px; text-align:center; }
.dsh-axl-palette-emptytitle { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); }
.dsh-axl-palette-emptysub { font-size:12px; color:var(--dsw-alias-label-secondary); }
.dsh-axl-palette-foot { display:flex; justify-content:flex-end; padding:8px 14px; border-top:1px solid var(--dsw-alias-border-l1); font-size:11px; color:var(--dsw-alias-label-secondary); background:var(--dsw-alias-bg-layer-2); }

@keyframes dsh-axl-search-rise { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
@keyframes dsh-axl-search-row-in { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
@keyframes dsh-axl-palette-fade { from { opacity:0; } to { opacity:1; } }
@keyframes dsh-axl-palette-in { from { opacity:0; transform:translateY(-8px) scale(.986); } to { opacity:1; transform:translateY(0) scale(1); } }

@media (prefers-reduced-motion: reduce) {
  .dsh-axl-search-panel,
  .dsh-axl-search-row,
  .dsh-axl-search-close,
  .dsh-axl-palette-backdrop,
  .dsh-axl-palette-card,
  .dsh-axl-palette-row { animation:none !important; transition:none !important; }
}
`

// Registered at top level so the bundle's style injector picks it up. Guarded because the
// array lives in a sibling chunk: if it is absent (or still in its temporal dead zone because
// a sibling declares it later in the concatenation) a `typeof` probe would itself throw, so
// the push is attempted directly and a failure never breaks the bundle.
try {
  CSS_CHUNKS.push(SEARCH_CSS)
} catch (error) {
  console.warn('[dsh-alexandrie] SEARCH_CSS was not added to CSS_CHUNKS', error)
}

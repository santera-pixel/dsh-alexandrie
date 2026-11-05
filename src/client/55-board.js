// Kanban board view: documents grouped into status columns, with HTML5 drag and drop and a
// keyboard/touch move fallback that never depends on dragging.

const BOARD_EMPTY_HINT = 'Nothing here yet — drag a card in'
const BOARD_STAR_PATH = 'M12 3.5l2.65 5.37 5.93.86-4.29 4.18 1.01 5.9L12 17.02l-5.3 2.79 1.01-5.9-4.29-4.18 5.93-.86z'
const BOARD_ARROW_LEFT = ['M14.5 6.5 9 12l5.5 5.5']
const BOARD_ARROW_RIGHT = ['M9.5 6.5 15 12l-5.5 5.5']
const BOARD_ARROW_OPEN = ['M13 5h6v6', 'M19 5l-8 8']

/** Small stroked glyph used by every icon button on the board. */
function boardGlyph(paths, filled) {
  const solid = filled === true
  return h(
    'svg',
    {
      className: 'dsh-scr-board-glyph',
      width: 14,
      height: 14,
      viewBox: '0 0 24 24',
      fill: solid ? 'currentColor' : 'none',
      stroke: 'currentColor',
      strokeWidth: solid ? 1.1 : 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    paths.map((path, index) => h('path', { key: String(index), d: path })),
  )
}

/** Documents written before statuses existed still land in the first column. */
function boardStatusOf(node) {
  return node && STATUS_ORDER.indexOf(node.status) >= 0 ? node.status : STATUS_ORDER[0]
}

/** Favourite first, then most recently updated; the rest keeps a stable order. */
function boardSortCards(nodes) {
  return nodes.slice().sort((left, right) => {
    const favouriteDelta = (right.favorite === true ? 1 : 0) - (left.favorite === true ? 1 : 0)
    if (favouriteDelta !== 0) return favouriteDelta
    const leftTime = Date.parse(left.updatedAt)
    const rightTime = Date.parse(right.updatedAt)
    const leftValue = Number.isNaN(leftTime) ? 0 : leftTime
    const rightValue = Number.isNaN(rightTime) ? 0 : rightTime
    return rightValue - leftValue
  })
}

/** Flat, whitespace-collapsed preview of the note body. */
function boardExcerptOf(node) {
  return excerptFor(typeof node.content === 'string' ? node.content : '', '', 90)
}

function KanbanBoard(props) {
  const store = props && props.store
  const snapshot = props && props.snapshot
  const onOpen = props && props.onOpen
  const workspaceId = props && props.workspaceId

  const [draggedId, setDraggedId] = React.useState(null)
  const [overStatus, setOverStatus] = React.useState(null)
  const draggedRef = React.useRef(null)

  const openNode = (nodeId) => {
    if (typeof onOpen === 'function') onOpen(nodeId)
  }

  const commitStatus = (nodeId, status) => {
    if (store === null || store === undefined || typeof store.commit !== 'function') return
    if (STATUS_ORDER.indexOf(status) < 0) return
    store.commit((draft) => {
      model.setStatus(draft, nodeId, status)
    })
  }

  const toggleFavourite = (nodeId) => {
    if (store === null || store === undefined || typeof store.commit !== 'function') return
    store.commit((draft) => {
      model.toggleFavorite(draft, nodeId)
    })
  }

  const moveBy = (node, delta) => {
    const index = STATUS_ORDER.indexOf(boardStatusOf(node))
    const target = index + delta
    if (index < 0 || target < 0 || target >= STATUS_ORDER.length) return
    commitStatus(node.id, STATUS_ORDER[target])
  }

  const handleDragStart = (node, event) => {
    draggedRef.current = node.id
    setDraggedId(node.id)
    if (!event.dataTransfer) return
    try {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', node.id)
    } catch {
      // Some engines refuse a synthetic payload; the ref keeps the drop working anyway.
    }
  }

  const handleDragEnd = () => {
    draggedRef.current = null
    setDraggedId(null)
    setOverStatus(null)
  }

  const handleDragEnter = (status) => {
    setOverStatus(status)
  }

  const handleDragOver = (status, event) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (overStatus !== status) setOverStatus(status)
  }

  const handleDragLeave = (status, event) => {
    const next = event.relatedTarget
    if (next && typeof next === 'object' && event.currentTarget.contains(next)) return
    setOverStatus((current) => (current === status ? null : current))
  }

  /** Reject ids that are unknown, trashed, not documents or from another workspace. */
  const handleDrop = (status, event) => {
    event.preventDefault()
    let nodeId = ''
    try {
      nodeId = event.dataTransfer ? event.dataTransfer.getData('text/plain') : ''
    } catch {
      nodeId = ''
    }
    if (!nodeId) nodeId = draggedRef.current || ''
    draggedRef.current = null
    setDraggedId(null)
    setOverStatus(null)
    if (!nodeId) return
    const candidate = Array.isArray(snapshot.nodes) ? snapshot.nodes.find((node) => node.id === nodeId) : null
    if (!candidate || candidate.trashed === true || candidate.kind !== 'doc') return
    const scopeId = typeof workspaceId === 'string' && workspaceId !== '' ? workspaceId : null
    if (scopeId !== null && candidate.workspaceId !== scopeId) return
    if (boardStatusOf(candidate) === status) return
    commitStatus(candidate.id, status)
  }

  const handleCardKeyDown = (node, event) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openNode(node.id)
      return
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveBy(node, -1)
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveBy(node, 1)
    }
  }

  if (!snapshot || !Array.isArray(snapshot.nodes)) return null

  const scopeId = typeof workspaceId === 'string' && workspaceId !== '' ? workspaceId : undefined
  const documents = docsOf(snapshot, scopeId)
  const columns = STATUS_ORDER.map((status) => ({
    status,
    cards: boardSortCards(documents.filter((node) => boardStatusOf(node) === status)),
  }))

  const renderCard = (node) => {
    const status = boardStatusOf(node)
    const index = STATUS_ORDER.indexOf(status)
    const title = String(node.title || '').trim() || 'Untitled'
    const excerpt = boardExcerptOf(node)
    const tags = Array.isArray(node.tags)
      ? node.tags.map((tag) => String(tag || '').trim()).filter((tag) => tag !== '')
      : []
    const words = wordCountOf(node.content || '')
    const favourite = node.favorite === true
    const previous = index > 0 ? STATUS_ORDER[index - 1] : null
    const next = index >= 0 && index < STATUS_ORDER.length - 1 ? STATUS_ORDER[index + 1] : null

    return h(
      'article',
      {
        key: node.id,
        className: cx('dsh-scr-board-card', draggedId === node.id && 'is-dragging'),
        draggable: true,
        tabIndex: 0,
        title,
        'data-status': status,
        'aria-label': title + ' — ' + statusLabelOf(status),
        onDragStart: (event) => handleDragStart(node, event),
        onDragEnd: handleDragEnd,
        onClick: () => openNode(node.id),
        onKeyDown: (event) => handleCardKeyDown(node, event),
      },
      h(
        'div',
        { className: 'dsh-scr-board-cardhead' },
        h('h4', { className: 'dsh-scr-board-cardtitle' }, title),
        h(
          'button',
          {
            type: 'button',
            className: cx('dsh-scr-board-iconbtn', 'dsh-scr-board-star', favourite && 'is-on'),
            'aria-pressed': favourite,
            'aria-label': (favourite ? 'Remove from favourites: ' : 'Add to favourites: ') + title,
            title: favourite ? 'Remove from favourites' : 'Add to favourites',
            onClick: (event) => {
              event.stopPropagation()
              toggleFavourite(node.id)
            },
          },
          boardGlyph([BOARD_STAR_PATH], favourite),
        ),
      ),
      h('p', { className: 'dsh-scr-board-excerpt' }, excerpt === '' ? 'No content yet' : excerpt),
      tags.length === 0
        ? null
        : h(
            'div',
            { className: 'dsh-scr-board-tags' },
            tags.map((tag) =>
              h(
                'span',
                {
                  key: tag,
                  className: 'dsh-scr-board-tag',
                  style: { '--dsh-scr-board-hue': tagHue(tag) },
                  title: '#' + tag,
                },
                '#' + tag,
              ),
            ),
          ),
      h(
        'div',
        { className: 'dsh-scr-board-foot' },
        h(
          'div',
          { className: 'dsh-scr-board-meta' },
          h('span', { className: 'dsh-scr-board-words' }, words + (words === 1 ? ' word' : ' words')),
          h('span', { className: 'dsh-scr-board-time', title: String(node.updatedAt || '') }, relativeTime(node.updatedAt)),
        ),
        h(
          'div',
          { className: 'dsh-scr-board-controls' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-scr-board-iconbtn dsh-scr-board-move',
              disabled: previous === null,
              'aria-label': previous === null ? 'Already in the first column' : 'Move to ' + statusLabelOf(previous),
              title: previous === null ? 'Already in the first column' : 'Move to ' + statusLabelOf(previous),
              onClick: (event) => {
                event.stopPropagation()
                moveBy(node, -1)
              },
            },
            boardGlyph(BOARD_ARROW_LEFT),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-scr-board-iconbtn dsh-scr-board-move',
              disabled: next === null,
              'aria-label': next === null ? 'Already in the last column' : 'Move to ' + statusLabelOf(next),
              title: next === null ? 'Already in the last column' : 'Move to ' + statusLabelOf(next),
              onClick: (event) => {
                event.stopPropagation()
                moveBy(node, 1)
              },
            },
            boardGlyph(BOARD_ARROW_RIGHT),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-scr-board-iconbtn dsh-scr-board-open',
              'aria-label': 'Open ' + title,
              title: 'Open',
              onClick: (event) => {
                event.stopPropagation()
                openNode(node.id)
              },
            },
            boardGlyph(BOARD_ARROW_OPEN),
          ),
        ),
      ),
    )
  }

  return h(
    'div',
    { className: 'dsh-scr-board' },
    h(
      'div',
      { className: 'dsh-scr-board-cols' },
      columns.map((column, columnIndex) =>
        h(
          'section',
          {
            key: column.status,
            className: cx('dsh-scr-board-col', overStatus === column.status && 'is-over'),
            style: { '--dsh-scr-board-delay': columnIndex * 40 + 'ms' },
            'aria-label': statusLabelOf(column.status) + ' column',
            onDragEnter: () => handleDragEnter(column.status),
            onDragOver: (event) => handleDragOver(column.status, event),
            onDragLeave: (event) => handleDragLeave(column.status, event),
            onDrop: (event) => handleDrop(column.status, event),
          },
          h(
            'header',
            { className: 'dsh-scr-board-colhead' },
            h('span', {
              className: 'dsh-scr-board-dot',
              style: { background: statusTokenOf(column.status) },
              'aria-hidden': 'true',
            }),
            h('span', { className: 'dsh-scr-board-collabel' }, statusLabelOf(column.status)),
            h(
              'span',
              { className: 'dsh-scr-board-count', 'aria-label': column.cards.length + ' documents' },
              String(column.cards.length),
            ),
          ),
          h(
            'div',
            { className: 'dsh-scr-board-list' },
            column.cards.length === 0
              ? h('p', { key: 'empty', className: 'dsh-scr-board-empty' }, BOARD_EMPTY_HINT)
              : column.cards.map(renderCard),
          ),
        ),
      ),
    ),
  )
}

const BOARD_CSS = `
/* Scriptorium kanban board: three status columns, draggable cards, keyboard move buttons. */
.dsh-scr-board { container-type: inline-size; container-name: dsh-scr-board; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; overflow: auto; padding: 14px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.dsh-scr-board *, .dsh-scr-board *::before, .dsh-scr-board *::after { box-sizing: border-box; }
.dsh-scr-board-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
.dsh-scr-board-col { position: relative; display: flex; flex-direction: column; gap: 10px; min-height: 150px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 70%, var(--dsw-alias-bg-base)); transition: background-color 140ms ease, border-color 140ms ease; animation: dsh-scr-board-col-in 180ms ease backwards; animation-delay: var(--dsh-scr-board-delay, 0ms); }
.dsh-scr-board-col::after { content: ''; position: absolute; inset: -1px; border: 2px dashed var(--dsw-alias-brand-primary); border-radius: 12px; opacity: 0; transition: opacity 120ms ease; pointer-events: none; }
.dsh-scr-board-col.is-over { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-base)); }
.dsh-scr-board-col.is-over::after { opacity: .85; }
.dsh-scr-board-colhead { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
.dsh-scr-board-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; }
.dsh-scr-board-collabel { font-size: 11.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-primary); }
.dsh-scr-board-count { margin-left: auto; min-width: 22px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 11px; font-variant-numeric: tabular-nums; text-align: center; }
.dsh-scr-board-list { display: flex; flex-direction: column; gap: 8px; }
.dsh-scr-board-card { position: relative; display: flex; flex-direction: column; gap: 7px; padding: 10px 10px 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); cursor: grab; transition: transform 140ms ease, box-shadow 160ms ease, border-color 140ms ease, opacity 120ms ease; animation: dsh-scr-board-card-in 160ms ease backwards; }
.dsh-scr-board-card:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, var(--dsw-alias-border-l1)); box-shadow: 0 4px 12px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent); }
.dsh-scr-board-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-scr-board-card.is-dragging { opacity: .45; transform: scale(.995); cursor: grabbing; }
.dsh-scr-board-cardhead { display: flex; align-items: flex-start; gap: 6px; }
.dsh-scr-board-cardtitle { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 13px; font-weight: 600; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.dsh-scr-board-excerpt { margin: 0; font-size: 11.5px; line-height: 1.45; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsh-scr-board-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.dsh-scr-board-tag { max-width: 100%; padding: 1px 6px; border: 1px solid hsl(var(--dsh-scr-board-hue, 220) 55% 50% / .3); border-radius: 999px; background: hsl(var(--dsh-scr-board-hue, 220) 55% 50% / .13); color: color-mix(in srgb, hsl(var(--dsh-scr-board-hue, 220) 55% 50%) 68%, var(--dsw-alias-label-primary)); font-size: 10.5px; line-height: 1.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dsh-scr-board-foot { display: flex; align-items: center; gap: 6px; }
.dsh-scr-board-meta { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 10.5px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsh-scr-board-time { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-scr-board-controls { display: flex; align-items: center; gap: 2px; margin-left: auto; flex: none; }
.dsh-scr-board-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: none; padding: 0; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease; }
.dsh-scr-board-iconbtn:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dsh-scr-board-iconbtn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-scr-board-iconbtn:disabled { opacity: .35; cursor: default; }
.dsh-scr-board-iconbtn:disabled:hover { background: transparent; color: var(--dsw-alias-label-secondary); }
.dsh-scr-board-star.is-on { color: var(--dsw-alias-state-warn-primary); }
.dsh-scr-board-move { opacity: 0; }
.dsh-scr-board-move:disabled { opacity: 0; }
.dsh-scr-board-card:hover .dsh-scr-board-move, .dsh-scr-board-card:focus-within .dsh-scr-board-move { opacity: 1; }
.dsh-scr-board-card:hover .dsh-scr-board-move:disabled, .dsh-scr-board-card:focus-within .dsh-scr-board-move:disabled { opacity: .3; }
.dsh-scr-board-open { color: var(--dsw-alias-brand-primary); }
.dsh-scr-board-glyph { display: block; flex: none; }
.dsh-scr-board-empty { margin: 0; padding: 16px 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 8px; text-align: center; font-size: 11.5px; line-height: 1.5; color: var(--dsw-alias-label-secondary); transition: color 140ms ease; }
.dsh-scr-board-col.is-over .dsh-scr-board-empty { color: var(--dsw-alias-label-primary); }
@container dsh-scr-board (max-width: 900px) {
  .dsh-scr-board-cols { grid-template-columns: minmax(0, 1fr); }
  .dsh-scr-board-col { min-height: 0; }
}
@media (max-width: 900px) {
  .dsh-scr-board-cols { grid-template-columns: minmax(0, 1fr); }
  .dsh-scr-board-col { min-height: 0; }
}
@media (hover: none) {
  .dsh-scr-board-move { opacity: 1; }
  .dsh-scr-board-move:disabled { opacity: .3; }
}
@keyframes dsh-scr-board-col-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes dsh-scr-board-card-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .dsh-scr-board-col, .dsh-scr-board-card { animation: none !important; }
  .dsh-scr-board-col, .dsh-scr-board-col::after, .dsh-scr-board-card, .dsh-scr-board-iconbtn, .dsh-scr-board-move, .dsh-scr-board-empty { transition: none !important; }
  .dsh-scr-board-card:hover { transform: none !important; }
  .dsh-scr-board-card.is-dragging { transform: none !important; }
}
`

CSS_CHUNKS.push(BOARD_CSS)

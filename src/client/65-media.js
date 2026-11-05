// Media sandbox: attachments attached to documents, with in-app previews for
// images, PDFs, audio, video and text, plus a library view across the whole archive.

/** Extension to MIME table for the formats the sandbox previews. */
const MEDIA_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json', csv: 'text/csv',
  html: 'text/html', css: 'text/css', js: 'text/javascript', ts: 'text/plain', yml: 'text/plain', yaml: 'text/plain',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
  aac: 'audio/aac', opus: 'audio/opus', weba: 'audio/webm',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  ogv: 'video/ogg', m4v: 'video/mp4',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
}

const MEDIA_KIND_BY_MIME = [
  ['image/', 'image'],
  ['application/pdf', 'pdf'],
  ['audio/', 'audio'],
  ['video/', 'video'],
  ['text/', 'text'],
  ['application/json', 'text'],
  ['application/xml', 'text'],
  ['+json', 'text'],
  ['+xml', 'text'],
]

function extensionOf(name) {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(name || ''))
  return match === null ? '' : match[1].toLowerCase()
}

function mimeOf(item) {
  if (item !== null && typeof item === 'object' && typeof item.mime === 'string' && item.mime !== '') return item.mime
  const itemName = item !== null && typeof item === 'object' ? item.name : ''
  return MEDIA_MIME[extensionOf(itemName)] || 'application/octet-stream'
}

/** Coarse kind used to pick a preview and an icon. */
function mediaKindOf(item) {
  const mime = mimeOf(item)
  for (const [prefix, kind] of MEDIA_KIND_BY_MIME) {
    if (prefix.endsWith('/') ? mime.startsWith(prefix) : mime.indexOf(prefix) === 0) return kind
  }
  return 'file'
}

function mediaIconOf(item) {
  const kind = mediaKindOf(item)
  if (kind === 'image') return 'image'
  if (kind === 'pdf') return 'doc'
  if (kind === 'audio') return 'sparkles'
  if (kind === 'video') return 'eye'
  if (kind === 'text') return 'edit'
  return 'archive'
}

function mediaUrl(media, options) {
  const suffix = options && options.download ? '?download=1' : ''
  return ROUTE_BASE + '/media/' + encodeURIComponent(String(media && media.id ? media.id : '')) + suffix
}

/** Human file size (reuses formatBytes from the settings part). */
function mediaSizeLabel(media) {
  return formatBytes(Number(media && media.size ? media.size : 0))
}

/** One tile in the attachment grid. */
function MediaTile(props) {
  const input = props || {}
  const media = input.media || {}
  const kind = mediaKindOf(media)
  return h(
    'div',
    { className: 'dsh-axl-media-tile dsh-axl-media-' + kind, 'data-kind': kind },
    h(
      'button',
      {
        type: 'button',
        className: 'dsh-axl-media-thumb',
        title: 'Preview ' + String(media.name || ''),
        onClick: () => {
          if (typeof input.onPreview === 'function') input.onPreview(media)
        },
      },
      kind === 'image'
        ? h('img', { className: 'dsh-axl-media-image', src: mediaUrl(media), alt: String(media.name || '') })
        : h('span', { className: 'dsh-axl-media-glyph', 'aria-hidden': 'true' }, h(Icon, { name: mediaIconOf(media), size: 22 })),
    ),
    h(
      'div',
      { className: 'dsh-axl-media-info' },
      h('span', { className: 'dsh-axl-media-name', title: String(media.name || '') }, String(media.name || 'file')),
      h('span', { className: 'dsh-axl-media-meta' }, mediaSizeLabel(media) + ' · ' + String(media.mime || mimeOf(media)).split('/').pop()),
    ),
    h(
      'div',
      { className: 'dsh-axl-media-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'dsh-axl-media-action',
          title: 'Download',
          onClick: () => window.open(mediaUrl(media, { download: true }), '_blank', 'noopener'),
        },
        h(Icon, { name: 'download', size: 14 }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'dsh-axl-media-action is-danger',
          title: 'Remove from document',
          onClick: () => {
            if (typeof input.onRemove === 'function') input.onRemove(media)
          },
        },
        h(Icon, { name: 'trash', size: 14 }),
      ),
    ),
  )
}

/** Attachment grid shown inside the editor and the media library. */
function MediaGrid(props) {
  const input = props || {}
  const items = Array.isArray(input.items) ? input.items : mediaOf(input.node)
  const emptyHint = input.emptyHint || 'No attachments yet — drop a file here or use Add file.'
  return h(
    'div',
    { className: 'dsh-axl-media-grid', 'data-count': String(items.length) },
    items.length === 0 ? h('div', { className: 'dsh-axl-media-empty' }, emptyHint) : items.map((media, index) => h(MediaTile, { key: String(media.id || index), media, onPreview: input.onPreview, onRemove: input.onRemove })),
    h(
      'label',
      { className: 'dsh-axl-media-drop' },
      h(Icon, { name: 'upload', size: 16 }),
      h('span', null, 'Add file'),
      h('input', {
        type: 'file',
        multiple: true,
        className: 'dsh-axl-media-file',
        onChange: (event) => {
          const files = event.target.files ? Array.from(event.target.files) : []
          event.target.value = ''
          if (typeof input.onUpload === 'function') input.onUpload(files)
        },
      }),
    ),
  )
}

/** Text-ish attachments are fetched and shown in a pre block. */
function MediaTextPreview({ media }) {
  const state = React.useState({ status: 'loading', text: '' })
  const view = state[0]
  const setView = state[1]
  React.useEffect(() => {
    let alive = true
    fetch(mediaUrl(media))
      .then((response) => response.text())
      .then((text) => {
        if (alive) setView({ status: 'ready', text: text.slice(0, 200000) })
      })
      .catch((error) => {
        if (alive) setView({ status: 'error', text: String((error && error.message) || error) })
      })
    return () => {
      alive = false
    }
  }, [media && media.id])
  if (view.status === 'loading') return h('div', { className: 'dsh-axl-media-loading' }, 'Loading preview…')
  if (view.status === 'error') return h('div', { className: 'dsh-axl-media-empty' }, 'Preview failed: ' + view.text)
  return h('pre', { className: 'dsh-axl-media-text' }, view.text)
}

/** Modal preview for one attachment. */
function MediaPreview(props) {
  const media = (props && props.media) || {}
  const onClose = props && typeof props.onClose === 'function' ? props.onClose : () => {}
  const kind = mediaKindOf(media)
  return h(
    'div',
    {
      className: 'dsh-axl-backdrop dsh-axl-media-backdrop',
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose()
      },
    },
    h(
      'div',
      { className: 'dsh-axl-media-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': String(media.name || 'Attachment') },
      h(
        'div',
        { className: 'dsh-axl-media-modalhead' },
        h('span', { className: 'dsh-axl-media-modaltitle' }, String(media.name || 'Attachment')),
        h('span', { className: 'dsh-axl-media-modalmeta' }, mediaSizeLabel(media) + ' · ' + mimeOf(media)),
        h(
          'button',
          { type: 'button', className: 'dsh-axl-icon-btn', title: 'Close preview', onClick: onClose },
          h(Icon, { name: 'close', size: 16 }),
        ),
      ),
      h(
        'div',
        { className: 'dsh-axl-media-stage dsh-axl-media-stage-' + kind },
        kind === 'image'
          ? h('img', { className: 'dsh-axl-media-full', src: mediaUrl(media), alt: String(media.name || '') })
          : kind === 'pdf'
            ? h('iframe', { className: 'dsh-axl-media-frame', src: mediaUrl(media), title: String(media.name || 'PDF'), loading: 'lazy' })
            : kind === 'audio'
              ? h('audio', { className: 'dsh-axl-media-audio', src: mediaUrl(media), controls: true })
              : kind === 'video'
                ? h('video', { className: 'dsh-axl-media-video', src: mediaUrl(media), controls: true })
                : kind === 'text'
                  ? h(MediaTextPreview, { media })
                  : h(
                      'div',
                      { className: 'dsh-axl-media-empty' },
                      'No in-app preview for this format. ',
                      h('a', { href: mediaUrl(media, { download: true }), className: 'dsh-axl-media-link' }, 'Download it instead'),
                    ),
      ),
    ),
  )
}

/** Media sandbox view: every attachment in the archive, filterable by kind. */
function MediaLibrary(props) {
  const input = props || {}
  const snapshot = input.snapshot || { nodes: [] }
  const actions = input.actions || {}
  const kindState = React.useState('all')
  const kind = kindState[0]
  const setKind = kindState[1]
  const entries = allMedia(snapshot)
  const kinds = ['all', 'image', 'pdf', 'audio', 'video', 'text', 'file']
  const visible = kind === 'all' ? entries : entries.filter((entry) => mediaKindOf(entry.media) === kind)
  return h(
    'div',
    { className: 'dsh-axl-media-library' },
    h(
      'div',
      { className: 'dsh-axl-media-libhead' },
      h(
        'div',
        null,
        h('h3', { className: 'dsh-axl-doc-title' }, 'Media sandbox'),
        h('p', { className: 'dsh-axl-doc-meta' }, entries.length + ' attachment(s) across ' + snapshot.nodes.length + ' document(s)'),
        h(
          'button',
          { type: 'button', className: 'dsh-axl-btn is-ghost', style: { marginTop: 8 }, title: 'Arrange attachments on a pannable canvas', onClick: () => { if (typeof actions.openView === 'function') actions.openView('canvas') } },
          h(Icon, { name: 'canvas', size: 12 }),
          'Open canvas',
        ),
      ),
      h(
        'div',
        { className: 'dsh-axl-media-libactions' },
        h(
          'div',
          { className: 'dsh-axl-seg' },
          kinds.map((name) =>
            h(
              'button',
              {
                key: name,
                type: 'button',
                className: 'dsh-axl-seg-btn' + (name === kind ? ' is-active' : ''),
                onClick: () => setKind(name),
              },
              name === 'all' ? 'All' : name.charAt(0).toUpperCase() + name.slice(1),
            ),
          ),
        ),
      ),
    ),
    visible.length === 0
      ? h('div', { className: 'dsh-axl-media-empty' }, 'No attachments in this category yet.')
      : h(
          'div',
          { className: 'dsh-axl-media-libgrid' },
          visible.map((entry, index) => {
            const parentTitle = entry.node ? entry.node.title : 'Unknown document'
            const parentAlive = entry.node && entry.node.trashed !== true
            return h(
              'div',
              { key: String(entry.media.id || index), className: 'dsh-axl-media-libcard' },
              h(MediaTile, {
                media: entry.media,
                onPreview: input.onPreview,
                onRemove: (media) => {
                  if (parentAlive && typeof actions.removeMedia === 'function') actions.removeMedia(entry.node.id, media.id)
                },
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-axl-media-parent',
                  onClick: () => {
                    if (parentAlive && typeof actions.openNode === 'function') actions.openNode(entry.node.id)
                  },
                },
                parentTitle,
              ),
              h('span', { className: 'dsh-axl-media-date' }, 'added ' + relativeTime(entry.media.uploadedAt)),
            )
          }),
        ),
  )
}

const MEDIA_CSS = `
.dsh-axl-media-grid { display:flex; flex-wrap:wrap; gap:10px; align-items:stretch; }
.dsh-axl-media-tile { position:relative; display:flex; gap:10px; align-items:center; width:100%; padding:8px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-2); animation:dsh-axl-fade-up .24s ease both; }
.dsh-axl-media-thumb { flex:0 0 52px; width:52px; height:52px; padding:0; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); cursor:zoom-in; transition:border-color .18s ease, transform .18s ease; }
.dsh-axl-media-thumb:hover { border-color:var(--dsw-alias-brand-primary); transform:translateY(-1px); }
.dsh-axl-media-image { width:100%; height:100%; object-fit:cover; display:block; }
.dsh-axl-media-info { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
.dsh-axl-media-name { font-size:13px; color:var(--dsw-alias-label-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-axl-media-meta { font-size:11px; color:var(--dsw-alias-label-secondary); }
.dsh-axl-media-actions { display:flex; gap:4px; }
.dsh-axl-media-action { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; padding:0; border:1px solid transparent; border-radius:7px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; transition:background-color .16s ease, color .16s ease; }
.dsh-axl-media-action:hover { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); }
.dsh-axl-media-action.is-danger:hover { color:var(--dsw-alias-state-error-primary); }
.dsh-axl-media-empty { width:100%; padding:18px 14px; border:1px dashed var(--dsw-alias-border-l2); border-radius:10px; color:var(--dsw-alias-label-secondary); font-size:13px; text-align:center; }
.dsh-axl-media-drop { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border:1px dashed var(--dsw-alias-border-l2); border-radius:9px; color:var(--dsw-alias-label-secondary); font-size:12px; cursor:pointer; transition:border-color .18s ease, color .18s ease, background-color .18s ease; }
.dsh-axl-media-drop:hover { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
.dsh-axl-media-file { display:none; }
.dsh-axl-media-backdrop { z-index:80; }
.dsh-axl-media-modal { width:min(960px, 94vw); max-height:90vh; display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--dsw-alias-border-l2); border-radius:16px; background:var(--dsw-alias-bg-overlay); box-shadow:0 24px 64px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); animation:dsh-axl-pop .2s ease both; }
.dsh-axl-media-modalhead { display:flex; align-items:center; gap:10px; }
.dsh-axl-media-modaltitle { font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-axl-media-modalmeta { font-size:11px; color:var(--dsw-alias-label-secondary); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-axl-media-stage { flex:1; min-height:200px; display:flex; align-items:center; justify-content:center; overflow:auto; border-radius:10px; background:var(--dsw-alias-bg-layer-1); }
.dsh-axl-media-full { max-width:100%; max-height:72vh; object-fit:contain; border-radius:8px; }
.dsh-axl-media-frame { width:100%; height:72vh; border:0; border-radius:8px; background:var(--dsw-alias-bg-base); }
.dsh-axl-media-audio { width:min(520px, 90%); }
.dsh-axl-media-video { max-width:100%; max-height:72vh; border-radius:8px; }
.dsh-axl-media-text { margin:0; padding:14px; width:100%; max-height:72vh; overflow:auto; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.55; color:var(--dsw-alias-label-primary); white-space:pre-wrap; word-break:break-word; }
.dsh-axl-media-loading { padding:24px; color:var(--dsw-alias-label-secondary); font-size:13px; }
.dsh-axl-media-link { color:var(--dsw-alias-brand-primary); }
.dsh-axl-media-library { display:flex; flex-direction:column; gap:16px; padding:4px 2px 24px; }
.dsh-axl-media-libhead { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.dsh-axl-media-libgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:10px; }
.dsh-axl-media-libcard { display:flex; flex-direction:column; gap:6px; padding:8px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); animation:dsh-axl-fade-up .22s ease both; }
.dsh-axl-media-libcard .dsh-axl-media-tile { border:0; padding:0; background:transparent; }
.dsh-axl-media-parent { align-self:flex-start; max-width:100%; padding:2px 6px; border:0; border-radius:6px; background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); color:var(--dsw-alias-brand-primary); font-size:11px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-axl-media-date { font-size:10px; color:var(--dsw-alias-label-secondary); padding-left:6px; }
.dsh-axl-editor-media { display:flex; flex-direction:column; gap:10px; padding:12px 14px; border-top:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
.dsh-axl-editor-mediahead { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.dsh-axl-editor-mediatitle { font-size:12px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); }
.dsh-axl-attach-count { font-size:11px; color:var(--dsw-alias-label-secondary); }
.dsh-axl-attach-busy { font-size:11px; color:var(--dsw-alias-brand-primary); animation:dsh-axl-pulse 1.2s ease-in-out infinite; }
@media (max-width: 720px) { .dsh-axl-media-libgrid { grid-template-columns:1fr; } }
@media (prefers-reduced-motion: reduce) { .dsh-axl-media-tile, .dsh-axl-media-libcard, .dsh-axl-media-modal { animation:none !important; } }
`

CSS_CHUNKS.push(MEDIA_CSS)

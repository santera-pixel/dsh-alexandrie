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
  // SVG is its own kind: the host refuses to serve it inline, and the preview scrubs it
  // before rendering, so it must never take the plain raster `<img>` path.
  ['image/svg+xml', 'svg'],
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
  if (kind === 'image' || kind === 'svg') return 'image'
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
    { className: 'dsh-scr-media-tile dsh-scr-media-' + kind, 'data-kind': kind },
    h(
      'button',
      {
        type: 'button',
        className: 'dsh-scr-media-thumb',
        title: 'Preview ' + String(media.name || ''),
        onClick: () => {
          if (typeof input.onPreview === 'function') input.onPreview(media)
        },
      },
      kind === 'image'
        ? h('img', { className: 'dsh-scr-media-image', src: mediaUrl(media), alt: String(media.name || '') })
        : h('span', { className: 'dsh-scr-media-glyph', 'aria-hidden': 'true' }, h(Icon, { name: mediaIconOf(media), size: 22 })),
    ),
    h(
      'div',
      { className: 'dsh-scr-media-info' },
      h('span', { className: 'dsh-scr-media-name', title: String(media.name || '') }, String(media.name || 'file')),
      h('span', { className: 'dsh-scr-media-meta' }, mediaSizeLabel(media) + ' · ' + String(media.mime || mimeOf(media)).split('/').pop()),
    ),
    h(
      'div',
      { className: 'dsh-scr-media-actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'dsh-scr-media-action',
          title: 'Download',
          onClick: () => window.open(mediaUrl(media, { download: true }), '_blank', 'noopener'),
        },
        h(Icon, { name: 'download', size: 14 }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'dsh-scr-media-action is-danger',
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
    { className: 'dsh-scr-media-grid', 'data-count': String(items.length) },
    items.length === 0 ? h('div', { className: 'dsh-scr-media-empty' }, emptyHint) : items.map((media, index) => h(MediaTile, { key: String(media.id || index), media, onPreview: input.onPreview, onRemove: input.onRemove })),
    h(
      'label',
      { className: 'dsh-scr-media-drop' },
      h(Icon, { name: 'upload', size: 16 }),
      h('span', null, 'Add file'),
      h('input', {
        type: 'file',
        multiple: true,
        className: 'dsh-scr-media-file',
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
  if (view.status === 'loading') return h('div', { className: 'dsh-scr-media-loading' }, 'Loading preview…')
  if (view.status === 'error') return h('div', { className: 'dsh-scr-media-empty' }, 'Preview failed: ' + view.text)
  return h('pre', { className: 'dsh-scr-media-text' }, view.text)
}

/** Base64 for UTF-8 text without relying on `btoa` (the bundle also runs under jsdom). */
function base64OfText(value) {
  const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(String(value)) : null
  if (bytes === null) return ''
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0
    const triplet = (first << 16) | (second << 8) | third
    out += alphabet[(triplet >> 18) & 63] + alphabet[(triplet >> 12) & 63]
    out += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : '='
    out += index + 2 < bytes.length ? alphabet[triplet & 63] : '='
  }
  return out
}

// Elements that can execute script or pull in foreign content, dropped with their bodies.
const SVG_BLOCKED_ELEMENTS = 'script|foreignObject|iframe|object|embed|audio|video|use|image|feImage|animate|animateTransform|animateMotion|set|handler|listener'

/**
 * Scrub an SVG before previewing it: no scripting elements, no inline event handlers, no
 * `javascript:`/`data:` URLs and no external references. The result is then rendered through
 * `<img>`, which never executes SVG script, so this is defence in depth, not the only barrier.
 */
function sanitizeSvgText(source) {
  let out = String(source === undefined || source === null ? '' : source)
  // Drop every scripting/embedding element, paired or self-closing, including nested bodies.
  const paired = new RegExp('<\\s*(' + SVG_BLOCKED_ELEMENTS + ')\\b[^>]*>[\\s\\S]*?<\\s*/\\s*\\1\\s*>', 'gi')
  const single = new RegExp('<\\s*(?:' + SVG_BLOCKED_ELEMENTS + ')\\b[^>]*?/?>', 'gi')
  out = out.replace(paired, '').replace(single, '')
  // Inline handlers in any quoting style (onload=…, onclick=…).
  out = out.replace(/[\s/]on[a-z]+\s*=\s*"[^"]*"/gi, '')
  out = out.replace(/[\s/]on[a-z]+\s*=\s*'[^']*'/gi, '')
  out = out.replace(/[\s/]on[a-z]+\s*=\s*[^\s>]+/gi, '')
  // References: keep local fragments (`#gradient`), drop every remote or executable target.
  out = out.replace(/\s(?:href|xlink:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (match, raw) => {
    const target = String(raw).replace(/^["']|["']$/g, '').trim()
    return target === '' || target.charAt(0) === '#' ? match : ''
  })
  // Script-bearing URLs anywhere else (style attributes, text, entity tricks).
  out = out.replace(/(?:javascript|vbscript|data)\s*:/gi, '')
  out = out.replace(/<!doctype[^>]*>/gi, '').replace(/<!entity[^>]*>/gi, '')
  return out
}

/** SVG preview: fetch, scrub, then show as a data URL inside `<img>` (non-scripting by spec). */
function SvgPreview({ media }) {
  const state = React.useState({ status: 'loading', src: '', error: '' })
  const view = state[0]
  const setView = state[1]
  React.useEffect(() => {
    let alive = true
    fetch(mediaUrl(media))
      .then((response) => response.text())
      .then((text) => {
        if (!alive) return
        if (text.length > 2000000) {
          setView({ status: 'error', src: '', error: 'the file is too large to preview safely' })
          return
        }
        const clean = sanitizeSvgText(text)
        if (!/<\s*svg\b/i.test(clean)) {
          setView({ status: 'error', src: '', error: 'the file is not a readable SVG document' })
          return
        }
        setView({ status: 'ready', src: 'data:image/svg+xml;base64,' + base64OfText(clean), error: '' })
      })
      .catch((error) => {
        if (!alive) return
        setView({ status: 'error', src: '', error: String((error && error.message) || error) })
      })
    return () => {
      alive = false
    }
  }, [media && media.id])
  if (view.status === 'loading') return h('div', { className: 'dsh-scr-media-loading' }, 'Loading preview…')
  if (view.status === 'error') return h('div', { className: 'dsh-scr-media-empty' }, 'Preview failed: ' + view.error + ' ')
  return h('img', { className: 'dsh-scr-media-full dsh-scr-media-svg-full', src: view.src, alt: String(media.name || 'SVG') })
}

/** Modal preview for one attachment. */
function MediaPreview(props) {
  const media = (props && props.media) || {}
  const onClose = props && typeof props.onClose === 'function' ? props.onClose : () => {}
  const kind = mediaKindOf(media)
  return h(
    'div',
    {
      className: 'dsh-scr-backdrop dsh-scr-media-backdrop',
      onMouseDown: (event) => {
        if (event.target === event.currentTarget) onClose()
      },
    },
    h(
      'div',
      { className: 'dsh-scr-media-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': String(media.name || 'Attachment') },
      h(
        'div',
        { className: 'dsh-scr-media-modalhead' },
        h('span', { className: 'dsh-scr-media-modaltitle' }, String(media.name || 'Attachment')),
        h('span', { className: 'dsh-scr-media-modalmeta' }, mediaSizeLabel(media) + ' · ' + mimeOf(media)),
        h(
          'button',
          { type: 'button', className: 'dsh-scr-icon-btn', title: 'Close preview', onClick: onClose },
          h(Icon, { name: 'close', size: 16 }),
        ),
      ),
      h(
        'div',
        { className: 'dsh-scr-media-stage dsh-scr-media-stage-' + kind },
        kind === 'svg'
          ? h(SvgPreview, { media })
          : kind === 'image'
            ? h('img', { className: 'dsh-scr-media-full', src: mediaUrl(media), alt: String(media.name || '') })
            : kind === 'pdf'
              ? h('iframe', { className: 'dsh-scr-media-frame', src: mediaUrl(media), title: String(media.name || 'PDF'), loading: 'lazy' })
            : kind === 'audio'
              ? h('audio', { className: 'dsh-scr-media-audio', src: mediaUrl(media), controls: true })
              : kind === 'video'
                ? h('video', { className: 'dsh-scr-media-video', src: mediaUrl(media), controls: true })
                : kind === 'text'
                  ? h(MediaTextPreview, { media })
                  : h(
                      'div',
                      { className: 'dsh-scr-media-empty' },
                      'No in-app preview for this format. ',
                      h('a', { href: mediaUrl(media, { download: true }), className: 'dsh-scr-media-link' }, 'Download it instead'),
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
  // SVG previews as its own kind but still belongs in the image filter.
  const visible =
    kind === 'all'
      ? entries
      : entries.filter((entry) => {
          const entryKind = mediaKindOf(entry.media)
          return entryKind === kind || (kind === 'image' && entryKind === 'svg')
        })
  return h(
    'div',
    { className: 'dsh-scr-media-library' },
    h(
      'div',
      { className: 'dsh-scr-media-libhead' },
      h(
        'div',
        null,
        h('h3', { className: 'dsh-scr-doc-title' }, 'Media sandbox'),
        h('p', { className: 'dsh-scr-doc-meta' }, entries.length + ' attachment(s) across ' + snapshot.nodes.length + ' document(s)'),
        h(
          'button',
          { type: 'button', className: 'dsh-scr-btn is-ghost', style: { marginTop: 8 }, title: 'Arrange attachments on a pannable canvas', onClick: () => { if (typeof actions.openView === 'function') actions.openView('canvas') } },
          h(Icon, { name: 'canvas', size: 12 }),
          'Open canvas',
        ),
      ),
      h(
        'div',
        { className: 'dsh-scr-media-libactions' },
        h(
          'div',
          { className: 'dsh-scr-seg' },
          kinds.map((name) =>
            h(
              'button',
              {
                key: name,
                type: 'button',
                className: 'dsh-scr-seg-btn' + (name === kind ? ' is-active' : ''),
                onClick: () => setKind(name),
              },
              name === 'all' ? 'All' : name.charAt(0).toUpperCase() + name.slice(1),
            ),
          ),
        ),
      ),
    ),
    visible.length === 0
      ? h('div', { className: 'dsh-scr-media-empty' }, 'No attachments in this category yet.')
      : h(
          'div',
          { className: 'dsh-scr-media-libgrid' },
          visible.map((entry, index) => {
            const parentTitle = entry.node ? entry.node.title : 'Unknown document'
            const parentAlive = entry.node && entry.node.trashed !== true
            return h(
              'div',
              { key: String(entry.media.id || index), className: 'dsh-scr-media-libcard' },
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
                  className: 'dsh-scr-media-parent',
                  onClick: () => {
                    if (parentAlive && typeof actions.openNode === 'function') actions.openNode(entry.node.id)
                  },
                },
                parentTitle,
              ),
              h('span', { className: 'dsh-scr-media-date' }, 'added ' + relativeTime(entry.media.uploadedAt)),
            )
          }),
        ),
  )
}

const MEDIA_CSS = `
.dsh-scr-media-grid { display:flex; flex-wrap:wrap; gap:10px; align-items:stretch; }
.dsh-scr-media-tile { position:relative; display:flex; gap:10px; align-items:center; width:100%; padding:8px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-2); animation:dsh-scr-fade-up .24s ease both; }
.dsh-scr-media-thumb { flex:0 0 52px; width:52px; height:52px; padding:0; display:flex; align-items:center; justify-content:center; overflow:hidden; border:1px solid var(--dsw-alias-border-l1); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-secondary); cursor:zoom-in; transition:border-color .18s ease, transform .18s ease; }
.dsh-scr-media-thumb:hover { border-color:var(--dsw-alias-brand-primary); transform:translateY(-1px); }
.dsh-scr-media-image { width:100%; height:100%; object-fit:cover; display:block; }
.dsh-scr-media-info { display:flex; flex-direction:column; gap:2px; min-width:0; flex:1; }
.dsh-scr-media-name { font-size:13px; color:var(--dsw-alias-label-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dsh-scr-media-meta { font-size:11px; color:var(--dsw-alias-label-secondary); }
.dsh-scr-media-actions { display:flex; gap:4px; }
.dsh-scr-media-action { display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; padding:0; border:1px solid transparent; border-radius:7px; background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; transition:background-color .16s ease, color .16s ease; }
.dsh-scr-media-action:hover { background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); }
.dsh-scr-media-action.is-danger:hover { color:var(--dsw-alias-state-error-primary); }
.dsh-scr-media-empty { width:100%; padding:18px 14px; border:1px dashed var(--dsw-alias-border-l2); border-radius:10px; color:var(--dsw-alias-label-secondary); font-size:13px; text-align:center; }
.dsh-scr-media-drop { display:inline-flex; align-items:center; gap:6px; padding:8px 12px; border:1px dashed var(--dsw-alias-border-l2); border-radius:9px; color:var(--dsw-alias-label-secondary); font-size:12px; cursor:pointer; transition:border-color .18s ease, color .18s ease, background-color .18s ease; }
.dsh-scr-media-drop:hover { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent); }
.dsh-scr-media-file { display:none; }
.dsh-scr-media-backdrop { z-index:80; }
.dsh-scr-media-modal { width:min(960px, 94vw); max-height:90vh; display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--dsw-alias-border-l2); border-radius:16px; background:var(--dsw-alias-bg-overlay); box-shadow:0 24px 64px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); animation:dsh-scr-pop .2s ease both; }
.dsh-scr-media-modalhead { display:flex; align-items:center; gap:10px; }
.dsh-scr-media-modaltitle { font-size:14px; font-weight:600; color:var(--dsw-alias-label-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-scr-media-modalmeta { font-size:11px; color:var(--dsw-alias-label-secondary); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-scr-media-stage { flex:1; min-height:200px; display:flex; align-items:center; justify-content:center; overflow:auto; border-radius:10px; background:var(--dsw-alias-bg-layer-1); }
.dsh-scr-media-full { max-width:100%; max-height:72vh; object-fit:contain; border-radius:8px; }
.dsh-scr-media-frame { width:100%; height:72vh; border:0; border-radius:8px; background:var(--dsw-alias-bg-base); }
.dsh-scr-media-audio { width:min(520px, 90%); }
.dsh-scr-media-video { max-width:100%; max-height:72vh; border-radius:8px; }
.dsh-scr-media-text { margin:0; padding:14px; width:100%; max-height:72vh; overflow:auto; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.55; color:var(--dsw-alias-label-primary); white-space:pre-wrap; word-break:break-word; }
.dsh-scr-media-loading { padding:24px; color:var(--dsw-alias-label-secondary); font-size:13px; }
.dsh-scr-media-link { color:var(--dsw-alias-brand-primary); }
.dsh-scr-media-library { display:flex; flex-direction:column; gap:16px; padding:4px 2px 24px; }
.dsh-scr-media-libhead { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.dsh-scr-media-libgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:12px; }
.dsh-scr-media-libcard { display:flex; flex-direction:column; gap:6px; padding:8px 8px 10px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-layer-1); animation:dsh-scr-fade-up .22s ease both; }
.dsh-scr-media-libcard .dsh-scr-media-tile { flex-direction:column; align-items:stretch; gap:8px; border:0; padding:0; background:transparent; }
.dsh-scr-media-libcard .dsh-scr-media-thumb { flex:0 0 auto; width:100%; height:140px; }
.dsh-scr-media-libcard .dsh-scr-media-actions { align-self:flex-end; margin-top:-2px; }
.dsh-scr-media-parent { align-self:flex-start; max-width:100%; padding:2px 6px; border:0; border-radius:6px; background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent); color:var(--dsw-alias-brand-primary); font-size:11px; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh-scr-media-date { font-size:10px; color:var(--dsw-alias-label-secondary); padding-left:6px; }
.dsh-scr-editor-media { display:flex; flex-direction:column; gap:10px; padding:12px 14px; border-top:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }
.dsh-scr-editor-mediahead { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.dsh-scr-editor-mediatitle { font-size:12px; font-weight:600; letter-spacing:.03em; text-transform:uppercase; color:var(--dsw-alias-label-secondary); }
.dsh-scr-attach-count { font-size:11px; color:var(--dsw-alias-label-secondary); }
.dsh-scr-attach-busy { font-size:11px; color:var(--dsw-alias-brand-primary); animation:dsh-scr-pulse 1.2s ease-in-out infinite; }
@media (max-width: 720px) { .dsh-scr-media-libgrid { grid-template-columns:1fr; } }
@media (prefers-reduced-motion: reduce) { .dsh-scr-media-tile, .dsh-scr-media-libcard, .dsh-scr-media-modal { animation:none !important; } }
`

CSS_CHUNKS.push(MEDIA_CSS)

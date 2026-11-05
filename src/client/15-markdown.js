// Markdown rendering: a small, dependency-free block/inline parser that returns React
// elements (never innerHTML), plus the stylesheet for the rendered preview.

const MARKDOWN_CSS = `
.dsh-scr-md { color: var(--dsw-alias-label-primary); font-size: var(--scr-md-size, 15px); line-height: 1.72; word-wrap: break-word; }
.dsh-scr-md > *:first-child { margin-top: 0; }
.dsh-scr-md h1, .dsh-scr-md h2, .dsh-scr-md h3, .dsh-scr-md h4, .dsh-scr-md h5, .dsh-scr-md h6 {
  margin: 1.5em 0 .55em; line-height: 1.3; font-weight: 680; letter-spacing: -.012em;
}
.dsh-scr-md h1 { font-size: 1.72em; padding-bottom: .28em; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-scr-md h2 { font-size: 1.38em; padding-bottom: .22em; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-scr-md h3 { font-size: 1.16em; }
.dsh-scr-md h4 { font-size: 1.03em; }
.dsh-scr-md h5, .dsh-scr-md h6 { font-size: .96em; color: var(--dsw-alias-label-secondary); }
.dsh-scr-md p { margin: .7em 0; }
.dsh-scr-md a { color: var(--dsw-alias-brand-primary); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.dsh-scr-md a:hover { text-decoration-thickness: 2px; }
.dsh-scr-md strong { font-weight: 680; }
.dsh-scr-md em { font-style: italic; }
.dsh-scr-md del { opacity: .65; }
.dsh-scr-md mark { padding: 0 3px; border-radius: 4px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 32%, transparent); color: inherit; }
.dsh-scr-md code {
  padding: .12em .38em; border-radius: 5px; font-size: .88em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
}
.dsh-scr-md .dsh-scr-md-math { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-style: italic; color: color-mix(in srgb, var(--dsw-alias-brand-primary) 80%, var(--dsw-alias-label-primary)); }
.dsh-scr-md ul, .dsh-scr-md ol { margin: .6em 0; padding-left: 1.5em; }
.dsh-scr-md li { margin: .26em 0; }
.dsh-scr-md li::marker { color: var(--dsw-alias-label-secondary); }
.dsh-scr-md li.dsh-scr-md-task { list-style: none; margin-left: -1.35em; display: flex; align-items: flex-start; gap: .5em; }
.dsh-scr-md-task input[type="checkbox"] {
  margin-top: .3em; width: 14px; height: 14px; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; flex: 0 0 auto;
}
.dsh-scr-md li.dsh-scr-md-task.is-checked > span { opacity: .58; text-decoration: line-through; }
.dsh-scr-md blockquote {
  margin: .9em 0; padding: .55em .95em;
  border-left: 3px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 55%, transparent);
  border-radius: 0 8px 8px 0;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 6%, transparent);
  color: var(--dsw-alias-label-secondary);
}
.dsh-scr-md blockquote p { margin: .3em 0; }
.dsh-scr-md hr { margin: 1.6em 0; border: 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.dsh-scr-md img { max-width: 100%; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); }
.dsh-scr-md pre {
  position: relative; margin: .95em 0; border-radius: 11px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);
}
.dsh-scr-md-pre-head {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 10px; font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent);
}
.dsh-scr-md-pre-lang { flex: 1 1 auto; }
.dsh-scr-md-copy {
  border: 1px solid transparent; background: transparent; color: inherit; cursor: pointer;
  font: inherit; font-size: 10.5px; padding: 1px 6px; border-radius: 5px; letter-spacing: .04em;
}
.dsh-scr-md-copy:hover { background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }
.dsh-scr-md pre code {
  display: block; padding: 12px 14px; overflow-x: auto; border: 0; border-radius: 0; background: transparent;
  font-size: 12.6px; line-height: 1.62; white-space: pre;
}
.dsh-scr-md table { width: 100%; margin: .95em 0; border-collapse: collapse; font-size: .95em; }
.dsh-scr-md th, .dsh-scr-md td { padding: 7px 11px; border: 1px solid var(--dsw-alias-border-l1); text-align: left; }
.dsh-scr-md th { background: var(--dsw-alias-bg-layer-2); font-weight: 640; }
.dsh-scr-md tr:nth-child(even) td { background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 55%, transparent); }
.dsh-scr-md-container {
  margin: .95em 0; padding: .7em 1em; border-radius: 11px;
  border: 1px solid var(--dsw-alias-border-l1); border-left-width: 3px;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 80%, transparent);
}
.dsh-scr-md-container > .dsh-scr-md-container-title {
  display: flex; align-items: center; gap: 6px; margin-bottom: .25em;
  font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
}
.dsh-scr-md-container.is-note { border-left-color: var(--dsw-alias-brand-primary); }
.dsh-scr-md-container.is-note > .dsh-scr-md-container-title { color: var(--dsw-alias-brand-primary); }
.dsh-scr-md-container.is-tip { border-left-color: var(--dsw-alias-state-success-primary); }
.dsh-scr-md-container.is-tip > .dsh-scr-md-container-title { color: var(--dsw-alias-state-success-primary); }
.dsh-scr-md-container.is-warning { border-left-color: var(--dsw-alias-state-warn-primary); }
.dsh-scr-md-container.is-warning > .dsh-scr-md-container-title { color: var(--dsw-alias-state-warn-primary); }
.dsh-scr-md-container.is-danger { border-left-color: var(--dsw-alias-state-error-primary); }
.dsh-scr-md-container.is-danger > .dsh-scr-md-container-title { color: var(--dsw-alias-state-error-primary); }
.dsh-scr-md-container p:first-of-type { margin-top: .15em; }
.dsh-scr-md-container p:last-child { margin-bottom: .15em; }
`
CSS_CHUNKS.push(MARKDOWN_CSS)

const MD_HEADING = /^(#{1,6})\s+(.*)$/
const MD_FENCE = /^\s*```\s*([\w+-]*)\s*$/
const MD_HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/
const MD_QUOTE = /^\s*>\s?(.*)$/
const MD_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const MD_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/
const MD_CONTAINER_OPEN = /^\s*:::\s*([a-zA-Z]+)\s*(.*)$/

/** Link targets that cannot execute script: absolute web scheme, mail/tel, or a relative path. */
function safeHref(raw) {
  const url = String(raw === undefined || raw === null ? '' : raw).trim()
  if (url === '') return null
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url
  if (/^[/#?]/.test(url)) return url
  if (/^\.{1,2}\//.test(url)) return url
  if (/^[a-z0-9._~%+-]+(\/[^\s]*)?$/i.test(url)) return url
  return null
}

/** Images may additionally use inline data URLs, but only for images. */
function safeImageSrc(raw) {
  const url = String(raw === undefined || raw === null ? '' : raw).trim()
  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);/i.test(url)) return url
  return safeHref(url)
}

function mdInline(text, keyBase) {
  const nodes = []
  const source = String(text === undefined || text === null ? '' : text)
  const pattern = /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]*\]\([^)\s]+\))|(<https?:\/\/[^>\s]+>)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(==[^=]+==)|(\$[^$\n]+\$)|(https?:\/\/[^\s<>)\]]+)/g
  let cursor = 0
  let match
  let index = 0
  const wrap = (type, props, children) => {
    const element = h(type, Object.assign({ key: keyBase + '-' + index }, props), children)
    index += 1
    nodes.push(element)
  }
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) nodes.push(source.slice(cursor, match.index))
    cursor = match.index + match[0].length
    const token = match[0]
    if (match[1] !== undefined) {
      wrap('code', null, token.slice(1, -1))
      continue
    }
    if (match[2] !== undefined) {
      const inner = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token)
      const src = safeImageSrc(inner[2])
      if (src === null) nodes.push(inner[1] === '' ? inner[2] : inner[1])
      else wrap('img', { src: src, alt: inner[1], loading: 'lazy' }, null)
      continue
    }
    if (match[3] !== undefined) {
      const inner = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token)
      const href = safeHref(inner[2])
      if (href === null) {
        nodes.push(inner[1] === '' ? inner[2] : inner[1])
        continue
      }
      const isExternal = /^https?:/i.test(href)
      wrap('a', { href: href, target: isExternal ? '_blank' : undefined, rel: isExternal ? 'noreferrer noopener' : undefined }, mdInline(inner[1], keyBase + 'L' + index))
      continue
    }
    if (match[4] !== undefined) {
      const url = token.slice(1, -1)
      const href = safeHref(url)
      if (href === null) nodes.push(url)
      else wrap('a', { href: href, target: '_blank', rel: 'noreferrer noopener' }, url)
      continue
    }
    if (match[5] !== undefined || match[6] !== undefined) {
      const inner = token.slice(2, -2)
      wrap('strong', null, mdInline(inner, keyBase + 'B' + index))
      continue
    }
    if (match[7] !== undefined || match[8] !== undefined) {
      const inner = token.slice(1, -1)
      wrap('em', null, mdInline(inner, keyBase + 'I' + index))
      continue
    }
    if (match[9] !== undefined) {
      wrap('del', null, mdInline(token.slice(2, -2), keyBase + 'S' + index))
      continue
    }
    if (match[10] !== undefined) {
      wrap('mark', null, mdInline(token.slice(2, -2), keyBase + 'M' + index))
      continue
    }
    if (match[11] !== undefined) {
      wrap('span', { className: 'dsh-scr-md-math' }, token.slice(1, -1))
      continue
    }
    if (match[12] !== undefined) {
      const href = safeHref(token)
      if (href === null) nodes.push(token)
      else wrap('a', { href: href, target: '_blank', rel: 'noreferrer noopener' }, token)
      continue
    }
    nodes.push(token)
  }
  if (cursor < source.length) nodes.push(source.slice(cursor))
  return nodes
}

function mdSplitRow(line) {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|')) text = text.slice(0, -1)
  const cells = []
  let current = ''
  let escaped = false
  for (const character of text) {
    if (escaped) {
      current += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  cells.push(current.trim())
  return cells
}

/** Turn flat list lines into a nested tree so indented bullets render as sub-lists. */
function mdListTree(entries) {
  const root = { children: [] }
  const stack = [{ indent: -1, node: root }]
  for (const entry of entries) {
    while (stack.length > 1 && stack[stack.length - 1].indent >= entry.indent) stack.pop()
    const node = Object.assign({}, entry, { children: [] })
    stack[stack.length - 1].node.children.push(node)
    stack.push({ indent: entry.indent, node })
  }
  return root.children
}

function mdRenderList(entries, keyBase, options) {
  const renderLevel = (items, depth) =>
    items.map((item, itemIndex) => {
      const key = keyBase + '-' + depth + '-' + itemIndex
      const content = item.task
        ? [
            h('input', {
              key: key + '-check',
              type: 'checkbox',
              checked: item.checked,
              onChange: (event) => {
                if (typeof options.onToggleTask === 'function') options.onToggleTask(item.lineIndex, event.target.checked)
              },
            }),
            h('span', { key: key + '-text' }, mdInline(item.text, key + '-t')),
          ]
        : mdInline(item.text, key + '-t')
      const li = h(
        'li',
        { key, className: item.task ? cx('dsh-scr-md-task', item.checked && 'is-checked') : null },
        content,
        item.children.length > 0 ? mdRenderList(item.children, key, options) : null,
      )
      return li
    })

  const ordered = entries.length > 0 && entries[0].ordered
  const tag = ordered ? 'ol' : 'ul'
  return h(tag, { key: keyBase + '-list' }, renderLevel(entries, 0))
}

function mdRenderTable(headerLine, alignLine, rows, keyBase) {
  const headCells = mdSplitRow(headerLine)
  const aligns = mdSplitRow(alignLine).map((cell) => {
    if (/^:-+:$/.test(cell)) return 'center'
    if (/-+:$/.test(cell)) return 'right'
    return 'left'
  })
  return h(
    'div',
    { key: keyBase, style: { overflowX: 'auto' } },
    h(
      'table',
      null,
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          headCells.map((cell, index) => h('th', { key: 'h' + index, style: { textAlign: aligns[index] || 'left' } }, mdInline(cell, keyBase + 'h' + index))),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map((row, rowIndex) =>
          h(
            'tr',
            { key: 'r' + rowIndex },
            mdSplitRow(row).map((cell, cellIndex) =>
              h('td', { key: 'c' + cellIndex, style: { textAlign: aligns[cellIndex] || 'left' } }, mdInline(cell, keyBase + 'r' + rowIndex + 'c' + cellIndex)),
            ),
          ),
        ),
      ),
    ),
  )
}

function mdRenderCode(lang, code, keyBase) {
  const copy = () => {
    try {
      if (navigator && navigator.clipboard) void navigator.clipboard.writeText(code)
    } catch (error) {
      console.error('[dsh-scriptorium] clipboard failed', error)
    }
  }
  return h(
    'pre',
    { key: keyBase },
    h(
      'div',
      { className: 'dsh-scr-md-pre-head' },
      h('span', { className: 'dsh-scr-md-pre-lang' }, lang === '' ? 'code' : lang),
      h('button', { type: 'button', className: 'dsh-scr-md-copy', onClick: copy }, 'Copy'),
    ),
    h('code', null, code),
  )
}

/** Parse a block-level Markdown document into an array of React elements. */
function mdParseBlocks(source, options) {
  const opts = options || {}
  const lines = String(source === undefined || source === null ? '' : source).replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let cursor = 0
  let key = 0
  const nextKey = (suffix) => 'md-' + (key++) + (suffix || '')

  while (cursor < lines.length) {
    const line = lines[cursor]

    if (line.trim() === '') {
      cursor += 1
      continue
    }

    const fence = MD_FENCE.exec(line)
    if (fence !== null) {
      const lang = (fence[1] || '').toLowerCase()
      const body = []
      cursor += 1
      while (cursor < lines.length && !/^\s*```\s*$/.test(lines[cursor])) {
        body.push(lines[cursor])
        cursor += 1
      }
      cursor += 1
      blocks.push(mdRenderCode(lang, body.join('\n'), nextKey('-code')))
      continue
    }

    const container = MD_CONTAINER_OPEN.exec(line)
    if (container !== null) {
      const kind = container[1].toLowerCase()
      const valid = ['note', 'tip', 'warning', 'danger'].indexOf(kind) >= 0
      const title = (container[2] || '').trim()
      if (valid && title.toLowerCase() !== 'end') {
        const body = []
        cursor += 1
        let depth = 1
        while (cursor < lines.length) {
          const inner = lines[cursor]
          if (MD_CONTAINER_OPEN.test(inner)) depth += 1
          if (/^\s*:::\s*$/.test(inner)) {
            depth -= 1
            if (depth === 0) break
          }
          body.push(inner)
          cursor += 1
        }
        cursor += 1
        blocks.push(
          h(
            'div',
            { key: nextKey('-box'), className: 'dsh-scr-md-container is-' + kind },
            h('div', { className: 'dsh-scr-md-container-title' }, title === '' ? kind.toUpperCase() : title),
            mdParseBlocks(body.join('\n'), opts),
          ),
        )
        continue
      }
    }

    const heading = MD_HEADING.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      blocks.push(h('h' + level, { key: nextKey('-h') }, mdInline(heading[2], nextKey('-hi'))))
      cursor += 1
      continue
    }

    if (MD_HR.test(line)) {
      blocks.push(h('hr', { key: nextKey('-hr') }))
      cursor += 1
      continue
    }

    if (MD_TABLE_SEP.test(line) && cursor > 0) {
      // A separator row without a preceding header is not a table; render it literally.
      blocks.push(h('p', { key: nextKey('-p') }, mdInline(line, nextKey('-pi'))))
      cursor += 1
      continue
    }

    if (MD_QUOTE.test(line)) {
      const body = []
      while (cursor < lines.length && MD_QUOTE.test(lines[cursor])) {
        body.push(MD_QUOTE.exec(lines[cursor])[1])
        cursor += 1
      }
      blocks.push(h('blockquote', { key: nextKey('-q') }, mdParseBlocks(body.join('\n'), opts)))
      continue
    }

    if (MD_LIST.test(line) && MD_LIST.exec(line)[2].length > 0) {
      const entries = []
      while (cursor < lines.length) {
        const current = lines[cursor]
        const item = MD_LIST.exec(current)
        if (item === null) {
          if (current.trim() === '' || entries.length === 0) break
          // Lazy continuation of the previous bullet.
          entries[entries.length - 1].text += ' ' + current.trim()
          cursor += 1
          continue
        }
        const indent = Math.floor(item[1].replace(/\t/g, '  ').length / 2)
        let text = item[3]
        let task = false
        let checked = false
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(text)
        if (taskMatch !== null) {
          task = true
          checked = taskMatch[1].toLowerCase() === 'x'
          text = taskMatch[2]
        }
        entries.push({ indent, ordered: /\d/.test(item[2]), task, checked, text, lineIndex: cursor, children: [] })
        cursor += 1
      }
      blocks.push(mdRenderList(mdListTree(entries), nextKey('-ul'), opts))
      continue
    }

    if (/^\s*\|/.test(line)) {
      const rows = []
      while (cursor < lines.length && /^\s*\|/.test(lines[cursor])) {
        rows.push(lines[cursor])
        cursor += 1
      }
      if (rows.length >= 2 && MD_TABLE_SEP.test(rows[1])) {
        blocks.push(mdRenderTable(rows[0], rows[1], rows.slice(2), nextKey('-tbl')))
      } else if (rows.length >= 2) {
        blocks.push(mdRenderTable(rows[0], '', rows.slice(1), nextKey('-tbl')))
      } else {
        blocks.push(h('p', { key: nextKey('-p') }, mdInline(rows[0], nextKey('-pi'))))
      }
      continue
    }

    // Paragraph: gather until a blank line or the start of another block.
    const paragraph = []
    while (cursor < lines.length) {
      const current = lines[cursor]
      if (
        current.trim() === '' ||
        MD_HEADING.test(current) ||
        MD_FENCE.test(current) ||
        MD_HR.test(current) ||
        MD_QUOTE.test(current) ||
        MD_CONTAINER_OPEN.test(current) ||
        (/^\s*\|/.test(current) && current.indexOf('|') > 0)
      ) {
        break
      }
      paragraph.push(current.trim())
      cursor += 1
    }
    if (paragraph.length > 0) blocks.push(h('p', { key: nextKey('-p') }, mdInline(paragraph.join(' '), nextKey('-pi'))))
    else cursor += 1
  }

  return blocks
}

function renderMarkdown(source, options) {
  return mdParseBlocks(source, options || {})
}

function markdownPlainText(source) {
  return String(source === undefined || source === null ? '' : source)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/:::[a-z]*/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`=|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function markdownStats(source) {
  const text = markdownPlainText(source)
  const words = text === '' ? 0 : text.split(/\s+/).length
  const headings = String(source || '').split('\n').filter((line) => MD_HEADING.test(line)).length
  return { words, minutes: Math.max(1, Math.round(words / 220)), headings, characters: String(source || '').length }
}

/** Flip one task-list checkbox in the source. Returns the source unchanged when that line is not a task. */
function toggleTaskLine(source, lineIndex, checked) {
  const text = String(source === undefined || source === null ? '' : source)
  const lines = text.split('\n')
  if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) return text
  let changed = false
  lines[lineIndex] = lines[lineIndex].replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (whole, lead, flag, tail) => {
    changed = true
    return lead + (checked === true ? 'x' : ' ') + tail
  })
  return changed ? lines.join('\n') : text
}

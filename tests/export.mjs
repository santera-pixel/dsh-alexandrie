// Export path tests: the Markdown download and the JSON archive download must produce a
// correctly named file with the exact payload, without leaving the panel.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.join(here, '..', 'src', 'client')
const source = ['00-boot.js', '40-app.js']
  .map((name) => fs.readFileSync(path.join(clientDir, name), 'utf8'))
  .join('\n')

const downloads = []
const anchors = []
const documentStub = {
  head: { appendChild() {}, removeChild() {} },
  body: { appendChild: (node) => anchors.push(node) },
  createElement: () => {
    const anchor = {
      style: {},
      download: '',
      href: '',
      rel: '',
      click() {
        downloads.push({ filename: anchor.download, blob: anchor.href })
      },
      remove() {},
      setAttribute() {},
    }
    return anchor
  },
  addEventListener() {},
  removeEventListener() {},
}

const blobs = []
class BlobStub {
  constructor(parts, options) {
    this.parts = parts
    this.type = (options && options.type) || ''
    this.text = String(parts.join(''))
  }
}

const urlStub = {
  createObjectURL: (blob) => {
    blobs.push(blob)
    return 'blob:stub/' + blobs.length
  },
  revokeObjectURL() {},
}

const factory = new Function(
  'require',
  'window',
  'document',
  'fetch',
  'Blob',
  'URL',
  'setTimeout',
  source + '\n;return { slugify, downloadText }\n',
)
const { slugify, downloadText } = factory(() => ({}), {}, documentStub, async () => null, BlobStub, urlStub, (fn) => fn())

let passed = 0
const check = (title, fn) => {
  try {
    fn()
    passed += 1
    console.log('ok   ' + title)
  } catch (error) {
    console.error('FAIL ' + title)
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  }
}

check('slugify produces a safe file name', () => {
  assert.equal(slugify('Welcome to Scriptorium'), 'welcome-to-scriptorium')
  assert.equal(slugify('  Weird /// title!!  '), 'weird-title')
  assert.equal(slugify(''), 'document')
  assert.equal(slugify(null), 'document')
  assert.ok(!slugify('Ünïcode note').includes('/'))
})

check('a Markdown export downloads one .md file with the exact body', () => {
  downloads.length = 0
  const markdown = '# Welcome\n\nBody with **bold**\n'
  downloadText(slugify('Welcome guide') + '.md', markdown, 'text/markdown')
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].filename, 'welcome-guide.md')
  const blob = blobs[blobs.length - 1]
  assert.match(blob.type, /^text\/markdown/)
  assert.equal(blob.text, markdown)
})

check('a JSON export downloads one .json file with the serialized snapshot', () => {
  downloads.length = 0
  const snapshot = { version: 1, workspaces: [{ id: 'ws-1', name: 'Docs' }], nodes: [] }
  downloadText('scriptorium-archive-2026-01-01.json', JSON.stringify(snapshot, null, 2))
  assert.equal(downloads.length, 1)
  assert.equal(downloads[0].filename, 'scriptorium-archive-2026-01-01.json')
  const blob = blobs[blobs.length - 1]
  assert.match(blob.type, /^application\/json/)
  assert.deepEqual(JSON.parse(blob.text), snapshot)
})

if (process.exitCode === undefined) console.log('\nexport: ' + passed + ' checks passed')

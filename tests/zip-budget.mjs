// ZIP reader safety budgets: decompression bombs must fail closed inside the reader,
// while a genuinely large but honest archive still imports.
//
// The fixtures are hand-built (local headers + central directory + deflateRawSync) so a
// test can declare whatever uncompressed size it likes without allocating that much.

import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { crc32, parseZip } from '../lib/zip.js'
import { buildArchive, parseArchive } from '../lib/archive.js'

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

const MIB = 1024 * 1024
const BUDGET = /^archive exceeds safety budget: /

/**
 * Build a ZIP with explicit control over the declared (uncompressed) size.
 * @param {{name: string, data: Buffer, method?: 0 | 8, declaredSize?: number}[]} entries
 */
function craftZip(entries) {
  const parts = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(String(entry.name), 'utf8')
    const method = entry.method === 0 ? 0 : 8
    const raw = entry.data
    const payload = method === 8 ? deflateRawSync(raw) : raw
    const declared = entry.declaredSize === undefined ? raw.length : entry.declaredSize
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(declared, 22)
    local.writeUInt16LE(name.length, 26)
    parts.push(local, name, payload)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(payload.length, 20)
    header.writeUInt32LE(declared, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + payload.length
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, directory, end])
}

check('a compression-ratio bomb fails closed', () => {
  const zip = craftZip([{ name: 'ratio-bomb.txt', data: Buffer.alloc(2 * MIB, 0x41) }])
  assert.throws(
    () => parseZip(zip),
    (error) => BUDGET.test(error.message) && /compression ratio/i.test(error.message),
  )
})

check('an entry-count bomb fails closed', () => {
  const entries = []
  for (let index = 0; index < 2001; index += 1) entries.push({ name: 'tiny-' + index + '.txt', data: Buffer.from('x'), method: 0 })
  const zip = craftZip(entries)
  assert.throws(
    () => parseZip(zip),
    (error) => BUDGET.test(error.message) && /entry count/i.test(error.message),
  )
})

check('an entry that declares more than 16 MB fails closed', () => {
  const zip = craftZip([{ name: 'declared-bomb.txt', data: Buffer.from('tiny'), declaredSize: 16 * MIB + 1, method: 0 }])
  assert.throws(
    () => parseZip(zip),
    (error) => BUDGET.test(error.message) && /entry limit/i.test(error.message),
  )
})

check('an entry that inflates past 16 MB fails closed', () => {
  // Declared size looks innocent, so only the inflate cap can stop it.
  const zip = craftZip([{ name: 'inflate-bomb.txt', data: Buffer.alloc(16 * MIB + 1024, 0x42), declaredSize: 1024 }])
  assert.throws(
    () => parseZip(zip),
    (error) => BUDGET.test(error.message) && /entry limit|inflates past/i.test(error.message),
  )
})

check('the total decompressed budget fails closed', () => {
  // Nine entries that each declare 16 MB (under the per-entry cap) but claim a sane
  // ratio, so only the 128 MB total can reject them. Nothing is inflated: the declared
  // sizes are checked before the reader allocates entry output.
  const entries = []
  for (let index = 0; index < 9; index += 1) {
    entries.push({ name: 'total-' + index + '.bin', data: Buffer.alloc(90 * 1024, 0x43), declaredSize: 16 * MIB, method: 0 })
  }
  assert.throws(
    () => parseZip(craftZip(entries)),
    (error) => BUDGET.test(error.message) && /total/i.test(error.message),
  )
})

check('a legitimate multi-megabyte archive still imports', () => {
  const lines = []
  for (let index = 0; index < 40000; index += 1) {
    lines.push('line ' + index + ' - the quick brown fox jumps over the lazy dog while the archive is read')
  }
  const content = lines.join('\n')
  assert.ok(content.length > 3 * MIB, 'fixture is over 3 MB of text')
  const snapshot = {
    version: 1,
    workspaces: [{ id: 'ws-1', name: 'Big notes', icon: 'book', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    nodes: [
      {
        id: 'doc-1',
        workspaceId: 'ws-1',
        parentId: null,
        kind: 'doc',
        title: 'Large note',
        status: 'active',
        tags: [],
        favorite: false,
        trashed: false,
        order: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        content,
      },
    ],
    settings: {},
    ui: { activeWorkspaceId: 'ws-1', activeNodeId: 'doc-1', expanded: [] },
  }
  const zip = buildArchive({ snapshot, media: [] })
  const parsed = parseArchive(zip)
  assert.equal(parsed.snapshot.nodes.length, 1)
  assert.equal(parsed.snapshot.nodes[0].content.length, content.length)
  assert.equal(parsed.snapshot.nodes[0].content, content)
  assert.equal(parsed.media.length, 0)
})

if (process.exitCode === undefined) console.log('\nzip-budget: ' + passed + ' checks passed')

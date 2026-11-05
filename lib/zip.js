// Minimal ZIP writer / reader used by the Scriptorium archive export and import.
//
// Only what a notes archive needs: UTF-8 names, store (0) and deflate (8) entries,
// no encryption, no ZIP64, no multi-disk. Deflate is done by node's zlib, so the
// generated archives open in every OS archive tool and in Scriptorium itself.

import { deflateRawSync, inflateRawSync } from 'node:zlib'

// Safety budgets for reading untrusted archives. The compressed request body is capped
// by the route, but a tiny deflated entry can still expand without bound, so the reader
// enforces its own ceilings before it allocates anything.
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_ENTRY_BYTES = 16 * 1024 * 1024
const MAX_ENTRIES = 2000
const MAX_RATIO = 200
/** Entries smaller than this pass the ratio check: tiny files are legitimately steep. */
const RATIO_FLOOR_BYTES = 1024 * 1024

/** An archive that would expand past the reader's safety budgets. */
export class ZipBudgetError extends Error {
  constructor(reason) {
    super('archive exceeds safety budget: ' + reason)
    this.name = 'ZipBudgetError'
    this.code = 'ZIP_BUDGET'
  }
}

function budget(reason) {
  return new ZipBudgetError(reason)
}

function shortName(name) {
  return name.length > 80 ? name.slice(0, 77) + '...' : name
}

/** CRC-32 (IEEE) lookup table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

/** Compute the CRC-32 of a buffer. */
export function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS date/time pair for a JS date (local time, as the format requires). */
function dosStamp(date) {
  const year = Math.max(1980, date.getFullYear())
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

function normalizeName(name) {
  return String(name).replace(/\\/g, '/').replace(/^\/+/, '')
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(String(data), 'utf8')
}

/**
 * Build a ZIP archive.
 * @param {{name: string, data: Buffer | Uint8Array | string, mtime?: Date}[]} entries
 * @param {{compress?: boolean}} [options]
 * @returns {Buffer}
 */
export function buildZip(entries, options = {}) {
  const compress = options.compress !== false
  const stamp = options.mtime instanceof Date ? options.mtime : new Date()
  const { time, day } = dosStamp(stamp)
  const central = []
  const parts = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(normalizeName(entry.name), 'utf8')
    const raw = toBuffer(entry.data)
    const crc = crc32(raw)
    let method = 0
    let payload = raw
    if (compress && raw.length > 0) {
      const deflated = deflateRawSync(raw)
      if (deflated.length < raw.length) {
        method = 8
        payload = deflated
      }
    }

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    parts.push(local, name, payload)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt16LE(time, 12)
    header.writeUInt16LE(day, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(payload.length, 20)
    header.writeUInt32LE(raw.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += local.length + name.length + payload.length
  }

  if (entries.length > 0xfffe) throw new Error('zip archive would need ZIP64 (too many entries)')
  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...parts, centralBuffer, end])
}

/** Find the end-of-central-directory record, scanning backwards over the comment. */
function findEnd(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22)
  for (let index = buffer.length - 22; index >= min; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index
  }
  return -1
}

/**
 * Read a ZIP archive.
 * @param {Buffer | Uint8Array} buffer
 * @returns {{name: string, data: Buffer, size: number, method: number}[]}
 */
export function parseZip(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (data.length < 22) throw new Error('not a zip archive (too short)')
  const end = findEnd(data)
  if (end < 0) throw new Error('not a zip archive (no end record)')
  const count = data.readUInt16LE(end + 10)
  if (count > MAX_ENTRIES) throw budget(`entry count ${count} exceeds ${MAX_ENTRIES}`)
  const pointer = data.readUInt32LE(end + 16)

  // First pass: walk the central directory and reject metadata-level bombs before a
  // single entry is inflated. The declared sizes are what an honest archive reports, so
  // an oversized or over-compressed entry is stopped here without allocating its output.
  const records = []
  let declaredTotal = 0
  let scan = pointer

  for (let index = 0; index < count; index += 1) {
    if (scan + 46 > data.length) throw new Error('zip central directory is truncated')
    if (data.readUInt32LE(scan) !== 0x02014b50) throw new Error('zip central directory is corrupt')
    const method = data.readUInt16LE(scan + 10)
    const crc = data.readUInt32LE(scan + 16)
    const compressedSize = data.readUInt32LE(scan + 20)
    const size = data.readUInt32LE(scan + 24)
    const nameLength = data.readUInt16LE(scan + 28)
    const extraLength = data.readUInt16LE(scan + 30)
    const commentLength = data.readUInt16LE(scan + 32)
    const localOffset = data.readUInt32LE(scan + 42)
    const name = data.subarray(scan + 46, scan + 46 + nameLength).toString('utf8')

    if (size > MAX_ENTRY_BYTES) {
      throw budget(`entry ${shortName(name)} declares ${size} bytes, over the ${MAX_ENTRY_BYTES}-byte entry limit`)
    }
    if (size >= RATIO_FLOOR_BYTES && compressedSize > 0 && size / compressedSize > MAX_RATIO) {
      throw budget(`entry ${shortName(name)} declares a ${Math.round(size / compressedSize)}:1 compression ratio, over ${MAX_RATIO}:1`)
    }
    declaredTotal += size
    if (declaredTotal > MAX_TOTAL_BYTES) {
      throw budget(`declared total ${declaredTotal} bytes exceeds the ${MAX_TOTAL_BYTES}-byte decompression budget`)
    }

    records.push({ name, method, crc, compressedSize, size, localOffset })
    scan += 46 + nameLength + extraLength + commentLength
  }

  // Second pass: inflate with a hard per-entry cap and keep a running total, so a size
  // field that lies about the real output still cannot expand past the budgets.
  const entries = []
  let total = 0

  for (const record of records) {
    const { name, method, crc, compressedSize, size, localOffset } = record

    if (localOffset + 30 > data.length) throw new Error('zip entry points outside the archive')
    if (data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip local header is corrupt')
    const localNameLength = data.readUInt16LE(localOffset + 26)
    const localExtraLength = data.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = data.subarray(start, start + compressedSize)
    if (raw.length !== compressedSize) throw new Error('zip entry data is truncated')

    let payload
    if (method === 0) {
      if (raw.length > MAX_ENTRY_BYTES) {
        throw budget(`entry ${shortName(name)} stores ${raw.length} bytes, over the ${MAX_ENTRY_BYTES}-byte entry limit`)
      }
      payload = Buffer.from(raw)
    } else if (method === 8) {
      try {
        payload = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES })
      } catch (error) {
        if (error && error.code === 'ERR_BUFFER_TOO_LARGE') {
          throw budget(`entry ${shortName(name)} inflates past the ${MAX_ENTRY_BYTES}-byte entry limit`)
        }
        throw error
      }
    } else {
      throw new Error(`unsupported zip compression method: ${method}`)
    }

    if (payload.length > MAX_ENTRY_BYTES) {
      throw budget(`entry ${shortName(name)} inflates past the ${MAX_ENTRY_BYTES}-byte entry limit`)
    }
    if (payload.length >= RATIO_FLOOR_BYTES && raw.length > 0 && payload.length / raw.length > MAX_RATIO) {
      throw budget(`entry ${shortName(name)} inflates ${payload.length} bytes from ${raw.length}, over ${MAX_RATIO}:1`)
    }

    if (payload.length !== size) throw new Error(`zip entry size mismatch for ${name}`)
    if (crc32(payload) !== crc) throw new Error(`zip entry checksum mismatch for ${name}`)

    total += payload.length
    if (total > MAX_TOTAL_BYTES) {
      throw budget(`total decompressed ${total} bytes exceeds the ${MAX_TOTAL_BYTES}-byte budget`)
    }

    if (!name.endsWith('/')) entries.push({ name, data: payload, size, method })
  }

  return entries
}

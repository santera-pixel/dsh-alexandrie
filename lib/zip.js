// Minimal ZIP writer / reader used by the Scriptorium archive export and import.
//
// Only what a notes archive needs: UTF-8 names, store (0) and deflate (8) entries,
// no encryption, no ZIP64, no multi-disk. Deflate is done by node's zlib, so the
// generated archives open in every OS archive tool and in Scriptorium itself.

import { deflateRawSync, inflateRawSync } from 'node:zlib'

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
  let pointer = data.readUInt32LE(end + 16)
  const entries = []

  for (let index = 0; index < count; index += 1) {
    if (pointer + 46 > data.length) throw new Error('zip central directory is truncated')
    if (data.readUInt32LE(pointer) !== 0x02014b50) throw new Error('zip central directory is corrupt')
    const method = data.readUInt16LE(pointer + 10)
    const crc = data.readUInt32LE(pointer + 16)
    const compressedSize = data.readUInt32LE(pointer + 20)
    const size = data.readUInt32LE(pointer + 24)
    const nameLength = data.readUInt16LE(pointer + 28)
    const extraLength = data.readUInt16LE(pointer + 30)
    const commentLength = data.readUInt16LE(pointer + 32)
    const localOffset = data.readUInt32LE(pointer + 42)
    const name = data.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8')

    if (localOffset + 30 > data.length) throw new Error('zip entry points outside the archive')
    if (data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip local header is corrupt')
    const localNameLength = data.readUInt16LE(localOffset + 26)
    const localExtraLength = data.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const raw = data.subarray(start, start + compressedSize)
    if (raw.length !== compressedSize) throw new Error('zip entry data is truncated')

    let payload
    if (method === 0) payload = Buffer.from(raw)
    else if (method === 8) payload = inflateRawSync(raw)
    else throw new Error(`unsupported zip compression method: ${method}`)

    if (payload.length !== size) throw new Error(`zip entry size mismatch for ${name}`)
    if (crc32(payload) !== crc) throw new Error(`zip entry checksum mismatch for ${name}`)

    if (!name.endsWith('/')) entries.push({ name, data: payload, size, method })
    pointer += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

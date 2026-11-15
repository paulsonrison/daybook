import { Unzip, UnzipInflate } from 'fflate';
const LIMIT = 8388608;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const invalid = () =>
  new Error(
    'Office archive is malformed, unsupported or exceeds the supported limits.',
  );
/** Validate both the ZIP directory and actual streamed output; advertised sizes alone are not trusted. */
export function readBoundedOfficeZip(bytes: Uint8Array) {
  if (bytes.length < 22 || bytes.length > 10485760) throw invalid();
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--)
    if (
      data.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + data.readUInt16LE(i + 20) === data.length
    ) {
      end = i;
      break;
    }
  if (
    end < 0 ||
    data.readUInt16LE(end + 4) !== 0 ||
    data.readUInt16LE(end + 6) !== 0
  )
    throw invalid();
  const count = data.readUInt16LE(end + 10),
    size = data.readUInt32LE(end + 12),
    offset = data.readUInt32LE(end + 16);
  if (
    count < 1 ||
    count > 512 ||
    data.readUInt16LE(end + 8) !== count ||
    offset + size !== end
  )
    throw invalid();
  const catalog = new Map<string, { size: number; crc: number }>();
  let cursor = offset,
    advertised = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || data.readUInt32LE(cursor) !== 0x02014b50)
      throw invalid();
    const flags = data.readUInt16LE(cursor + 8),
      compression = data.readUInt16LE(cursor + 10),
      nameLength = data.readUInt16LE(cursor + 28),
      extra = data.readUInt16LE(cursor + 30),
      comment = data.readUInt16LE(cursor + 32),
      original = data.readUInt32LE(cursor + 24);
    if (
      flags & 1 ||
      ![0, 8].includes(compression) ||
      cursor + 46 + nameLength + extra + comment > end ||
      data.readUInt16LE(cursor + 34) !== 0 ||
      original > LIMIT
    )
      throw invalid();
    const name = new TextDecoder('utf-8', { fatal: true }).decode(
      data.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (
      !name ||
      name.length > 240 ||
      name.startsWith('/') ||
      /[\\:\x00-\x1f]/.test(name) ||
      name
        .replace(/\/$/, '')
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      catalog.has(name)
    )
      throw invalid();
    advertised += original;
    if (advertised > LIMIT) throw invalid();
    catalog.set(name, { size: original, crc: data.readUInt32LE(cursor + 16) });
    cursor += 46 + nameLength + extra + comment;
  }
  if (cursor !== end) throw invalid();
  const output = new Map<string, Buffer>(),
    seen = new Set<string>();
  let expanded = 0;
  const unzip = new Unzip((file) => {
    const metadata = catalog.get(file.name);
    if (!metadata || seen.has(file.name)) throw invalid();
    seen.add(file.name);
    const chunks: Uint8Array[] = [];
    let length = 0,
      crc = 0xffffffff;
    file.ondata = (error, chunk, final) => {
      if (error) throw invalid();
      length += chunk.length;
      expanded += chunk.length;
      if (length > metadata.size || expanded > LIMIT) {
        file.terminate();
        throw invalid();
      }
      for (const byte of chunk)
        crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      chunks.push(chunk);
      if (final) {
        if (
          length !== metadata.size ||
          (crc ^ 0xffffffff) >>> 0 !== metadata.crc
        )
          throw invalid();
        output.set(file.name, Buffer.concat(chunks));
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let i = 0; i < bytes.length; i += 1024)
      unzip.push(bytes.subarray(i, i + 1024), i + 1024 >= bytes.length);
  } catch {
    throw invalid();
  }
  if (output.size !== catalog.size) throw invalid();
  return output;
}

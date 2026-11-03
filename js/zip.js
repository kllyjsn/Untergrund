// Store-only (no compression) .zip writer: WAV stems barely compress, and this keeps the export dependency-free.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

const utf8 = (s) => new TextEncoder().encode(s);
// MS-DOS date/time, the format zip headers use.
function dosTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export class ZipWriter {
  constructor(date = new Date()) { this.parts = []; this.central = []; this.offset = 0; this.when = dosTime(date); }

  // data: Blob, ArrayBuffer, Uint8Array or string. Files are kept as Blobs, so large stems are not copied twice.
  async add(name, data) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(bytes), size = bytes.length, fname = utf8(name);
    const head = new Uint8Array(30 + fname.length), v = new DataView(head.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, this.when.time, true); v.setUint16(12, this.when.date, true);
    v.setUint32(14, crc, true); v.setUint32(18, size, true); v.setUint32(22, size, true);
    v.setUint16(26, fname.length, true); v.setUint16(28, 0, true); head.set(fname, 30);
    const cen = new Uint8Array(46 + fname.length), c = new DataView(cen.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, this.when.time, true); c.setUint16(14, this.when.date, true);
    c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, fname.length, true); c.setUint32(42, this.offset, true); cen.set(fname, 46);
    this.parts.push(head, blob); this.central.push(cen);
    this.offset += head.length + size;
  }

  blob() {
    const cenSize = this.central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array(22), v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, this.central.length, true); v.setUint16(10, this.central.length, true);
    v.setUint32(12, cenSize, true); v.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, end], { type: 'application/zip' });
  }
}

// 최소 ZIP 읽기/쓰기(CRC32, stored와 deflate).
//
// .goodnotes는 보통 ZIP이다(모든 자료 공통). 쓰기는 두 방식을 지원한다.
// - stored(방식 0): 동기, 무압축.
// - deflate(방식 8): CompressionStream("deflate-raw")로 압축하므로 비동기다.
//   natural-ink와 goodnotes-codec는 둘 다 deflate로 쓴 파일을 굿노트에서 열었다고 기록했다.
//   stored ZIP을 굿노트가 받는지는 확인된 자료가 없다.
// 읽기는 central directory를 기준으로 한다. deflate 멤버 해제는 DecompressionStream("deflate-raw")를
// 쓰는 비동기 함수(zipEntryData)로 따로 둔다. ZIP64와 암호화는 지원하지 않는다.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;

export const ZIP_STORED = 0;
export const ZIP_DEFLATE = 8;

// ---------------------------------------------------------------------------
// CRC32 (IEEE 802.3, 다항식 0xEDB88320)

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// 스트림 도우미

async function pipeThrough(data: Uint8Array, stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> }): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  const writing = writer.write(new Uint8Array(data)).then(() => writer.close());
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.length;
  }
  await writing;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** raw deflate 해제(브라우저, Node 24 공통 DecompressionStream). */
export function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(data, new DecompressionStream("deflate-raw"));
}

/** raw deflate 압축(브라우저, Node 24 공통 CompressionStream). */
export function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(data, new CompressionStream("deflate-raw"));
}

// ---------------------------------------------------------------------------
// 읽기

export type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  dosTime: number;
  dosDate: number;
  /** 압축된(또는 stored) 원래 데이터. 다시 쓸 때 그대로 복사할 수 있다. */
  compressed: Uint8Array;
};

function u16(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}

function u32(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function findEocd(zip: Uint8Array): number {
  const min = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= min; i -= 1) {
    if (u32(zip, i) === SIG_EOCD) return i;
  }
  throw new Error("ZIP_NO_EOCD");
}

/** ZIP을 읽어 멤버 목록을 돌려준다(데이터는 아직 풀지 않는다). */
export function readZip(zip: Uint8Array): ZipEntry[] {
  const eocd = findEocd(zip);
  const count = u16(zip, eocd + 10);
  const cdSize = u32(zip, eocd + 12);
  const cdOffset = u32(zip, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("ZIP64_UNSUPPORTED");
  if (cdOffset + cdSize > zip.length) throw new Error("ZIP_BAD_CENTRAL_DIRECTORY");
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (u32(zip, p) !== SIG_CENTRAL) throw new Error("ZIP_BAD_CENTRAL_SIGNATURE");
    const flags = u16(zip, p + 8);
    const method = u16(zip, p + 10);
    const dosTime = u16(zip, p + 12);
    const dosDate = u16(zip, p + 14);
    const crc = u32(zip, p + 16);
    const compressedSize = u32(zip, p + 20);
    const uncompressedSize = u32(zip, p + 24);
    const nameLen = u16(zip, p + 28);
    const extraLen = u16(zip, p + 30);
    const commentLen = u16(zip, p + 32);
    const localOffset = u32(zip, p + 42);
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (flags & 1) throw new Error(`ZIP_ENCRYPTED ${name}`);
    if (u32(zip, localOffset) !== SIG_LOCAL) throw new Error(`ZIP_BAD_LOCAL_SIGNATURE ${name}`);
    const dataStart = localOffset + 30 + u16(zip, localOffset + 26) + u16(zip, localOffset + 28);
    if (dataStart + compressedSize > zip.length) throw new Error(`ZIP_TRUNCATED ${name}`);
    entries.push({
      name,
      method,
      flags,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      dosTime,
      dosDate,
      compressed: zip.subarray(dataStart, dataStart + compressedSize),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** stored 멤버의 데이터를 동기로 꺼낸다. deflate면 오류(zipEntryData를 쓴다). */
export function zipEntryDataSync(entry: ZipEntry): Uint8Array {
  if (entry.method !== ZIP_STORED) throw new Error(`ZIP_NEEDS_ASYNC_INFLATE ${entry.name}`);
  return entry.compressed;
}

/** 멤버 데이터를 꺼내고 CRC를 확인한다. */
export async function zipEntryData(entry: ZipEntry): Promise<Uint8Array> {
  let data: Uint8Array;
  if (entry.method === ZIP_STORED) data = entry.compressed;
  else if (entry.method === ZIP_DEFLATE) data = await inflateRaw(entry.compressed);
  else throw new Error(`ZIP_UNSUPPORTED_METHOD ${entry.method} ${entry.name}`);
  if (data.length !== entry.uncompressedSize) throw new Error(`ZIP_SIZE_MISMATCH ${entry.name}`);
  if (crc32(data) !== entry.crc32) throw new Error(`ZIP_CRC_MISMATCH ${entry.name}`);
  return data;
}

/** 모든 멤버를 풀어 이름 → 데이터 맵으로 돌려준다(ZIP 순서 유지). */
export async function readZipFiles(zip: Uint8Array): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const entry of readZip(zip)) files.set(entry.name, await zipEntryData(entry));
  return files;
}

// ---------------------------------------------------------------------------
// 쓰기

export type ZipWriteInput =
  /** 새 데이터. method 기본은 stored. */
  | { name: string; data: Uint8Array; method?: number; date?: Date }
  /** 읽은 멤버를 압축 데이터 그대로 복사한다. */
  | { name: string; copy: ZipEntry };

export type PreparedZipEntry = {
  name: string;
  method: number;
  crc32: number;
  uncompressedSize: number;
  compressed: Uint8Array;
  dosTime: number;
  dosDate: number;
};

/** Date(로컬 시각 아님, UTC 성분 사용)를 DOS 시각/날짜로 바꾼다. */
export function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  return {
    dosTime: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

/** 쓰기 입력을 압축까지 마친 항목으로 바꾼다(deflate 때문에 비동기). */
export async function prepareZipEntry(input: ZipWriteInput): Promise<PreparedZipEntry> {
  if ("copy" in input) {
    const e = input.copy;
    return {
      name: input.name,
      method: e.method,
      crc32: e.crc32,
      uncompressedSize: e.uncompressedSize,
      compressed: e.compressed,
      dosTime: e.dosTime,
      dosDate: e.dosDate,
    };
  }
  const method = input.method ?? ZIP_STORED;
  const { dosTime, dosDate } = toDosDateTime(input.date ?? new Date(Date.UTC(1980, 0, 1)));
  let compressed: Uint8Array;
  if (method === ZIP_STORED) compressed = input.data;
  else if (method === ZIP_DEFLATE) compressed = await deflateRaw(input.data);
  else throw new Error(`ZIP_UNSUPPORTED_METHOD ${method}`);
  return { name: input.name, method, crc32: crc32(input.data), uncompressedSize: input.data.length, compressed, dosTime, dosDate };
}

class ByteWriter {
  parts: Uint8Array[] = [];
  length = 0;
  bytes(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }
  u16(v: number): void {
    this.bytes(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff));
  }
  u32(v: number): void {
    this.bytes(Uint8Array.of(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff));
  }
  result(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** 준비된 항목들을 ZIP으로 쓴다(동기). 항목 순서를 그대로 지킨다. */
export function writeZipPrepared(entries: ReadonlyArray<PreparedZipEntry>): Uint8Array {
  const encoder = new TextEncoder();
  const w = new ByteWriter();
  const seen = new Set<string>();
  const central: Array<{ e: PreparedZipEntry; name: Uint8Array; offset: number; flags: number }> = [];
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`ZIP_DUPLICATE_NAME ${e.name}`);
    seen.add(e.name);
    const name = encoder.encode(e.name);
    const flags = /^[\x20-\x7e]*$/.test(e.name) ? 0 : FLAG_UTF8;
    const offset = w.length;
    w.u32(SIG_LOCAL);
    w.u16(20); // version needed
    w.u16(flags);
    w.u16(e.method);
    w.u16(e.dosTime);
    w.u16(e.dosDate);
    w.u32(e.crc32);
    w.u32(e.compressed.length);
    w.u32(e.uncompressedSize);
    w.u16(name.length);
    w.u16(0);
    w.bytes(name);
    w.bytes(e.compressed);
    central.push({ e, name, offset, flags });
  }
  const cdStart = w.length;
  for (const { e, name, offset, flags } of central) {
    w.u32(SIG_CENTRAL);
    w.u16(20); // version made by (MS-DOS, 2.0)
    w.u16(20);
    w.u16(flags);
    w.u16(e.method);
    w.u16(e.dosTime);
    w.u16(e.dosDate);
    w.u32(e.crc32);
    w.u32(e.compressed.length);
    w.u32(e.uncompressedSize);
    w.u16(name.length);
    w.u16(0); // extra
    w.u16(0); // comment
    w.u16(0); // disk
    w.u16(0); // internal attrs
    w.u32(0); // external attrs
    w.u32(offset);
    w.bytes(name);
  }
  const cdSize = w.length - cdStart;
  w.u32(SIG_EOCD);
  w.u16(0);
  w.u16(0);
  w.u16(central.length);
  w.u16(central.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0);
  return w.result();
}

/** stored 항목만으로 ZIP을 동기로 쓴다. */
export function writeZipStored(files: ReadonlyArray<{ name: string; data: Uint8Array; date?: Date }>): Uint8Array {
  return writeZipPrepared(
    files.map(f => {
      const { dosTime, dosDate } = toDosDateTime(f.date ?? new Date(Date.UTC(1980, 0, 1)));
      return { name: f.name, method: ZIP_STORED, crc32: crc32(f.data), uncompressedSize: f.data.length, compressed: f.data, dosTime, dosDate };
    }),
  );
}

/** stored, deflate, 원본 복사를 섞어 ZIP을 쓴다. */
export async function writeZip(inputs: ReadonlyArray<ZipWriteInput>): Promise<Uint8Array> {
  const prepared: PreparedZipEntry[] = [];
  for (const input of inputs) prepared.push(await prepareZipEntry(input));
  return writeZipPrepared(prepared);
}

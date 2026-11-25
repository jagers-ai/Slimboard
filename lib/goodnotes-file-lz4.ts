// Apple libcompression LZ4 프레임(`bv41`)과 표준 LZ4 block 압축기/해제기.
//
// 굿노트는 획 경로(tpl)를 Apple COMPRESSION_LZ4 형식으로 압축해 획 본문 f2에 넣는다.
// 청크 구조(이 저장소 작업에서 macOS libcompression으로 실측해 확정):
//   "bv41" + uint32 LE 원본 길이 + uint32 LE 압축 길이 + LZ4 block
//   "bv4-" + uint32 LE 원본 길이 + 원본 바이트          ← 헤더는 길이 하나(4바이트)뿐
//   "bv4$"                                              ← 스트림 끝
//
// 자료 차이
// - `bv4-` 헤더: goodparse는 길이 하나(4바이트), parser-for-goodnotes는 길이 둘(8바이트)로 적었다.
//   macOS compression_encode_buffer(COMPRESSION_LZ4)에 무작위 5000바이트를 넣으면
//   "bv4-" + 0x1388 + 원본 5000바이트 + "bv4$" = 5012바이트가 나온다. 그래서 4바이트 헤더가 맞다.
// - 청크 크기: libcompression은 원본 65536바이트마다 청크를 나눈다(실측).
//   goodnotes-codec는 "굿노트는 32 KiB마다 나눈다"고 적고 32768로 쓴다. 굿노트가 만든 파일과
//   같게 하려고 기본값을 32768로 둔다. 어느 크기든 libcompression은 해제한다(테스트에서 교차 검증).
// - 청크 내용: natural-ink는 진짜 LZ4 압축 block을, goodnotes-codec는 리터럴만 담은 LZ4 block을 쓴다.
//   두 프로젝트 모두 실제 굿노트에서 열렸다고 기록했다. 기본값은 진짜 압축이고 둘 다 고를 수 있다.
// - 빈 입력: libcompression은 "bv4$" 4바이트만 쓴다(실측). goodnotes-codec는 빈 청크 하나를 쓴다.
// - "bv4$" 뒤의 바이트: parser-for-goodnotes는 획 본문에서 "bv41" 위치를 찾아 해제한 뒤 남은 바이트를
//   "trailer"(색 f4, 이동 f6)로 읽는다. 이것은 f2 다음에 오는 형제 필드를 그렇게 부른 것이고,
//   goodparse와 goodnotes-codec는 f2 값이 "bv4$"로 끝나는 독립 bytes 필드로 본다. 여기서는 후자를 따르되
//   해제기는 "bv4$" 뒤에 남은 바이트 수를 돌려주어 다른 해석의 증거가 보이면 알 수 있게 한다.

const MAGIC_COMPRESSED = [0x62, 0x76, 0x34, 0x31]; // "bv41"
const MAGIC_RAW = [0x62, 0x76, 0x34, 0x2d]; // "bv4-"
const MAGIC_END = [0x62, 0x76, 0x34, 0x24]; // "bv4$"

/** 굿노트가 쓴다고 관찰된 청크 원본 크기(goodnotes-codec 관찰, 공식 아님). */
export const APPLE_LZ4_CHUNK_SIZE = 32768;

export type AppleLz4Mode =
  /** bv41 + 진짜 LZ4 압축 block (natural-ink 방식) */
  | "lz4"
  /** bv41 + 리터럴만 담은 LZ4 block (goodnotes-codec 방식) */
  | "literal"
  /** bv4- 무압축 청크 (libcompression이 압축 이득이 없을 때 쓰는 형식) */
  | "raw";

function hasMagic(buf: Uint8Array, at: number, magic: ReadonlyArray<number>): boolean {
  if (at + 4 > buf.length) return false;
  return buf[at] === magic[0] && buf[at + 1] === magic[1] && buf[at + 2] === magic[2] && buf[at + 3] === magic[3];
}

function readU32(buf: Uint8Array, at: number): number {
  if (at + 4 > buf.length) throw new Error("LZ4_TRUNCATED_HEADER");
  return (buf[at] | (buf[at + 1] << 8) | (buf[at + 2] << 16) | (buf[at + 3] << 24)) >>> 0;
}

function writeU32(out: number[], value: number): void {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

/** blob이 Apple LZ4 청크로 시작하는지 본다. */
export function isAppleLz4(blob: Uint8Array): boolean {
  return hasMagic(blob, 0, MAGIC_COMPRESSED) || hasMagic(blob, 0, MAGIC_RAW) || hasMagic(blob, 0, MAGIC_END);
}

// ---------------------------------------------------------------------------
// LZ4 block 해제

/**
 * 표준 LZ4 block 하나를 out 뒤에 푼다. out 앞부분(이전 청크 출력)을 사전으로 참조하는 것을 허용한다.
 * 시퀀스: [token][리터럴 길이 확장][리터럴][offset u16 LE][매치 길이 확장]. 마지막 시퀀스는 리터럴만.
 */
function lz4DecodeInto(src: Uint8Array, out: number[], expectedSize: number): void {
  const start = out.length;
  let i = 0;
  while (i < src.length) {
    const token = src[i++];
    let literal = token >> 4;
    if (literal === 15) {
      let b: number;
      do {
        if (i >= src.length) throw new Error("LZ4_TRUNCATED_LITERAL_LENGTH");
        b = src[i++];
        literal += b;
      } while (b === 255);
    }
    if (i + literal > src.length) throw new Error("LZ4_TRUNCATED_LITERALS");
    for (let k = 0; k < literal; k += 1) out.push(src[i + k]);
    i += literal;
    if (i >= src.length) break;
    if (i + 2 > src.length) throw new Error("LZ4_TRUNCATED_OFFSET");
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    if (offset === 0 || offset > out.length) throw new Error("LZ4_BAD_OFFSET");
    let match = token & 15;
    if (match === 15) {
      let b: number;
      do {
        if (i >= src.length) throw new Error("LZ4_TRUNCATED_MATCH_LENGTH");
        b = src[i++];
        match += b;
      } while (b === 255);
    }
    match += 4;
    const from = out.length - offset;
    // 겹치는 매치(반복 런)가 있으므로 한 바이트씩 복사한다.
    for (let k = 0; k < match; k += 1) out.push(out[from + k]);
  }
  if (out.length - start !== expectedSize) {
    throw new Error(`LZ4_SIZE_MISMATCH expected ${expectedSize} got ${out.length - start}`);
  }
}

/** 단독 LZ4 block을 푼다. */
export function lz4DecompressBlock(src: Uint8Array, expectedSize: number): Uint8Array {
  const out: number[] = [];
  lz4DecodeInto(src, out, expectedSize);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// LZ4 block 압축

const MIN_MATCH = 4;
const LAST_LITERALS = 5; // block 끝 5바이트는 반드시 리터럴
const MF_LIMIT = 12; // 마지막 매치는 block 끝 12바이트 전보다 앞에서 시작해야 한다
const HASH_LOG = 16;
const MAX_OFFSET = 65535;

function writeLength(out: number[], extra: number): void {
  let rest = extra;
  while (rest >= 255) {
    out.push(255);
    rest -= 255;
  }
  out.push(rest);
}

function writeSequence(out: number[], src: Uint8Array, litStart: number, litEnd: number, offset: number, matchLength: number): void {
  const literal = litEnd - litStart;
  const hasMatch = matchLength > 0;
  const m = hasMatch ? matchLength - MIN_MATCH : 0;
  out.push((Math.min(literal, 15) << 4) | (hasMatch ? Math.min(m, 15) : 0));
  if (literal >= 15) writeLength(out, literal - 15);
  for (let k = litStart; k < litEnd; k += 1) out.push(src[k]);
  if (!hasMatch) return;
  out.push(offset & 0xff, (offset >>> 8) & 0xff);
  if (m >= 15) writeLength(out, m - 15);
}

function read32(src: Uint8Array, at: number): number {
  return (src[at] | (src[at + 1] << 8) | (src[at + 2] << 16) | (src[at + 3] << 24)) >>> 0;
}

/**
 * 표준 LZ4 block 압축(해시 테이블 탐욕 매칭). 결과는 lz4 참조 구현과 같은 block 형식이다.
 * 표준 제약을 지킨다: 마지막 5바이트 리터럴, 마지막 매치 시작은 끝에서 12바이트 이전, offset 1..65535.
 */
export function lz4CompressBlock(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  const n = src.length;
  if (n < MF_LIMIT + 1) {
    writeSequence(out, src, 0, n, 0, 0);
    return Uint8Array.from(out);
  }
  const table = new Int32Array(1 << HASH_LOG).fill(-1);
  const matchStartLimit = n - MF_LIMIT; // ip < 이 값
  const matchEndLimit = n - LAST_LITERALS; // 매치는 이 위치를 넘지 않는다
  let anchor = 0;
  let ip = 0;
  while (ip < matchStartLimit) {
    const seq = read32(src, ip);
    const h = Math.imul(seq, 2654435761) >>> (32 - HASH_LOG);
    const ref = table[h];
    table[h] = ip;
    if (ref >= 0 && ip - ref <= MAX_OFFSET && read32(src, ref) === seq) {
      let length = MIN_MATCH;
      while (ip + length < matchEndLimit && src[ref + length] === src[ip + length]) length += 1;
      writeSequence(out, src, anchor, ip, ip - ref, length);
      ip += length;
      anchor = ip;
    } else {
      ip += 1;
    }
  }
  writeSequence(out, src, anchor, n, 0, 0);
  return Uint8Array.from(out);
}

/** 원본을 리터럴 하나로만 담은 유효한 LZ4 block(goodnotes-codec 방식). */
export function lz4LiteralBlock(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  writeSequence(out, src, 0, src.length, 0, 0);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------------------
// Apple 프레임

export type AppleLz4Decoded = {
  data: Uint8Array;
  /** "bv4$"까지 읽은 바이트 수 */
  consumed: number;
  /** "bv4$" 뒤에 남은 바이트 수(굿노트 획 f2에서는 0으로 예상) */
  trailing: number;
  chunks: Array<{ kind: "bv41" | "bv4-"; rawSize: number; storedSize: number }>;
};

/** Apple LZ4 프레임을 푼다. "bv4$"가 없으면 오류. */
export function appleLz4Decode(blob: Uint8Array): AppleLz4Decoded {
  const out: number[] = [];
  const chunks: AppleLz4Decoded["chunks"] = [];
  let pos = 0;
  for (;;) {
    if (hasMagic(blob, pos, MAGIC_END)) {
      pos += 4;
      return { data: Uint8Array.from(out), consumed: pos, trailing: blob.length - pos, chunks };
    }
    if (hasMagic(blob, pos, MAGIC_COMPRESSED)) {
      const rawSize = readU32(blob, pos + 4);
      const storedSize = readU32(blob, pos + 8);
      pos += 12;
      if (pos + storedSize > blob.length) throw new Error("LZ4_TRUNCATED_CHUNK");
      lz4DecodeInto(blob.subarray(pos, pos + storedSize), out, rawSize);
      pos += storedSize;
      chunks.push({ kind: "bv41", rawSize, storedSize });
    } else if (hasMagic(blob, pos, MAGIC_RAW)) {
      const rawSize = readU32(blob, pos + 4);
      pos += 8;
      if (pos + rawSize > blob.length) throw new Error("LZ4_TRUNCATED_CHUNK");
      for (let k = 0; k < rawSize; k += 1) out.push(blob[pos + k]);
      pos += rawSize;
      chunks.push({ kind: "bv4-", rawSize, storedSize: rawSize });
    } else if (pos + 4 > blob.length) {
      throw new Error("LZ4_MISSING_END_MARKER");
    } else {
      throw new Error(`LZ4_BAD_CHUNK_MAGIC at ${pos}`);
    }
  }
}

export type AppleLz4EncodeOptions = {
  mode?: AppleLz4Mode;
  /** 청크 원본 크기. 기본 32768(굿노트 관찰값). */
  chunkSize?: number;
};

/** Apple LZ4 프레임으로 쓴다. 청크는 서로 참조하지 않는 독립 block이다. */
export function appleLz4Encode(data: Uint8Array, options: AppleLz4EncodeOptions = {}): Uint8Array {
  const mode = options.mode ?? "lz4";
  const chunkSize = options.chunkSize ?? APPLE_LZ4_CHUNK_SIZE;
  if (!(chunkSize > 0)) throw new Error("LZ4_BAD_CHUNK_SIZE");
  const out: number[] = [];
  for (let at = 0; at < data.length; at += chunkSize) {
    const chunk = data.subarray(at, Math.min(data.length, at + chunkSize));
    if (mode === "raw") {
      out.push(...MAGIC_RAW);
      writeU32(out, chunk.length);
      for (let k = 0; k < chunk.length; k += 1) out.push(chunk[k]);
      continue;
    }
    const block = mode === "literal" ? lz4LiteralBlock(chunk) : lz4CompressBlock(chunk);
    out.push(...MAGIC_COMPRESSED);
    writeU32(out, chunk.length);
    writeU32(out, block.length);
    for (let k = 0; k < block.length; k += 1) out.push(block[k]);
  }
  out.push(...MAGIC_END);
  return Uint8Array.from(out);
}

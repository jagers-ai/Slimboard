// 스키마 없는 protobuf wire 인코더/디코더와 varint 길이 레코드 스트림.
//
// 굿노트 파일에는 공개된 .proto가 없으므로 wire 형식만 읽고 쓴다.
// 모르는 필드 유지 원칙: 디코드한 필드는 원래 바이트(raw)를 들고 다니고, 바꾸지 않은 필드는
// 다시 쓸 때 raw를 그대로 내보낸다. 그래서 decode → encode는 바이트 단위로 원본과 같다.
//
// 근거
// - wire type 0 varint, 1 fixed64, 2 length-delimited, 5 fixed32 (모든 자료 공통, 표준 protobuf).
// - wire type 3/4(group 시작/끝): goodparse 자료는 "현재 굿노트가 index 파일에 쓴다"고 적었고,
//   parser-for-goodnotes 자료는 지원하지 않는다고 적었다. 여기서는 내용 없는 필드로 읽어 보존한다.
// - notes/<UUID>와 index.*.pb는 `[varint 길이][message]` 반복 스트림이다(모든 자료 공통).
//
// 순수 TS: 브라우저와 Node 24(type stripping)에서 돈다. Buffer, 외부 패키지를 쓰지 않는다.

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LEN = 2;
export const WIRE_GROUP_START = 3;
export const WIRE_GROUP_END = 4;
export const WIRE_FIXED32 = 5;

export type PbField = {
  number: number;
  wireType: number;
  /**
   * 값 바이트. varint는 varint 원래 바이트, fixed32는 4바이트, fixed64는 8바이트,
   * length-delimited는 내용(길이 접두 제외), group 표시는 빈 배열.
   */
  data: Uint8Array;
  /** 디코드한 필드의 원래 인코딩(키 포함). 새로 만든 필드에는 없다. */
  raw?: Uint8Array;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ---------------------------------------------------------------------------
// varint

/**
 * base-128 varint를 읽는다. 값은 JS number라서 2^53을 넘으면 정밀도가 떨어진다.
 * 해석에만 쓰고, 다시 쓸 때는 PbField.data의 원래 바이트를 쓰므로 손실이 없다.
 */
export function readVarint(buf: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let scale = 1;
  for (let i = 0; i < 10; i += 1) {
    if (pos >= buf.length) throw new Error("PB_TRUNCATED_VARINT");
    const byte = buf[pos];
    pos += 1;
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return { value, next: pos };
    scale *= 128;
  }
  throw new Error("PB_VARINT_TOO_LONG");
}

/** 0 이상 2^53 미만 정수를 varint로 쓴다. */
export function encodeVarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`PB_BAD_VARINT_VALUE ${value}`);
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Uint8Array.from(out);
}

export function concatBytes(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function utf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

// ---------------------------------------------------------------------------
// message

/** 한 메시지를 필드 목록으로 읽는다. 형식이 깨졌으면 예외를 던진다. */
export function decodeMessage(buf: Uint8Array): PbField[] {
  const fields: PbField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    const key = readVarint(buf, pos);
    pos = key.next;
    const number = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (number === 0) throw new Error("PB_FIELD_ZERO");
    let data: Uint8Array;
    if (wireType === WIRE_VARINT) {
      const v = readVarint(buf, pos);
      data = buf.subarray(pos, v.next);
      pos = v.next;
    } else if (wireType === WIRE_FIXED64) {
      if (pos + 8 > buf.length) throw new Error("PB_TRUNCATED_FIXED64");
      data = buf.subarray(pos, pos + 8);
      pos += 8;
    } else if (wireType === WIRE_FIXED32) {
      if (pos + 4 > buf.length) throw new Error("PB_TRUNCATED_FIXED32");
      data = buf.subarray(pos, pos + 4);
      pos += 4;
    } else if (wireType === WIRE_LEN) {
      const len = readVarint(buf, pos);
      pos = len.next;
      if (pos + len.value > buf.length) throw new Error("PB_TRUNCATED_LEN");
      data = buf.subarray(pos, pos + len.value);
      pos += len.value;
    } else if (wireType === WIRE_GROUP_START || wireType === WIRE_GROUP_END) {
      data = new Uint8Array(0);
    } else {
      throw new Error(`PB_BAD_WIRE_TYPE ${wireType}`);
    }
    fields.push({ number, wireType, data, raw: buf.subarray(start, pos) });
  }
  return fields;
}

/** 전체 바이트가 올바른 비어 있지 않은 메시지일 때만 필드를 돌려준다. */
export function tryDecodeMessage(buf: Uint8Array): PbField[] | null {
  if (buf.length === 0) return null;
  try {
    return decodeMessage(buf);
  } catch {
    return null;
  }
}

function encodeKey(number: number, wireType: number): Uint8Array {
  return encodeVarint(number * 8 + wireType);
}

export function encodeField(field: PbField): Uint8Array {
  if (field.raw) return field.raw;
  const key = encodeKey(field.number, field.wireType);
  if (field.wireType === WIRE_LEN) return concatBytes([key, encodeVarint(field.data.length), field.data]);
  return concatBytes([key, field.data]);
}

/** 필드 목록을 메시지로 쓴다. raw가 있는 필드는 원래 바이트 그대로 나간다. */
export function encodeMessage(fields: ReadonlyArray<PbField>): Uint8Array {
  return concatBytes(fields.map(encodeField));
}

// ---------------------------------------------------------------------------
// 필드 생성기

export function pbVarint(number: number, value: number): PbField {
  return { number, wireType: WIRE_VARINT, data: encodeVarint(value) };
}

export function pbBytes(number: number, data: Uint8Array): PbField {
  return { number, wireType: WIRE_LEN, data };
}

export function pbString(number: number, text: string): PbField {
  return pbBytes(number, utf8(text));
}

export function pbMessage(number: number, fields: ReadonlyArray<PbField>): PbField {
  return pbBytes(number, encodeMessage(fields));
}

export function pbFloat32(number: number, value: number): PbField {
  const data = new Uint8Array(4);
  new DataView(data.buffer).setFloat32(0, value, true);
  return { number, wireType: WIRE_FIXED32, data };
}

export function pbFloat64(number: number, value: number): PbField {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setFloat64(0, value, true);
  return { number, wireType: WIRE_FIXED64, data };
}

// ---------------------------------------------------------------------------
// 필드 읽기 도우미

export function getField(fields: ReadonlyArray<PbField>, number: number): PbField | undefined {
  return fields.find(f => f.number === number);
}

export function fieldVarint(field: PbField | undefined): number | undefined {
  if (!field || field.wireType !== WIRE_VARINT) return undefined;
  return readVarint(field.data, 0).value;
}

export function fieldFloat32(field: PbField | undefined): number | undefined {
  if (!field || field.wireType !== WIRE_FIXED32) return undefined;
  return new DataView(field.data.buffer, field.data.byteOffset, 4).getFloat32(0, true);
}

export function fieldFloat64(field: PbField | undefined): number | undefined {
  if (!field || field.wireType !== WIRE_FIXED64) return undefined;
  return new DataView(field.data.buffer, field.data.byteOffset, 8).getFloat64(0, true);
}

/** fixed32는 float32로, fixed64는 float64로, varint는 정수로 읽는다(굿노트는 크기를 둘 다로 쓴다). */
export function fieldNumber(field: PbField | undefined): number | undefined {
  return fieldFloat32(field) ?? fieldFloat64(field) ?? fieldVarint(field);
}

/** length-delimited 값을 문자열로 읽는다(굿노트 UUID 문자열 등). 앞뒤 공백과 NUL을 걷어 낸다. */
export function fieldString(field: PbField | undefined): string | undefined {
  if (!field || field.wireType !== WIRE_LEN) return undefined;
  return textDecoder.decode(field.data).replace(/^[\s\0]+|[\s\0]+$/g, "");
}

/** length-delimited 값을 하위 메시지로 읽는다. 빈 값은 빈 목록, 메시지가 아니면 undefined. */
export function fieldMessage(field: PbField | undefined): PbField[] | undefined {
  if (!field || field.wireType !== WIRE_LEN) return undefined;
  if (field.data.length === 0) return [];
  return tryDecodeMessage(field.data) ?? undefined;
}

/** number 필드를 replacement로 바꾼다. 처음 나온 자리에 넣고 같은 번호의 나머지는 지운다. 없으면 끝에 붙인다. */
export function replaceField(fields: ReadonlyArray<PbField>, replacement: PbField): PbField[] {
  const out: PbField[] = [];
  let placed = false;
  for (const f of fields) {
    if (f.number !== replacement.number) out.push(f);
    else if (!placed) {
      out.push(replacement);
      placed = true;
    }
  }
  if (!placed) out.push(replacement);
  return out;
}

export function removeField(fields: ReadonlyArray<PbField>, number: number): PbField[] {
  return fields.filter(f => f.number !== number);
}

// ---------------------------------------------------------------------------
// 레코드 스트림: [varint 길이][message] 반복 (notes/<UUID>, index.*.pb)

export function readDelimitedRecords(buf: Uint8Array): Uint8Array[] {
  const records: Uint8Array[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const len = readVarint(buf, pos);
    pos = len.next;
    if (pos + len.value > buf.length) throw new Error("PB_TRUNCATED_RECORD");
    records.push(buf.subarray(pos, pos + len.value));
    pos += len.value;
  }
  return records;
}

export function writeDelimitedRecords(records: ReadonlyArray<Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const r of records) parts.push(encodeVarint(r.length), r);
  return concatBytes(parts);
}

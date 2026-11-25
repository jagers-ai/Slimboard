// 페이지 파일 notes/<ID>의 객체 레코드: 읽기, 획 레코드 만들기, 견본 획 복제, 페이지 다시 쓰기.
//
// 형식 사실(goodparse, goodnotes-codec, natural-ink 공통)
// - 페이지 파일은 레코드 스트림이고 객체마다 "메타 레코드 + 본문 레코드" 두 개가 이어진다. 레코드 순서가 화면 순서(z)다.
// - 본문 레코드는 최상위 필드가 하나뿐이고 그 번호가 객체 종류다(7 = 잉크 획). 본문 f1은 메타 f1과 같은 UUID 문자열.
// - 지운 객체는 파일에 남고 메타 f3 = 1이다(goodnotes-codec). goodparse는 본문 f14 = 1도 같은 뜻으로 적었다.
//
// 획 레코드 필드(자료별)
//   메타:  f1 UUID, f2 버전 도장, f8 장치 ID, f9 생성 순번, f14, f16 스키마 버전(24)
//   본문7: f1 UUID, f2 경로 blob(bv41…bv4$), f4 색 {1 r, 2 g, 3 b, 4 a}(float32), f5 = 1 형광펜,
//          f6 이동 {1 dx, 2 dy}(빈 메시지 = 안 움직임), f7 {1 도장}, f9 도형 정보(자유획은 빈 값),
//          f15 도장, f20 테이프 표시(빈 bytes는 테이프 아님), f21 스키마 버전(24)
// 자료 차이
// - 메타 f2 "버전 도장": goodparse는 {1 counter, 2 hash}, goodnotes-codec는 {1 편집 카운터, 2 임의 32비트 태그},
//   natural-ink는 {1 1, 2 counter}를 쓴다. 두 작성기 모두 굿노트에서 열렸다고 기록했다.
// - 메타 f14: goodnotes-codec는 5381(빈 문자열의 djb2), natural-ink는 1을 쓴다.
// - 메타 f16: goodparse는 "객체 클래스 코드(24 잉크, 25 연필, 35 텍스트)"로, goodnotes-codec와 natural-ink는
//   "스키마 버전 24"로 본다. 우리가 쓰는 값은 어느 해석이든 24로 같다.
// - 메타 f8: goodnotes-codec는 63비트 임의 장치 ID, natural-ink는 1.
// - 본문 f3: goodnotes-codec는 펜 종류(0 볼펜은 생략, 1 만년필, 4 붓, 5 연필)로 본다. 볼펜만 쓰므로 넣지 않는다.
// - 본문 f4: goodnotes-codec는 proto3처럼 0인 채널을 생략하고, natural-ink는 네 채널을 모두 쓴다.
//
// 출처: goodparse(형식 사실만, 코드 미사용), Kaih1825/parser-for-goodnotes(MIT), LambertAlpha/natural-ink(MIT),
//       Taylor-Nilsen/goodnotes-codec(MIT). 코드를 옮기지 않고 사실에 따라 새로 작성했다.

import {
  type PbField,
  encodeMessage,
  fieldMessage,
  fieldString,
  fieldVarint,
  getField,
  pbBytes,
  pbFloat32,
  pbMessage,
  pbString,
  pbVarint,
  readDelimitedRecords,
  removeField,
  replaceField,
  tryDecodeMessage,
  writeDelimitedRecords,
  WIRE_LEN,
} from "./goodnotes-file-protobuf.ts";
import { appleLz4Decode, isAppleLz4 } from "./goodnotes-file-lz4.ts";
import { UNIFORM_PEN_SIGNATURE, decodeTpl } from "./goodnotes-file-tpl.ts";

export const KIND_STROKE = 7;
export const GOODNOTES_SCHEMA_VERSION = 24;
/** 빈 문자열의 djb2 해시. goodnotes-codec가 메타 f14에 쓰는 값. */
export const DJB2_EMPTY = 5381;

export type Rgba = readonly [number, number, number, number];

// ---------------------------------------------------------------------------
// 페이지 읽기

export type PageObject = {
  id: string;
  kind: number;
  /** 메타 레코드(없을 수 있다) */
  meta?: PbField[];
  /** 본문 최상위 필드(번호 = kind) 안의 필드 */
  body: PbField[];
  metaRecord?: Uint8Array;
  bodyRecord: Uint8Array;
  deleted: boolean;
};

export type PageItem = { type: "object"; object: PageObject } | { type: "record"; record: Uint8Array };

function bodyOf(record: Uint8Array): { kind: number; body: PbField[]; id: string } | null {
  const top = tryDecodeMessage(record);
  if (!top || top.length !== 1 || top[0].wireType !== WIRE_LEN) return null;
  const body = fieldMessage(top[0]);
  if (!body) return null;
  const id = fieldString(getField(body, 1));
  if (!id) return null;
  return { kind: top[0].number, body, id };
}

/** 페이지 파일을 객체 목록으로 읽는다. 짝을 찾지 못한 레코드도 순서대로 보존한다. */
export function readPageItems(page: Uint8Array): PageItem[] {
  const items: PageItem[] = [];
  let pending: { record: Uint8Array; fields: PbField[] | null } | null = null;
  for (const record of readDelimitedRecords(page)) {
    const body = bodyOf(record);
    if (body) {
      let meta: PbField[] | undefined;
      let metaRecord: Uint8Array | undefined;
      if (pending && pending.fields && fieldString(getField(pending.fields, 1)) === body.id) {
        meta = pending.fields;
        metaRecord = pending.record;
      } else if (pending) {
        items.push({ type: "record", record: pending.record });
      }
      pending = null;
      const deleted = fieldVarint(getField(meta ?? [], 3)) === 1 || fieldVarint(getField(body.body, 14)) === 1;
      items.push({ type: "object", object: { id: body.id, kind: body.kind, meta, body: body.body, metaRecord, bodyRecord: record, deleted } });
      continue;
    }
    if (pending) items.push({ type: "record", record: pending.record });
    pending = { record, fields: tryDecodeMessage(record) };
  }
  if (pending) items.push({ type: "record", record: pending.record });
  return items;
}

export function pageObjects(page: Uint8Array): PageObject[] {
  return readPageItems(page).flatMap(it => (it.type === "object" ? [it.object] : []));
}

/** 페이지 항목을 다시 레코드 스트림으로 쓴다(바꾸지 않은 레코드는 원래 바이트 그대로). */
export function writePageItems(items: ReadonlyArray<PageItem>): Uint8Array {
  const records: Uint8Array[] = [];
  for (const it of items) {
    if (it.type === "record") records.push(it.record);
    else {
      if (it.object.metaRecord) records.push(it.object.metaRecord);
      records.push(it.object.bodyRecord);
    }
  }
  return writeDelimitedRecords(records);
}

// ---------------------------------------------------------------------------
// 획 정보

export type StrokeInfo = {
  id: string;
  signature: string | null;
  color: Rgba;
  highlighter: boolean;
  tape: boolean;
  shape: boolean;
  moved: boolean;
};

function readColor(field: PbField | undefined): Rgba {
  const msg = fieldMessage(field);
  const c = [0, 0, 0, 1];
  if (!msg) return c as unknown as Rgba;
  // goodnotes-codec: 0인 채널은 생략된다(alpha 포함). goodparse: alpha가 없으면 불투명으로 본다.
  // 색 메시지가 있으면 codec 해석(빠진 채널 = 0)을 따르되, alpha 필드가 아예 없으면 1로 둔다.
  for (let k = 1; k <= 4; k += 1) {
    const f = getField(msg, k);
    if (f && f.data.length === 4) c[k - 1] = new DataView(f.data.buffer, f.data.byteOffset, 4).getFloat32(0, true);
    else if (k < 4) c[k - 1] = 0;
  }
  return c as unknown as Rgba;
}

export function strokeInfo(obj: PageObject): StrokeInfo {
  const blob = getField(obj.body, 2);
  let signature: string | null = null;
  if (blob && isAppleLz4(blob.data)) {
    try {
      signature = decodeTpl(appleLz4Decode(blob.data).data).signature;
    } catch {
      signature = null;
    }
  }
  const tapeField = getField(obj.body, 20);
  const shapeField = getField(obj.body, 9);
  const moveField = getField(obj.body, 6);
  return {
    id: obj.id,
    signature,
    color: readColor(getField(obj.body, 4)),
    highlighter: fieldVarint(getField(obj.body, 5)) === 1,
    tape: !!tapeField && tapeField.data.length > 0,
    shape: !!shapeField && shapeField.data.length > 0,
    moved: !!moveField && moveField.data.length > 0,
  };
}

/** 복제 본보기로 쓸 만한 볼펜 획인가: 지워지지 않았고, 볼펜 시그니처이며, 형광펜, 테이프, 도형, 이동 기록이 없다. */
export function isPlainBallpointStroke(obj: PageObject): boolean {
  if (obj.kind !== KIND_STROKE || obj.deleted || !obj.meta) return false;
  const info = strokeInfo(obj);
  return info.signature === UNIFORM_PEN_SIGNATURE && !info.highlighter && !info.tape && !info.shape && !info.moved && info.color[3] >= 0.95;
}

// ---------------------------------------------------------------------------
// 획 레코드 만들기

export type StrokeRecordInput = {
  id: string;
  /** appleLz4Encode(encodeUniformPenTpl(...)) 결과 */
  blob: Uint8Array;
  color: Rgba;
  highlighter?: boolean;
};

/** 버전 도장 {1 counter, 2 tag}. counter 0은 proto3처럼 생략(goodnotes-codec). */
export function stampMessage(counter: number, tag: number): PbField[] {
  const out: PbField[] = [];
  if (counter) out.push(pbVarint(1, counter));
  out.push(pbVarint(2, tag));
  return out;
}

function colorFields(color: Rgba, dropZero: boolean): PbField[] {
  const out: PbField[] = [];
  color.forEach((v, k) => {
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`STROKE_BAD_COLOR ${color.join(",")}`);
    if (!dropZero || v !== 0) out.push(pbFloat32(k + 1, v));
  });
  return out;
}

/**
 * natural-ink 방식 획 레코드 쌍(natural-ink 관찰, 공식 아님).
 * 메타 {1 id, 2 {1 1, 2 counter}, 8 1, 9 counter, 14 1, 16 24}
 * 본문 {7 {1 id, 2 blob, 4 rgba(네 채널 모두), 6 "", 7 {1 도장}, 9 "", 15 도장, 20 "", 21 24}}
 */
export function naturalInkStrokeRecords(input: StrokeRecordInput & { counter: number }): [Uint8Array, Uint8Array] {
  const clock = stampMessage(1, input.counter);
  const meta = [
    pbString(1, input.id),
    pbMessage(2, clock),
    pbVarint(8, 1),
    pbVarint(9, input.counter),
    pbVarint(14, 1),
    pbVarint(16, GOODNOTES_SCHEMA_VERSION),
  ];
  const body: PbField[] = [
    pbString(1, input.id),
    pbBytes(2, input.blob),
    pbMessage(4, colorFields(input.color, false)),
    ...(input.highlighter ? [pbVarint(5, 1)] : []),
    pbBytes(6, new Uint8Array(0)),
    pbMessage(7, [pbMessage(1, clock)]),
    pbBytes(9, new Uint8Array(0)),
    pbMessage(15, clock),
    pbBytes(20, new Uint8Array(0)),
    pbVarint(21, GOODNOTES_SCHEMA_VERSION),
  ];
  return [encodeMessage(meta), encodeMessage([pbMessage(KIND_STROKE, body)])];
}

/**
 * goodnotes-codec 방식 획 레코드 쌍(goodnotes-codec 관찰, 공식 아님).
 * 메타 {1 id, 2 {1 1, 2 tag}, 8 device, 9 sequence, 14 5381, 16 24}
 * 본문 {7 {1 id, 2 blob, 4 rgba(0 채널 생략), [5 1], 6 "", 7 {1 {1 1, 2 tag2}}, 9 "", 15 {1 1, 2 tag}, 20 "", 21 24}}
 */
export function codecStrokeRecords(input: StrokeRecordInput & { device: number; sequence: number; tag: number; tag2: number }): [Uint8Array, Uint8Array] {
  const stamp = stampMessage(1, input.tag);
  const meta = [
    pbString(1, input.id),
    pbMessage(2, stamp),
    pbVarint(8, input.device),
    pbVarint(9, input.sequence),
    pbVarint(14, DJB2_EMPTY),
    pbVarint(16, GOODNOTES_SCHEMA_VERSION),
  ];
  const body: PbField[] = [
    pbString(1, input.id),
    pbBytes(2, input.blob),
    pbMessage(4, colorFields(input.color, true)),
    ...(input.highlighter ? [pbVarint(5, 1)] : []),
    pbBytes(6, new Uint8Array(0)),
    pbMessage(7, [pbMessage(1, stampMessage(1, input.tag2))]),
    pbBytes(9, new Uint8Array(0)),
    pbMessage(15, stamp),
    pbBytes(20, new Uint8Array(0)),
    pbVarint(21, GOODNOTES_SCHEMA_VERSION),
  ];
  return [encodeMessage(meta), encodeMessage([pbMessage(KIND_STROKE, body)])];
}

/**
 * 견본 파일의 볼펜 획을 복제해 새 획을 만든다. 바꾸는 것: UUID, 경로 blob, 색, 생성 순번, 버전 도장
 * (새 객체이므로 {1 1, 2 새 태그}). 지움 표시(메타 f3, 본문 f14)와 이동(f6)은 비운다. 나머지 필드
 * (장치 ID f8, f14, f16, f21, 뜻 모르는 필드)는 견본 값을 그대로 둔다.
 */
export function cloneStrokeRecords(exemplar: PageObject, input: StrokeRecordInput & { sequence: number; tag: number; tag2: number }): [Uint8Array, Uint8Array] {
  if (!exemplar.meta || exemplar.kind !== KIND_STROKE) throw new Error("TEMPLATE_EXEMPLAR_NOT_A_STROKE");
  const stamp = stampMessage(1, input.tag);
  let meta = exemplar.meta;
  meta = replaceField(meta, pbString(1, input.id));
  meta = replaceField(meta, pbMessage(2, stamp));
  meta = removeField(meta, 3);
  meta = replaceField(meta, pbVarint(9, input.sequence));
  let body = exemplar.body;
  body = replaceField(body, pbString(1, input.id));
  body = replaceField(body, pbBytes(2, input.blob));
  const oldColor = fieldMessage(getField(body, 4)) ?? [];
  const dropZero = oldColor.length < 4; // 견본이 0 채널을 생략했으면 같은 방식으로 쓴다
  body = replaceField(body, pbMessage(4, colorFields(input.color, dropZero)));
  body = input.highlighter ? replaceField(body, pbVarint(5, 1)) : removeField(body, 5);
  body = replaceField(body, pbBytes(6, new Uint8Array(0)));
  if (getField(body, 7)) body = replaceField(body, pbMessage(7, [pbMessage(1, stampMessage(1, input.tag2))]));
  if (getField(body, 15)) body = replaceField(body, pbMessage(15, stamp));
  body = removeField(body, 14);
  return [encodeMessage(meta), encodeMessage([pbMessage(KIND_STROKE, body)])];
}

// ---------------------------------------------------------------------------
// 페이지 다시 쓰기

export type ExistingStrokePolicy =
  /** 기존 획을 그대로 둔다 */
  | "keep"
  /** 기존 획에 지움 표시(메타 f3 = 1)를 한다. 굿노트가 지울 때 하는 방식(goodnotes-codec). */
  | "tombstone"
  /** 기존 획 레코드를 빼 버린다 */
  | "drop";

/** 페이지 파일에 새 획 레코드를 뒤에 붙이고(위에 그려진다), 기존 획은 정책대로 처리한다. */
export function rewritePageWithStrokes(page: Uint8Array, newRecords: ReadonlyArray<Uint8Array>, policy: ExistingStrokePolicy = "keep"): Uint8Array {
  const items: PageItem[] = [];
  for (const it of readPageItems(page)) {
    if (it.type === "object" && it.object.kind === KIND_STROKE && policy !== "keep") {
      if (policy === "drop") continue;
      const obj = it.object;
      if (obj.meta && !obj.deleted) {
        const meta = replaceField(obj.meta, pbVarint(3, 1));
        items.push({ type: "object", object: { ...obj, meta, metaRecord: encodeMessage(meta), deleted: true } });
        continue;
      }
    }
    items.push(it);
  }
  const head = writePageItems(items);
  const tail = writeDelimitedRecords(newRecords);
  const out = new Uint8Array(head.length + tail.length);
  out.set(head);
  out.set(tail, head.length);
  return out;
}

/** 페이지에서 가장 큰 메타 f9(생성 순번). */
export function maxSequence(page: Uint8Array): number {
  let max = 0;
  for (const obj of pageObjects(page)) max = Math.max(max, fieldVarint(getField(obj.meta ?? [], 9)) ?? 0);
  return max;
}

/** 메타 레코드에서 장치 ID(f8)를 찾는다. */
export function firstDeviceId(page: Uint8Array): number | undefined {
  for (const obj of pageObjects(page)) {
    const d = fieldVarint(getField(obj.meta ?? [], 8));
    if (d !== undefined) return d;
  }
  return undefined;
}


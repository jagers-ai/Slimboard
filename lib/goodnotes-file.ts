// 펜 획을 굿노트 네이티브 파일(.goodnotes)의 볼펜, 만년필, 붓 획 레코드로 쓰는 순수 TS 모듈(진입점).
//
// 주 경로: buildGoodnotesDocument(견본 없이 문서 전체 생성, goodnotes-file-document.ts)
// 보조 경로: buildGoodnotesFromTemplate(사용자가 굿노트에서 내보낸 견본 파일의 한 페이지에 획을 덧붙임)
//
// 공식 형식 문서는 없다. 형식 사실 출처:
// - goodparse(GPL): 형식 사실만 참고, 코드 미사용.
// - Kaih1825/parser-for-goodnotes (MIT)
// - LambertAlpha/natural-ink (MIT): 견본 없는 작성기. 생성 파일에서 지우개, 올가미, 저장 후 재열기 확인(2026-10-15, 앱 버전 미기록).
// - Taylor-Nilsen/goodnotes-codec (MIT): 실제 문서 206개 무손실 왕복, Mac용 Goodnotes 7.0.60에서 가져오기, 지우개, 올가미 확인.
// - 이 작업에서 macOS libcompression으로 bv41/bv4- 프레임을 실측했다(goodnotes-file-lz4.ts).
// 위 프로젝트의 코드를 줄 단위로 옮기지 않고 사실에 따라 새로 작성했다.
//
// 브라우저와 Node 24(type stripping)에서 돈다. enum, namespace, Buffer, 외부 패키지를 쓰지 않는다.
//
// 확실하지 않은 것(실기기, 특히 iPad 굿노트에서 확인 전)
// 1. 두 프로필(codec, natural-ink) 중 iPad 굿노트가 둘 다 받는지. 두 작성기의 실기기 기록은 Mac(codec)과 미기록(natural-ink)이다.
// 2. 페이지 단위: pt 그대로(natural-ink)와 6/11 pt(굿노트 자체 파일, codec) 중 어느 쪽이 화면 크기와 펜 굵기가 자연스러운지.
// 3. 굵기 저장값의 뜻: 페이지 단위 지름(natural-ink, codec)인지, 6/11 배율 파일에서 0.5 pt/값(goodparse 측정, 약 8% 차이)인지.
// 4. 메타 f2 버전 도장의 두 번째 값: 임의 태그(codec)인지 해시(goodparse)인지. 굿노트가 검증하지 않는 것으로 보인다(두 작성기 모두 열림).
// 5. 메타 f14(5381 또는 1), f8 장치 ID, 본문 f7/f15 도장의 정확한 뜻. 두 작성기의 값이 다르지만 둘 다 열렸다.
// 6. 경계 상자: 획 레코드에 경계 상자 필드가 있다는 자료는 없다. 굿노트가 경로에서 계산하는 것으로 보인다.
// 7. thumbnail.jpg, index.search.pb, document.info.pb 생략 가능 여부(codec은 thumbnail.jpg와 index.search.pb 없이 Mac에서 열림).
// 8. stored(무압축) ZIP 허용 여부. 기본은 deflate.
// 9. 진짜 LZ4 압축 청크와 리터럴 청크 모두 열린다는 기록이 있으나 bv4-(무압축 청크)를 굿노트가 받는지는 모른다.
// 10. 견본 방식에서 획을 덧붙인 뒤 index.events.pb의 notes 버전 이벤트(105/104/102)가 꼭 필요한지(codec은 저장 때 덧붙인다).
// 11. 견본 페이지의 썸네일은 갱신하지 않는다(굿노트가 다시 만드는지 모른다).

import { type PbField, fieldMessage, fieldNumber, fieldString, getField, readDelimitedRecords, tryDecodeMessage, writeDelimitedRecords } from "./goodnotes-file-protobuf.ts";
import { type AppleLz4Mode } from "./goodnotes-file-lz4.ts";
import { type LineControl, type Point } from "./goodnotes-file-tpl.ts";
import { type ExistingStrokePolicy, type PageObject, cloneStrokeRecords, codecStrokeRecords, firstDeviceId, isPlainBallpointStroke, maxSequence, pageObjects, rewritePageWithStrokes } from "./goodnotes-file-page.ts";
import { type GoodnotesStroke, GOODNOTES_UNITS_PER_PT, goodnotesStrokeBlob, notesGroupEvents, strokePenType } from "./goodnotes-file-document.ts";
import { seededInt, sha1Hex, uuidPlus, uuidV5 } from "./goodnotes-file-ids.ts";
import { type ZipEntry, type ZipWriteInput, ZIP_DEFLATE, readZip, writeZip, zipEntryData } from "./goodnotes-file-zip.ts";

export * from "./goodnotes-file-protobuf.ts";
export * from "./goodnotes-file-lz4.ts";
export * from "./goodnotes-file-zip.ts";
export * from "./goodnotes-file-tpl.ts";
export * from "./goodnotes-file-ids.ts";
export * from "./goodnotes-file-assets.ts";
export * from "./goodnotes-file-page.ts";
export * from "./goodnotes-file-document.ts";

// ---------------------------------------------------------------------------
// 좌표 변환

export type FitTransform = { scale: number; offsetX: number; offsetY: number };

/**
 * 사진 픽셀 좌표(폭 W, 높이 H)를 페이지 좌표에 비율을 유지해 맞추는 변환.
 * 기본 정렬은 왼쪽 위다. 가로 사진을 세로 페이지에 넣으면 위쪽에 붙고 아래가 비는데, 노트에서는 그 빈 곳에
 * 이어 쓰기 좋고, 페이지 크기가 달라도 원점이 같은 곳에 남아 위치를 맞추기 쉽다. align "center"도 고를 수 있다.
 */
export function fitPhotoToPage(
  photo: { width: number; height: number },
  page: { width: number; height: number },
  options: { align?: "top-left" | "center"; margin?: number } = {},
): FitTransform {
  if (!(photo.width > 0 && photo.height > 0 && page.width > 0 && page.height > 0)) throw new Error("FIT_BAD_SIZE");
  const margin = options.margin ?? 0;
  const availW = page.width - 2 * margin;
  const availH = page.height - 2 * margin;
  if (!(availW > 0 && availH > 0)) throw new Error("FIT_MARGIN_TOO_LARGE");
  const scale = Math.min(availW / photo.width, availH / photo.height);
  if (options.align === "center") {
    return { scale, offsetX: margin + (availW - photo.width * scale) / 2, offsetY: margin + (availH - photo.height * scale) / 2 };
  }
  return { scale, offsetX: margin, offsetY: margin };
}

export function applyFit(points: ReadonlyArray<Point>, t: FitTransform): Point[] {
  return points.map(([x, y]) => [t.offsetX + x * t.scale, t.offsetY + y * t.scale] as const);
}

/** 사진 좌표 획들을 페이지 좌표 획들로 바꾼다. 굵기(볼펜 width, 만년필과 붓의 점마다 widths)도 같은 배율로 바꾼다. */
export function strokesToPage<T extends { points: ReadonlyArray<Point>; width?: number; widths?: ReadonlyArray<number> }>(strokes: ReadonlyArray<T>, t: FitTransform): Array<T & { points: Point[] }> {
  return strokes.map(s => {
    const out: T & { points: Point[] } = { ...s, points: applyFit(s.points, t) };
    if (s.width !== undefined) out.width = s.width * t.scale;
    if (s.widths !== undefined) out.widths = s.widths.map(w => w * t.scale);
    return out;
  });
}

/** pt 크기를 굿노트 페이지 단위로(굿노트 자체 파일의 배율 11/6). */
export function ptToGoodnotesUnits(pt: number): number {
  return pt * GOODNOTES_UNITS_PER_PT;
}

// ---------------------------------------------------------------------------
// 견본 문서 읽기

export type TemplatePage = {
  pageId: string | null;
  noteId: string;
  orderKey: string | null;
  /** 종이 이벤트 f8의 페이지 크기(페이지 단위) */
  size: { width: number; height: number } | null;
};

type EventRecord = { target: string; kind: number; body: PbField[] };

function readEvents(data: Uint8Array | undefined): EventRecord[] {
  if (!data) return [];
  const out: EventRecord[] = [];
  for (const rec of readDelimitedRecords(data)) {
    const fields = tryDecodeMessage(rec);
    if (!fields) continue;
    const target = fieldString(getField(fields, 1));
    const other = fields.find(f => f.number !== 1);
    if (!target || !other) continue;
    const body = fieldMessage(other);
    if (body) out.push({ target, kind: other.number, body });
  }
  return out;
}

/** {1 값, 2 도장} 레지스터의 문자열 값 */
function lwwString(field: PbField | undefined): string | null {
  const msg = fieldMessage(field);
  return msg ? (fieldString(getField(msg, 1)) ?? null) : null;
}

/**
 * 견본의 페이지를 화면 순서로 나열한다. 순서는 페이지 이벤트(54)의 순서 키(ASCII 비교, goodnotes-codec)이고,
 * 잉크 파일은 notes/<페이지 ID + 1>(goodnotes-codec), 없으면 앞 32글자가 같은 notes 파일(goodparse)이다.
 * 이벤트가 없으면 index.notes.pb 순서를 쓴다(goodnotes-codec는 이것을 생성 순서라고 적었다).
 */
export function listTemplatePages(files: { notesIndex?: Uint8Array; events?: Uint8Array; names: ReadonlyArray<string> }): TemplatePage[] {
  const noteNames = new Set(files.names.filter(n => n.startsWith("notes/")).map(n => n.slice(6)));
  const indexed: string[] = [];
  if (files.notesIndex) {
    for (const rec of readDelimitedRecords(files.notesIndex)) {
      const id = fieldString(getField(tryDecodeMessage(rec) ?? [], 1));
      if (id && noteNames.has(id) && !indexed.includes(id)) indexed.push(id);
    }
  }
  const events = readEvents(files.events);
  const layerSize = new Map<string, { width: number; height: number }>();
  for (const e of events) {
    if (e.kind !== 2) continue;
    const layer = fieldString(getField(e.body, 2)) ?? e.target;
    const size = fieldMessage(getField(e.body, 8));
    if (!size) continue;
    const w = fieldNumber(getField(size, 1)) ?? 0;
    const h = fieldNumber(getField(size, 2)) ?? 0;
    if (w > 0 && h > 0) layerSize.set(layer, { width: w, height: h });
  }
  const pages = new Map<string, { key: string | null; layer: string | null }>();
  for (const e of events) {
    if (e.kind !== 54) continue;
    const pageId = fieldString(getField(e.body, 2));
    if (!pageId) continue;
    const prev = pages.get(pageId) ?? { key: null, layer: null };
    pages.set(pageId, { key: lwwString(getField(e.body, 4)) ?? prev.key, layer: lwwString(getField(e.body, 3)) ?? prev.layer });
  }
  const findNote = (pageId: string): string | null => {
    const plus = uuidPlus(pageId, 1);
    if (noteNames.has(plus)) return plus;
    for (const n of noteNames) if (n.slice(0, 32).toUpperCase() === pageId.slice(0, 32).toUpperCase()) return n;
    return null;
  };
  const ordered = [...pages.entries()].sort(([, a], [, b]) => ((a.key ?? "") < (b.key ?? "") ? -1 : (a.key ?? "") > (b.key ?? "") ? 1 : 0));
  const out: TemplatePage[] = [];
  for (const [pageId, info] of ordered) {
    const noteId = findNote(pageId);
    if (!noteId) continue;
    out.push({ pageId, noteId, orderKey: info.key, size: info.layer ? layerSize.get(info.layer) ?? null : null });
  }
  for (const noteId of indexed) if (!out.some(p => p.noteId === noteId)) out.push({ pageId: null, noteId, orderKey: null, size: null });
  return out;
}

// ---------------------------------------------------------------------------
// 견본 방식

export type BuildFromTemplateInput = {
  /** 굿노트에서 내보낸 .goodnotes 견본 */
  template: Uint8Array;
  /** 넣을 획(페이지 단위 좌표). 사진 좌표는 fitPhotoToPage와 strokesToPage로 먼저 바꾼다. */
  pageStrokes: ReadonlyArray<GoodnotesStroke>;
  /** 화면 순서 기준 페이지 번호(0부터). 기본 0. */
  pageIndex?: number;
  /** 기존 획 처리. 기본 "keep". */
  existingStrokes?: ExistingStrokePolicy;
  pathEncoding?: AppleLz4Mode;
  lineControl?: LineControl;
  idSeed?: string;
  createdAt?: Date;
  /** notes 버전 이벤트(105/104/102)를 덧붙인다. 기본 true(goodnotes-codec 저장 방식). */
  updateNotesEvents?: boolean;
};

export type BuildFromTemplateResult = {
  bytes: Uint8Array;
  page: TemplatePage;
  /** 본보기로 복제한 견본 획 ID. 없으면 codec 방식 레코드를 새로 만들었다. */
  exemplarId: string | null;
  strokeIds: string[];
};

async function memberData(entries: ReadonlyArray<ZipEntry>, name: string): Promise<Uint8Array | undefined> {
  const e = entries.find(x => x.name === name);
  return e ? zipEntryData(e) : undefined;
}

/**
 * 견본 .goodnotes의 한 페이지에 획(볼펜, 만년필, 붓)을 덧붙인다. 다른 ZIP 멤버는 압축 데이터를 그대로 복사한다.
 * 견본에 평범한 볼펜 획이 있으면 그것을 본보기로 복제하고(뜻 모르는 필드 유지), 없으면 goodnotes-codec 방식 레코드를 만든다.
 */
export async function buildGoodnotesFromTemplate(input: BuildFromTemplateInput): Promise<BuildFromTemplateResult> {
  const entries = readZip(input.template);
  const names = entries.map(e => e.name);
  if (!names.includes("index.events.pb") && !names.includes("index.notes.pb")) throw new Error("TEMPLATE_NOT_GOODNOTES no index.events.pb or index.notes.pb");
  const eventsData = await memberData(entries, "index.events.pb");
  const pages = listTemplatePages({ notesIndex: await memberData(entries, "index.notes.pb"), events: eventsData, names });
  if (pages.length === 0) throw new Error("TEMPLATE_HAS_NO_PAGES");
  const page = pages[input.pageIndex ?? 0];
  if (!page) throw new Error(`TEMPLATE_PAGE_OUT_OF_RANGE ${input.pageIndex}`);

  const pageFiles = new Map<string, Uint8Array>();
  for (const p of pages) pageFiles.set(p.noteId, (await memberData(entries, `notes/${p.noteId}`)) ?? new Uint8Array(0));
  let exemplar: PageObject | null = null;
  let sequence = 0;
  let device: number | undefined;
  for (const data of pageFiles.values()) {
    sequence = Math.max(sequence, maxSequence(data));
    device ??= firstDeviceId(data);
    exemplar ??= pageObjects(data).find(isPlainBallpointStroke) ?? null;
  }
  const seed = input.idSeed ?? sha1Hex(`${input.template.length}:${JSON.stringify(input.pageStrokes)}`);
  device ??= seededInt(seed, "device", 53) || 1;
  const docId = readEvents(eventsData).find(e => e.kind === 30)?.target ?? null;

  const records: Uint8Array[] = [];
  const strokeIds: string[] = [];
  input.pageStrokes.forEach((stroke, si) => {
    const id = uuidV5(`slimboard:${seed}:stroke-${si}`);
    strokeIds.push(id);
    const blob = goodnotesStrokeBlob(stroke, { lineControl: input.lineControl ?? "midpoint", mode: input.pathEncoding ?? "literal" });
    const color = stroke.color.length === 3 ? ([stroke.color[0], stroke.color[1], stroke.color[2], 1] as const) : (stroke.color as readonly [number, number, number, number]);
    sequence += 1;
    const common = { id, blob, color, highlighter: stroke.highlighter, penType: strokePenType(stroke), sequence, tag: seededInt(seed, `tag-${si}`, 32), tag2: seededInt(seed, `tag2-${si}`, 32) };
    records.push(...(exemplar ? cloneStrokeRecords(exemplar, common) : codecStrokeRecords({ ...common, device: device! })));
  });
  const newPage = rewritePageWithStrokes(pageFiles.get(page.noteId)!, records, input.existingStrokes ?? "keep");

  let newEvents: Uint8Array | null = null;
  if ((input.updateNotesEvents ?? true) && eventsData && docId && input.pageStrokes.length > 0) {
    let n = 0;
    const now = (input.createdAt ?? new Date()).getTime();
    const extra = notesGroupEvents({
      docId,
      noteId: page.noteId,
      version: seededInt(seed, "notes-version", 53) || 1,
      device,
      now,
      nextEventId: () => uuidV5(`slimboard:${seed}:event-${n++}`),
      jitter: () => seededInt(seed, `jitter-${n}`, 8),
    });
    newEvents = new Uint8Array(eventsData.length + writeDelimitedRecords(extra).length);
    newEvents.set(eventsData);
    newEvents.set(writeDelimitedRecords(extra), eventsData.length);
  }

  const date = input.createdAt ?? new Date();
  const writes: ZipWriteInput[] = entries.map(e => {
    if (e.name === `notes/${page.noteId}`) return { name: e.name, data: newPage, method: ZIP_DEFLATE, date };
    if (newEvents && e.name === "index.events.pb") return { name: e.name, data: newEvents, method: ZIP_DEFLATE, date };
    return { name: e.name, copy: e };
  });
  if (!names.includes(`notes/${page.noteId}`)) writes.push({ name: `notes/${page.noteId}`, data: newPage, method: ZIP_DEFLATE, date });
  return { bytes: await writeZip(writes), page, exemplarId: exemplar?.id ?? null, strokeIds };
}

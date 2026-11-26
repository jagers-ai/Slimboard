// 견본 없이 .goodnotes 문서 전체를 만든다.
//
// 형식 사실 출처: LambertAlpha/natural-ink (MIT), Taylor-Nilsen/goodnotes-codec (MIT).
// 두 프로젝트의 코드를 옮기지 않고, 문서와 소스에서 읽은 형식 사실에 따라 TS로 새로 작성했다.
// 두 작성기 모두 생성 파일을 실제 굿노트에서 열고 지우개와 올가미를 썼다고 기록했다
// (natural-ink: 2026-10-15, 앱 버전 미기록 / goodnotes-codec: Mac용 Goodnotes 7.0.60).
// 아래 "프로필"은 두 작성기가 쓰는 레코드와 이벤트 세트를 그대로 따른 것이다. 어느 것도 공식 형식이 아니다.
//
// 프로필 비교
// | 항목              | "natural-ink"                         | "codec" (기본)                                   |
// |-------------------|---------------------------------------|-------------------------------------------------|
// | schema.pb         | {1 24}                                | {1 24}                                          |
// | 멤버              | schema, document.info, index.search,  | schema, document.info, index.notes,             |
// |                   | index.notes, index.attachments,       | index.attachments, index.events, attachments/*, |
// |                   | index.events, notes/*, attachments/*, | notes/* (index.search.pb, thumbnail.jpg 없음)    |
// |                   | thumbnail.jpg (이름순 정렬)            |                                                 |
// | 이벤트            | 문서 30, 첨부 6, 종이 2, 페이지 54      | 문서 30, 첨부 6 + 105, 종이 2, 페이지 54,          |
// |                   |                                       | notes 105/104/102, 현재 페이지 10                |
// | 획 메타 f2/f8/f14 | {1 1, 2 순번} / 1 / 1                  | {1 1, 2 임의 32비트} / 장치 ID / 5381             |
// | 직선 제어점        | 구간 시작점                             | 구간 중점                                        |
// | 배경 PDF 크기      | 페이지 크기와 같음                      | 페이지 크기의 6/11 (굿노트 자체 파일과 같음)        |
// | 순서 키           | "A000000", "A000001", …               | "40", "41", … (PR #16 규칙)                      |
// | ZIP 시각          | 2026-01-01 00:00:00 고정               | createdAt                                       |
//
// 좌표와 굵기 단위
// 획 좌표, 페이지 크기, 굵기는 모두 "페이지 단위"로 받는다(페이지 왼쪽 위 원점, y 아래 방향).
// 페이지 단위와 pt의 관계는 종이 이벤트 f8의 페이지 크기와 배경 PDF 크기의 비율로 정해진다.
// - 굿노트가 직접 만든 파일: 페이지 단위 = 6/11 pt (A4 = 1091.34 × 1543.47 단위, PDF 595.28 × 841.89 pt).
//   goodparse(참조 PDF 비교), parser-for-goodnotes(72/132), goodnotes-codec(paper.SCALE = 11/6) 모두 같은 관찰.
// - natural-ink: 페이지 크기를 pt 그대로 쓰고 PDF도 같은 크기로 만든다(단위 = 1 pt).
// 어느 쪽으로 써야 굿노트에서 펜 굵기와 화면 크기가 자연스러운지는 실기기 비교로 정한다(시험 파일 A와 C).
// 굵기 저장값은 페이지 단위 지름으로 본다(natural-ink, goodnotes-codec). goodparse는 6/11 배율 파일에서
// 저장값 1이 0.5 pt(= 11/12 단위)로 그려졌다고 측정했다. 차이는 약 8%이며 실기기에서 확인할 항목이다.
//
// 모르는 점
// - thumbnail.jpg가 없어도 열리는지: goodnotes-codec의 Document.new는 쓰지 않고도 열렸다고 기록했다(Mac).
//   iPad에서 같은지는 모른다.
// - stored ZIP을 굿노트가 받는지: 두 작성기 모두 deflate로만 시험했다. 기본은 deflate다.
// - 배경 첨부 없는 페이지: 두 작성기 모두 페이지마다 종이 PDF를 둔다. 첨부 없는 페이지는 만들지 않는다.
// - index.search.pb 없이도 되는지: codec 프로필이 그 경우다(Mac에서 열림).

import {
  type PbField,
  encodeMessage,
  pbBytes,
  pbFloat32,
  pbFloat64,
  pbMessage,
  pbString,
  pbVarint,
  writeDelimitedRecords,
} from "./goodnotes-file-protobuf.ts";
import { type AppleLz4Mode, appleLz4Encode } from "./goodnotes-file-lz4.ts";
import {
  type BrushQuadOrder,
  type LineControl,
  type Point,
  type VariableGeometryOptions,
  buildVariablePen,
  encodeUniformPenTpl,
  encodeVariablePenTpl,
  polylineToLinePath,
} from "./goodnotes-file-tpl.ts";
import { type PdfGuide, buildSolidJpeg, buildSolidPdf } from "./goodnotes-file-assets.ts";
import { type Rgba, GOODNOTES_SCHEMA_VERSION, codecStrokeRecords, naturalInkStrokeRecords, stampMessage } from "./goodnotes-file-page.ts";
import { naturalInkOrderKey, orderKeys, seededInt, sha1, sha1Hex, toHex, uuidEven, uuidPlus, uuidV5 } from "./goodnotes-file-ids.ts";
import { ZIP_DEFLATE, ZIP_STORED, writeZip } from "./goodnotes-file-zip.ts";

/** 굿노트 페이지 단위 / pt (goodnotes-codec paper.SCALE, goodparse 6/11의 역수) */
export const GOODNOTES_UNITS_PER_PT = 11 / 6;
/** A4 세로(pt) */
export const A4_PT = { width: (210 * 72) / 25.4, height: (297 * 72) / 25.4 } as const;

export type GoodnotesProfile = "codec" | "natural-ink";

/** 볼펜(균일 굵기) 획. pen을 생략하면 볼펜이다. */
export type GoodnotesBallpointStroke = {
  pen?: "ballpoint";
  /** 페이지 단위 좌표(왼쪽 위 원점, y 아래). 점 하나면 아주 짧은 구간으로 쓴다. */
  points: ReadonlyArray<Point>;
  /** 0~1 RGB 또는 RGBA */
  color: readonly [number, number, number] | Rgba;
  /** 굵기 저장값(페이지 단위 지름) */
  width: number;
  highlighter?: boolean;
};

/**
 * 만년필이나 붓(가변 굵기) 획. 굵기 단위: 점마다 페이지 단위 지름을 받아 반폭(지름 / 2)으로 저장한다.
 * goodparse는 참조 PDF와 비교해 가변 굵기 펜이 저장 반폭의 두 배(페이지 단위)로 그려진다고 측정했다
 * (붉은 테이프 반폭 9.0 → 9.83pt, 6/11 배율). 볼펜 저장값의 0.5pt/값 같은 보정은 없다.
 * 점 하나면 원 하나(아주 짧은 구간)로 쓴다. lib/ink-medial-strokes.ts의 { points, widths }에 pen만 붙이면 된다.
 */
export type GoodnotesVariableStroke = {
  pen: "fountain" | "brush";
  points: ReadonlyArray<Point>;
  /** 점마다 지름(페이지 단위). points와 길이가 같다. */
  widths: ReadonlyArray<number>;
  color: readonly [number, number, number] | Rgba;
  highlighter?: boolean;
  /** 본문 f3 펜 종류. 기본 만년필 1, 붓 4(codec). inkterop은 붓도 1로 관찰했다. 실기기 비교용. */
  penType?: number;
  /** 붓 quad 값 순서(실기기 비교용). 기본 "goodparse". */
  brushQuadOrder?: BrushQuadOrder;
  /** 붓 기본 반폭 저장값. 기본 -1(goodparse 관찰). codec 생성기는 2 × max(반폭). */
  brushDefaultRadius?: number;
  geometry?: VariableGeometryOptions;
};

export type GoodnotesStroke = GoodnotesBallpointStroke | GoodnotesVariableStroke;

export function isVariableStroke(stroke: GoodnotesStroke): stroke is GoodnotesVariableStroke {
  return stroke.pen === "fountain" || stroke.pen === "brush";
}

/** 본문 f3에 쓸 펜 종류(볼펜은 undefined). */
export function strokePenType(stroke: GoodnotesStroke): number | undefined {
  if (!isVariableStroke(stroke)) return undefined;
  return stroke.penType ?? (stroke.pen === "brush" ? 4 : 1);
}

/** 획 하나의 경로 blob(Apple LZ4로 감싼 tpl). */
export function goodnotesStrokeBlob(stroke: GoodnotesStroke, options: { lineControl?: LineControl; mode?: AppleLz4Mode } = {}): Uint8Array {
  const mode = options.mode ?? "literal";
  if (isVariableStroke(stroke)) {
    const pen = buildVariablePen(stroke.pen, stroke.points, stroke.widths, stroke.geometry);
    const tpl = encodeVariablePenTpl({ ...pen, defaultRadius: stroke.brushDefaultRadius ?? undefined, brushQuadOrder: stroke.brushQuadOrder });
    return appleLz4Encode(tpl, { mode });
  }
  const path = polylineToLinePath(stroke.points, options.lineControl ?? "midpoint");
  return appleLz4Encode(encodeUniformPenTpl({ width: stroke.width, subpaths: [path] }), { mode });
}

export type GoodnotesPageInput = {
  /** 페이지 크기(페이지 단위) */
  width: number;
  height: number;
  strokes: ReadonlyArray<GoodnotesStroke>;
  /** 단색 배경. backgroundPdf가 있으면 쓰지 않는다. */
  background?: {
    /** 0~1 RGB, 기본 흰색 */
    color?: readonly [number, number, number];
    /** 배경 PDF 크기 / 페이지 크기(pt/단위). 기본: codec 6/11, natural-ink 1. */
    pdfScale?: number;
    /** 시험용 안내선(페이지 단위 좌표와 굵기). 획과 겹치는지 비교하는 데 쓴다. */
    guides?: ReadonlyArray<PdfGuide>;
  };
  /** 이 PDF를 배경 첨부로 그대로 넣는다(예: 사진을 감싼 PDF). 크기는 페이지와 비율이 맞아야 한다(굿노트가 늘려 그린다). */
  backgroundPdf?: Uint8Array;
  /** backgroundPdf에서 쓸 쪽(1부터). 기본 1. */
  backgroundPdfPage?: number;
};

export type BuildGoodnotesDocumentInput = {
  title: string;
  pages: ReadonlyArray<GoodnotesPageInput>;
  profile?: GoodnotesProfile;
  /** 식별자 시드. 같은 시드와 입력이면 같은 파일이 나온다. 앱에서는 crypto.randomUUID()를 넘기기를 권한다. */
  idSeed?: string;
  /** 이벤트 시각. 기본 지금. */
  createdAt?: Date;
  zipMethod?: "deflate" | "stored";
  /** 경로 blob 청크 방식. 기본 "literal"(goodnotes-codec, Mac 굿노트에서 확인). */
  pathEncoding?: AppleLz4Mode;
  /** 직선 구간 제어점. 기본은 프로필을 따른다. */
  lineControl?: LineControl;
  /** 썸네일 JPEG. undefined면 프로필 기본(natural-ink는 흰 JPEG, codec은 생략), null이면 생략. */
  thumbnailJpeg?: Uint8Array | null;
};

// ---------------------------------------------------------------------------
// 공통 도우미

const EMPTY = new Uint8Array(0);

function rgba(color: GoodnotesStroke["color"]): Rgba {
  return color.length === 3 ? [color[0], color[1], color[2], 1] : (color as Rgba);
}

/** 크기 {1 w, 2 h} (float32). 0은 생략(goodnotes-codec write_point). */
function sizeMessage(w: number, h: number, dropZero: boolean): PbField[] {
  const out: PbField[] = [];
  if (!dropZero || w) out.push(pbFloat32(1, w));
  if (!dropZero || h) out.push(pbFloat32(2, h));
  return out;
}

/** last-writer-wins 레지스터 {1 값, 2 도장} */
function lww(value: PbField | null, stamp: PbField[]): PbField[] {
  return value ? [value, pbMessage(2, stamp)] : [pbMessage(2, stamp)];
}

/** PDF 쪽 수(goodnotes-codec와 같은 근사: "/Type /Page" 객체 수). */
function countPdfPages(pdf: Uint8Array): number {
  let text = "";
  for (let i = 0; i < pdf.length; i += 1) text += String.fromCharCode(pdf[i]);
  return (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length || 1;
}

function validateInput(input: BuildGoodnotesDocumentInput): void {
  if (input.pages.length === 0) throw new Error("GOODNOTES_NO_PAGES");
  input.pages.forEach((p, pi) => {
    if (!(p.width > 0 && p.height > 0 && Number.isFinite(p.width) && Number.isFinite(p.height))) throw new Error(`GOODNOTES_BAD_PAGE_SIZE page ${pi}`);
    if (p.backgroundPdf && !(p.backgroundPdf[0] === 0x25 && p.backgroundPdf[1] === 0x50 && p.backgroundPdf[2] === 0x44 && p.backgroundPdf[3] === 0x46)) {
      throw new Error(`GOODNOTES_BACKGROUND_NOT_PDF page ${pi}`);
    }
    p.strokes.forEach((s, si) => {
      if (s.points.length === 0) throw new Error(`GOODNOTES_EMPTY_STROKE page ${pi} stroke ${si}`);
      if (isVariableStroke(s)) {
        if (s.widths.length !== s.points.length) throw new Error(`GOODNOTES_WIDTHS_LENGTH page ${pi} stroke ${si}`);
        for (const w of s.widths) if (!(w > 0 && Number.isFinite(w))) throw new Error(`GOODNOTES_BAD_WIDTH page ${pi} stroke ${si}`);
      } else if (!(s.width > 0 && Number.isFinite(s.width))) throw new Error(`GOODNOTES_BAD_WIDTH page ${pi} stroke ${si}`);
      for (const [x, y] of s.points) if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`GOODNOTES_BAD_POINT page ${pi} stroke ${si}`);
    });
  });
}

/** 입력 요약의 SHA-1(기본 시드). natural-ink는 직렬화한 문서의 SHA-256을 쓴다. */
function inputDigest(input: BuildGoodnotesDocumentInput): string {
  const summary = {
    title: input.title,
    profile: input.profile ?? "codec",
    pages: input.pages.map(p => ({
      w: p.width,
      h: p.height,
      bg: p.background ?? null,
      pdf: p.backgroundPdf ? toHex(sha1(p.backgroundPdf)) : null,
      pdfPage: p.backgroundPdfPage ?? 1,
      strokes: p.strokes,
    })),
  };
  return sha1Hex(JSON.stringify(summary));
}

function strokeBlob(stroke: GoodnotesStroke, lineControl: LineControl, mode: AppleLz4Mode): Uint8Array {
  return goodnotesStrokeBlob(stroke, { lineControl, mode });
}

type Paper = { pdf: Uint8Array; pdfPage: number; width: number; height: number; key: string };

function paperFor(page: GoodnotesPageInput, defaultScale: number): Paper {
  if (page.backgroundPdf) {
    return { pdf: page.backgroundPdf, pdfPage: page.backgroundPdfPage ?? 1, width: page.width, height: page.height, key: `pdf:${toHex(sha1(page.backgroundPdf))}:${page.backgroundPdfPage ?? 1}:${page.width}x${page.height}` };
  }
  const bg = page.background ?? {};
  const scale = bg.pdfScale ?? defaultScale;
  const guides = (bg.guides ?? []).map(g => ({ ...g, width: g.width * scale, points: g.points.map(([x, y]) => [x * scale, y * scale] as const) }));
  const pdf = buildSolidPdf({ width: page.width * scale, height: page.height * scale, color: bg.color, guides });
  return { pdf, pdfPage: 1, width: page.width, height: page.height, key: `solid:${toHex(sha1(pdf))}:${page.width}x${page.height}` };
}

type Member = { name: string; data: Uint8Array };

async function zipMembers(members: Member[], method: "deflate" | "stored", date: Date): Promise<Uint8Array> {
  const zm = method === "stored" ? ZIP_STORED : ZIP_DEFLATE;
  return writeZip(members.map(m => ({ name: m.name, data: m.data, method: zm, date })));
}

// ---------------------------------------------------------------------------
// natural-ink 프로필

async function buildNaturalInk(input: BuildGoodnotesDocumentInput, seed: string): Promise<Uint8Array> {
  const id = (label: string) => uuidV5(`slimboard:${seed}:${label}`);
  const lineControl = input.lineControl ?? "start";
  const mode = input.pathEncoding ?? "literal";
  // clock(c) = {1 1, 2 c}, wrapped(v) = {1 v, 2 clock(1)} (natural-ink 관찰)
  const clock = (c: number) => stampMessage(1, c);
  const wrapped = (v: string) => [pbString(1, v), pbMessage(2, clock(1))];
  const docId = id("document");
  const first = input.pages[0];
  const orientation = first.width <= first.height ? "P" : "L"; // natural-ink는 항상 "P". 가로 페이지를 위해 codec처럼 고른다.
  const events: Uint8Array[] = [
    encodeMessage([
      pbString(1, docId),
      pbMessage(30, [
        pbString(1, docId),
        pbMessage(2, wrapped(input.title)),
        pbMessage(6, wrapped(orientation)),
        pbString(9, "auto"),
        pbString(11, id("document-event")),
        pbVarint(13, 1),
        pbVarint(14, 1),
        pbVarint(20, GOODNOTES_SCHEMA_VERSION),
      ]),
    ]),
  ];
  const members = new Map<string, Uint8Array>();
  members.set("schema.pb", encodeMessage([pbVarint(1, GOODNOTES_SCHEMA_VERSION)]));
  members.set("document.info.pb", EMPTY);
  members.set("index.search.pb", EMPTY);
  const notesIndex: Uint8Array[] = [];
  const attachmentsIndex: Uint8Array[] = [];
  input.pages.forEach((page, pi) => {
    const pageId = uuidEven(id(`page-${pi}`));
    const noteId = uuidPlus(pageId, 1);
    const attachmentId = id(`background-${pi}`);
    const templateId = id(`template-${pi}`);
    const paper = paperFor(page, 1);
    members.set(`attachments/${attachmentId}`, paper.pdf);
    attachmentsIndex.push(encodeMessage([pbString(1, attachmentId), pbString(2, `attachments/${attachmentId}`)]));
    notesIndex.push(encodeMessage([pbString(1, noteId), pbString(2, `notes/${noteId}`)]));
    const attachment = [
      pbString(1, attachmentId),
      pbString(2, attachmentId),
      pbVarint(5, paper.pdf.length),
      pbString(6, docId),
      pbString(11, id(`attach-event-${pi}`)),
      pbMessage(12, clock(1)),
      pbVarint(14, 1),
      pbVarint(15, 1),
      pbVarint(16, GOODNOTES_SCHEMA_VERSION),
    ];
    const template = [
      pbString(1, docId),
      pbString(2, templateId),
      pbString(4, attachmentId),
      pbVarint(5, paper.pdfPage),
      pbVarint(6, 1),
      pbMessage(8, sizeMessage(page.width, page.height, false)),
      pbString(9, "Slimboard paper"),
      pbString(11, id(`template-event-${pi}`)),
      pbVarint(15, 1),
      pbVarint(16, 1),
      pbVarint(21, GOODNOTES_SCHEMA_VERSION),
    ];
    const pageEvent = [
      pbString(1, docId),
      pbString(2, pageId),
      pbMessage(3, wrapped(templateId)),
      pbMessage(4, wrapped(naturalInkOrderKey(pi))),
      pbString(11, id(`page-event-${pi}`)),
      pbVarint(13, 1),
      pbVarint(14, 1),
      pbVarint(15, GOODNOTES_SCHEMA_VERSION),
    ];
    events.push(
      encodeMessage([pbString(1, attachmentId), pbMessage(6, attachment)]),
      encodeMessage([pbString(1, templateId), pbMessage(2, template)]),
      encodeMessage([pbString(1, pageId), pbMessage(54, pageEvent)]),
    );
    const records: Uint8Array[] = [];
    page.strokes.forEach((stroke, si) => {
      records.push(
        ...naturalInkStrokeRecords({
          id: id(`stroke-${pi}-${si}`),
          blob: strokeBlob(stroke, lineControl, mode),
          color: rgba(stroke.color),
          highlighter: stroke.highlighter,
          penType: strokePenType(stroke),
          counter: si + 1,
        }),
      );
    });
    members.set(`notes/${noteId}`, writeDelimitedRecords(records));
  });
  members.set("index.notes.pb", writeDelimitedRecords(notesIndex));
  members.set("index.attachments.pb", writeDelimitedRecords(attachmentsIndex));
  members.set("index.events.pb", writeDelimitedRecords(events));
  const thumb =
    input.thumbnailJpeg === undefined
      ? buildSolidJpeg(Math.max(1, Math.round(first.width * 0.5)), Math.max(1, Math.round(first.height * 0.5)), 255)
      : input.thumbnailJpeg;
  if (thumb) members.set("thumbnail.jpg", thumb);
  const sorted = [...members.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, data]) => ({ name, data }));
  // natural-ink: ZIP 시각 2026-01-01 00:00:00 고정, 이름순, deflate (natural-ink 관찰, 공식 아님)
  return zipMembers(sorted, input.zipMethod ?? "deflate", new Date(Date.UTC(2026, 0, 1)));
}

// ---------------------------------------------------------------------------
// goodnotes-codec 프로필

async function buildCodec(input: BuildGoodnotesDocumentInput, seed: string): Promise<Uint8Array> {
  const id = (label: string) => uuidV5(`slimboard:${seed}:${label}`);
  const rand32 = (label: string) => seededInt(seed, label, 32);
  const lineControl = input.lineControl ?? "midpoint";
  const mode = input.pathEncoding ?? "literal";
  const createdAt = input.createdAt ?? new Date();
  const now = createdAt.getTime();
  // goodnotes-codec는 63비트 임의 장치 ID를 쓴다. JS number로 정확히 다룰 수 있는 53비트 범위에서 뽑는다(0 제외).
  const device = seededInt(seed, "device", 53) || 1;
  let stampCount = 0;
  const stamp = () => stampMessage(1, rand32(`stamp-${stampCount++}`));
  let eventCount = 0;
  const docId = id("document");

  // tail: {10 시각(ms, double), 11 이벤트 ID, 12 "", 13 장치, 14 정수 시각, <vf> 24} (Document.new의 tail)
  const tail = (versionField: number, withEmpty12 = true): PbField[] => [
    pbFloat64(10, now),
    pbString(11, id(`event-${eventCount++}`)),
    ...(withEmpty12 ? [pbBytes(12, EMPTY)] : []),
    pbVarint(13, device),
    pbVarint(14, Math.floor(now)),
    pbVarint(versionField, GOODNOTES_SCHEMA_VERSION),
  ];
  // _event: {10, 11, 13, 14 정수 시각 + 임의 8비트, 15 24}
  const eventTail = (): PbField[] => [
    pbFloat64(10, now),
    pbString(11, id(`event-${eventCount++}`)),
    pbVarint(13, device),
    pbVarint(14, Math.floor(now) + seededInt(seed, `jitter-${eventCount}`, 8)),
    pbVarint(15, GOODNOTES_SCHEMA_VERSION),
  ];
  const record = (target: string, kind: number, body: PbField[]) => encodeMessage([pbString(1, target), pbMessage(kind, body)]);

  const events: Uint8Array[] = [];
  const folder = id("folder");
  const first = input.pages[0];
  const created: PbField[] = [
    pbString(1, docId),
    pbMessage(2, lww(pbString(1, input.title), stamp())),
    pbMessage(3, lww(pbString(1, folder), stamp())),
    pbMessage(6, lww(pbString(1, first.width <= first.height ? "P" : "L"), stamp())),
    pbMessage(7, lww(pbString(1, folder), stamp())),
    pbString(9, "auto"),
    ...tail(20, false),
    pbBytes(17, EMPTY),
    pbBytes(18, EMPTY),
    pbMessage(19, [pbMessage(2, stamp())]),
  ].sort((a, b) => a.number - b.number);
  events.push(record(docId, 30, created));

  // 종이(배경)는 같은 내용이면 공유한다(Document.new는 문서 전체가 종이 하나를 쓴다).
  const papers = new Map<string, { attachmentId: string; templateId: string }>();
  const attachmentsIndex: Uint8Array[] = [];
  const attachmentMembers: Member[] = [];
  const pagePapers = input.pages.map(page => paperFor(page, 6 / 11));
  const standardW = 455.04 * GOODNOTES_UNITS_PER_PT;
  const standardH = 588.45 * GOODNOTES_UNITS_PER_PT;
  for (const paper of pagePapers) {
    if (papers.has(paper.key)) continue;
    const n = papers.size;
    const attachmentId = id(`attachment-${n}`);
    const templateId = id(`template-${n}`);
    papers.set(paper.key, { attachmentId, templateId });
    attachmentMembers.push({ name: `attachments/${attachmentId}`, data: paper.pdf });
    attachmentsIndex.push(encodeMessage([pbString(1, attachmentId), pbString(2, `attachments/${attachmentId}`)]));
    events.push(
      record(attachmentId, 6, [
        pbString(1, attachmentId),
        pbString(2, attachmentId),
        pbVarint(5, paper.pdf.length),
        pbString(6, docId),
        pbFloat64(10, now),
        pbString(11, id(`event-${eventCount++}`)),
        pbMessage(12, [pbVarint(1, 1), pbVarint(2, countPdfPages(paper.pdf))]), // pageRange {첫 쪽, 쪽 수}
        pbVarint(14, device),
        pbVarint(15, Math.floor(now)),
        pbVarint(16, GOODNOTES_SCHEMA_VERSION),
      ]),
      record(attachmentId, 105, [pbString(2, docId), pbString(3, attachmentId), ...eventTail()]),
    );
    const mx = (44 * paper.width) / standardW;
    const my = (58.6667 * paper.height) / standardH;
    const lineSpacing = 29.33333396911621; // 16 pt를 페이지 단위로(goodnotes-codec 관찰값)
    events.push(
      record(templateId, 2, [
        pbString(1, docId),
        pbString(2, templateId),
        pbString(4, attachmentId),
        pbVarint(5, paper.pdfPage),
        pbVarint(6, 1),
        pbFloat64(7, lineSpacing),
        pbMessage(8, sizeMessage(paper.width, paper.height, true)),
        pbFloat64(10, now),
        pbString(11, id(`event-${eventCount++}`)),
        pbMessage(12, [pbFloat64(1, lineSpacing), pbMessage(2, stamp())]),
        pbMessage(13, lww(pbVarint(1, 1), stamp())),
        pbVarint(15, device),
        pbVarint(16, Math.floor(now)),
        pbMessage(17, lww(pbVarint(1, 1), stamp())),
        pbMessage(18, [
          pbMessage(1, [pbMessage(1, sizeMessage(mx, my, true)), pbMessage(2, sizeMessage(paper.width - 2 * mx, paper.height - 2 * my, true))]),
          pbFloat32(2, 28.416668),
          pbFloat32(3, 0.9166667),
          pbVarint(5, 1),
        ]),
        pbMessage(19, [pbMessage(2, stamp())]),
        pbVarint(21, GOODNOTES_SCHEMA_VERSION),
      ]),
    );
  }

  const notesEvents = (noteId: string, version: number) => {
    events.push(
      ...notesGroupEvents({
        docId,
        noteId,
        version,
        device,
        now,
        nextEventId: () => id(`event-${eventCount++}`),
        jitter: () => seededInt(seed, `jitter-${eventCount}`, 8),
      }),
    );
  };

  const keys = orderKeys(input.pages.length);
  const notesIndex: Uint8Array[] = [];
  const noteMembers: Member[] = [];
  const pageIds: string[] = [];
  const noteIds: string[] = [];
  let sequence = 0;
  input.pages.forEach((page, pi) => {
    const pageId = uuidEven(id(`page-${pi}`));
    const noteId = uuidPlus(pageId, 1);
    pageIds.push(pageId);
    noteIds.push(noteId);
    const { templateId } = papers.get(pagePapers[pi].key)!;
    const canvas = [pbMessage(2, [pbMessage(1, [pbFloat32(1, 0.8667), pbFloat32(2, 0.8667), pbFloat32(3, 0.8667), pbFloat32(4, 1)]), pbMessage(2, [pbFloat32(1, 1), pbFloat32(2, 1), pbFloat32(3, 1), pbFloat32(4, 1)])])];
    events.push(
      record(pageId, 54, [
        pbString(1, docId),
        pbString(2, pageId),
        pbMessage(3, lww(pbString(1, templateId), stamp())),
        pbMessage(4, lww(pbString(1, keys[pi]), stamp())),
        ...tail(15),
        pbMessage(17, [pbMessage(1, canvas), pbMessage(2, stamp())]),
      ]),
    );
    notesIndex.push(encodeMessage([pbString(1, noteId), pbString(2, `notes/${noteId}`)]));
    notesEvents(noteId, 0);
    const records: Uint8Array[] = [];
    page.strokes.forEach((stroke, si) => {
      sequence += 1;
      records.push(
        ...codecStrokeRecords({
          id: id(`stroke-${pi}-${si}`),
          blob: strokeBlob(stroke, lineControl, mode),
          color: rgba(stroke.color),
          highlighter: stroke.highlighter,
          penType: strokePenType(stroke),
          device,
          sequence,
          tag: rand32(`stroke-tag-${pi}-${si}`),
          tag2: rand32(`stroke-tag2-${pi}-${si}`),
        }),
      );
    });
    noteMembers.push({ name: `notes/${noteId}`, data: writeDelimitedRecords(records) });
  });
  events.push(record(docId, 10, [pbString(1, docId), pbString(2, pageIds[0]), pbString(3, `PagingViewServiceUpdater:${id("paging")}`), ...tail(15)]));
  // 저장 때 항목이 있는 페이지마다 새 notes 버전(임의 63비트, 여기서는 53비트)을 붙인 이벤트를 더한다(_version_notes).
  input.pages.forEach((page, pi) => {
    if (page.strokes.length > 0) notesEvents(noteIds[pi], seededInt(seed, `notes-version-${pi}`, 53) || 1);
  });

  const members: Member[] = [
    { name: "schema.pb", data: encodeMessage([pbVarint(1, GOODNOTES_SCHEMA_VERSION)]) },
    { name: "document.info.pb", data: EMPTY },
    { name: "index.notes.pb", data: writeDelimitedRecords(notesIndex) },
    { name: "index.attachments.pb", data: writeDelimitedRecords(attachmentsIndex) },
    { name: "index.events.pb", data: writeDelimitedRecords(events) },
    ...attachmentMembers,
    ...noteMembers,
  ];
  if (input.thumbnailJpeg) members.push({ name: "thumbnail.jpg", data: input.thumbnailJpeg });
  return zipMembers(members, input.zipMethod ?? "deflate", createdAt);
}

/**
 * notes 그룹 이벤트 세 개: 105 저장소 갱신, 104 색인, 102 항목 갱신(goodnotes-codec _notes_events 관찰, 공식 아님).
 * version이 0이 아니면 105 f5와 104 f12에 넣는다. goodnotes-codec는 항목이 있는 페이지를 저장할 때마다
 * 새 임의 버전으로 이 세 이벤트를 덧붙인다.
 */
export function notesGroupEvents(args: {
  docId: string;
  noteId: string;
  version: number;
  device: number;
  now: number;
  nextEventId: () => string;
  jitter: () => number;
}): Uint8Array[] {
  const { docId, noteId, version, device, now } = args;
  const eventTail = (): PbField[] => [
    pbFloat64(10, now),
    pbString(11, args.nextEventId()),
    pbVarint(13, device),
    pbVarint(14, Math.floor(now) + args.jitter()),
    pbVarint(15, GOODNOTES_SCHEMA_VERSION),
  ];
  const record = (kind: number, body: PbField[]) => encodeMessage([pbString(1, noteId), pbMessage(kind, body)]);
  const store = record(105, [pbVarint(1, 1), pbString(2, docId), pbString(4, noteId), ...(version ? [pbVarint(5, version)] : []), pbString(6, "auto"), ...eventTail()]);
  const index = record(104, [
    pbString(1, docId),
    pbString(2, noteId),
    pbFloat64(10, now),
    pbString(11, args.nextEventId()),
    ...(version ? [pbVarint(12, version)] : []),
    pbString(13, "auto"),
    pbVarint(14, 1),
    pbString(15, args.nextEventId()),
    pbVarint(17, device),
    pbVarint(18, Math.floor(now)),
    pbVarint(19, GOODNOTES_SCHEMA_VERSION),
  ]);
  const updated = record(102, [pbString(1, noteId), ...eventTail(), pbString(16, docId)]);
  return [store, index, updated];
}

/** 견본 없이 .goodnotes 문서를 만든다. 결과는 ZIP 바이트. */
export async function buildGoodnotesDocument(input: BuildGoodnotesDocumentInput): Promise<Uint8Array> {
  validateInput(input);
  const seed = input.idSeed ?? inputDigest(input);
  return (input.profile ?? "codec") === "natural-ink" ? buildNaturalInk(input, seed) : buildCodec(input, seed);
}

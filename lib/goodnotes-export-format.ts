// 굿노트로 보내기 파일 형식(.goodnotes)을 정하는 유일한 곳.
// 화면(components/GoodnotesExport.tsx)과 준비 흐름(lib/goodnotes-export.ts)은 형식을 모른다.
// Worker 주소 가져오기가 없는 순수 모듈이라 Node 테스트(scripts/goodnotes-export.test.mjs)가 그대로 불러 쓴다.
//
// 1쪽: 사진에서 옮긴 펜 획(흰 배경, A4, 사진 방향을 따라 가로나 세로). 글씨 윤곽(lib/ink-outline.ts)을
//      볼펜 획 여러 줄로 채운다(lib/goodnotes-fill.ts, outlineToInk). 채움은 Worker에서 돌고 문서 쓰기는 화면에서 돈다.
// 2쪽: 원본 사진. buildInkPdf로 사진만 든 PDF를 만들고 그 2쪽을 배경으로 쓴다.
//      2쪽 크기는 A4가 아니라 그 PDF 쪽(긴 변 842pt, 사진 비율)에 맞춘다.
//
// 배경 PDF 규칙(실기기 확인 2026-11-26, 아이패드 굿노트, 사진 눈대중 측정): 굿노트는 배경 PDF의 1pt를
// 페이지 단위 11/6개로 그린다. 프로필이나 unitsPerPt와 상관없이 페이지 크기(단위) = 배경 PDF 크기(pt) × 11/6
// 이어야 배경과 획이 맞는다. 획 좌표는 페이지에 선언한 크기 기준으로 그대로 그려진다.
// 그래서 2쪽 크기는 사진 PDF 크기 × BACKGROUND_UNITS_PER_PT로 정하고, 1쪽 흰 배경도 같은 비율로 만든다.

import {
  A4_PT,
  GOODNOTES_UNITS_PER_PT,
  buildGoodnotesDocument,
  fitPhotoToPage,
  type GoodnotesPageInput,
  type GoodnotesProfile,
} from "./goodnotes-file.ts";
import { fillShapesWithPen, type FillShape } from "./goodnotes-fill.ts";
import { INK_PDF_COLORS, buildInkPdf, inkPdfPageSize, readJpegInfo, type InkPdfColor } from "./ink-pdf.ts";

export type GoodnotesExportSetup = { profile: GoodnotesProfile; unitsPerPt: number };

/**
 * 프로필과 페이지 단위. 실기기 비교(시험 파일 A, B, C, 아이패드 굿노트, 2026-11-26 사용자 확인)로 B로 정했다.
 * 바꾸려면 이 값만 고친다.
 * A: { profile: "natural-ink", unitsPerPt: 1 } — 획의 지우개와 올가미는 되지만 배경 PDF가 어긋난다.
 * B: { profile: "codec", unitsPerPt: GOODNOTES_UNITS_PER_PT } — 지금. 획과 배경이 겹치고 지우개, 올가미가 된다.
 * C: { profile: "natural-ink", unitsPerPt: GOODNOTES_UNITS_PER_PT } — B와 같이 잘 된다.
 */
export const GOODNOTES_EXPORT_SETUP: GoodnotesExportSetup = { profile: "codec", unitsPerPt: GOODNOTES_UNITS_PER_PT };

/** 배경 PDF 1pt가 굿노트에서 차지하는 페이지 단위(실기기 확인 2026-11-26). 설정과 무관하게 고정. */
export const BACKGROUND_UNITS_PER_PT = GOODNOTES_UNITS_PER_PT;

/** 페이지 폭에 대한 여백 비율. */
export const GOODNOTES_EXPORT_MARGIN = 0.04;
/**
 * 펜 굵기 하한과 상한(pt). 단위를 바꿔도 종이 위 굵기가 같도록 pt로 정하고 페이지 단위로 바꾼다.
 * 하한 0.8pt(약 0.28mm)는 PDF로 보내던 때와 같고 가는 볼펜 정도다. 이보다 가늘면 쪽 전체 보기에서
 * 흐린 사진의 가는 획이 끊겨 보인다. 상한 6pt는 보드 테두리나 번진 자국이 굵은 띠로 남지 않게 한다.
 */
export const GOODNOTES_EXPORT_MIN_PEN_PT = 0.8;
export const GOODNOTES_EXPORT_MAX_PEN_PT = 6;

export const GOODNOTES_EXPORT_TYPE = "application/zip";
export const GOODNOTES_EXPORT_EXTENSION = ".goodnotes";
export const GOODNOTES_EXPORT_UNTITLED = "슬림보드 노트";

/**
 * 사진 픽셀 좌표의 글씨 윤곽(lib/ink-outline.ts 결과). 덩어리마다 짝수-홀수 규칙으로 채우는 고리들.
 * width, height는 윤곽 좌표의 기준인 사진(분석 입력) 크기다.
 */
export type ExportOutline = { width: number; height: number; shapes: ReadonlyArray<FillShape<InkPdfColor>> };
/** 1쪽에 그대로 들어가는 볼펜 획. 좌표와 굵기는 페이지 단위다. */
export type ExportStroke = { points: ReadonlyArray<readonly [number, number]>; color: InkPdfColor; width: number };
/**
 * 1쪽에 쓸 펜 획과 그 기준. width, height는 사진 픽셀 크기(쪽 방향과 배치를 정한다), setup은 획 좌표의 단위다.
 * Worker에서 만들어 화면으로 넘기므로 구조 복사가 되는 값만 담는다.
 */
export type ExportInk = { width: number; height: number; setup: GoodnotesExportSetup; strokes: ReadonlyArray<ExportStroke> };

/** 사진 방향에 맞춘 A4 쪽(페이지 단위)과 사진 픽셀에서 페이지 단위로 가는 변환. 정사각형은 세로로 둔다. */
export function inkPageLayout(photo: { width: number; height: number }, setup: GoodnotesExportSetup) {
  const landscape = photo.width > photo.height;
  const page = {
    width: (landscape ? A4_PT.height : A4_PT.width) * setup.unitsPerPt,
    height: (landscape ? A4_PT.width : A4_PT.height) * setup.unitsPerPt,
  };
  const margin = page.width * GOODNOTES_EXPORT_MARGIN;
  const fit = fitPhotoToPage(photo, page, { margin });
  return { page, margin, fit };
}

/** 펜 굵기(페이지 단위)를 0.8~6pt 범위로 자른다. */
export function inkPenWidth(width: number, setup: GoodnotesExportSetup) {
  const min = GOODNOTES_EXPORT_MIN_PEN_PT * setup.unitsPerPt;
  const max = GOODNOTES_EXPORT_MAX_PEN_PT * setup.unitsPerPt;
  if (!Number.isFinite(width)) return min;
  return Math.min(max, Math.max(min, width));
}

/** 펜 색(0~1 RGB). PDF로 보내던 때와 같은 4색. */
export function inkPenColor(color: InkPdfColor): readonly [number, number, number] {
  return INK_PDF_COLORS[color] ?? INK_PDF_COLORS.black;
}

/**
 * 윤곽을 1쪽의 볼펜 획으로 바꾼다(lib/goodnotes-fill.ts, 시험 파일 D2 방식). 덩어리 하나가 획 하나 이상이 되어
 * 굿노트에서 지우개 한 번에 지워지고 올가미로 덩어리째 옮겨진다. 굵기 저장값은 0.8~6pt 안에서 계획한다.
 * 실제 판서 사진에서 1초 안팎이 걸려 Worker에서 부른다(lib/goodnotes-ink.ts).
 */
export function outlineToInk(outline: ExportOutline, setup: GoodnotesExportSetup = GOODNOTES_EXPORT_SETUP): ExportInk {
  const { fit } = inkPageLayout(outline, setup);
  const filled = fillShapesWithPen(outline.shapes, {
    fit,
    minPenWidth: GOODNOTES_EXPORT_MIN_PEN_PT * setup.unitsPerPt,
    maxPenWidth: GOODNOTES_EXPORT_MAX_PEN_PT * setup.unitsPerPt,
  });
  return {
    width: outline.width,
    height: outline.height,
    setup,
    strokes: filled.map(({ points, width, color }) => ({ points, width: inkPenWidth(width, setup), color })),
  };
}

/** 1쪽: 흰 배경 A4에 사진 비율 그대로 옮긴 획. 점이 없는 획은 뺀다. */
export function inkPage(ink: ExportInk) {
  const { setup } = ink;
  const { page, fit, margin } = inkPageLayout(ink, setup);
  const strokes = ink.strokes.filter(stroke => stroke.points.length > 0).map(stroke => ({
    points: stroke.points,
    color: inkPenColor(stroke.color),
    width: inkPenWidth(stroke.width, setup),
  }));
  // 흰 배경 PDF도 배경 규칙(크기 × 6/11 pt)에 맞춘다. natural-ink 기본값(1배)이면 배경이 페이지보다 커진다.
  const input: GoodnotesPageInput = { width: page.width, height: page.height, strokes, background: { pdfScale: 1 / BACKGROUND_UNITS_PER_PT } };
  return { page: input, fit, margin };
}

/**
 * 2쪽: 사진 PDF의 2쪽을 배경으로. 페이지 크기 = 사진 PDF 크기(pt) × 11/6이라야 사진이 페이지를 꽉 채운다.
 * 사진이 JPEG가 아니면 null이고 1쪽만 보낸다.
 */
export function photoPage(ink: { width: number; height: number }, jpeg: Uint8Array, title: string): GoodnotesPageInput | null {
  const info = readJpegInfo(jpeg);
  if (!info) return null;
  const oriented = info.orientation >= 5 ? [info.height, info.width] : [info.width, info.height];
  const size = inkPdfPageSize(oriented[0], oriented[1]);
  return {
    width: size.width * BACKGROUND_UNITS_PER_PT,
    height: size.height * BACKGROUND_UNITS_PER_PT,
    strokes: [],
    backgroundPdf: buildInkPdf({ width: ink.width, height: ink.height, strokes: [], title, photo: { jpeg } }),
    backgroundPdfPage: 2,
  };
}

/** 문서 쓰기. 펜 획이 이미 페이지 단위라 메인 스레드에서 돌린다. 프로필은 ink.setup을 따른다. */
export async function buildGoodnotesExport({ ink, title, jpeg, idSeed, createdAt }: {
  ink: ExportInk; title: string; jpeg: Uint8Array | null; idSeed?: string; createdAt?: Date;
}): Promise<Uint8Array> {
  const shownTitle = title.trim() || GOODNOTES_EXPORT_UNTITLED;
  const pages: GoodnotesPageInput[] = [inkPage(ink).page];
  const photo = jpeg ? photoPage(ink, jpeg, shownTitle) : null;
  if (photo) pages.push(photo);
  else console.warn("Goodnotes export: photo page skipped, the photo is not a JPEG");
  return buildGoodnotesDocument({ title: shownTitle, pages, profile: ink.setup.profile, idSeed, createdAt });
}

/**
 * 미리보기용: 1쪽에서 사진이 차지하는 영역(페이지 단위). 미리보기는 파일의 획을 이 영역 기준으로 그려
 * 종이 비율이 사진 비율과 같다. 그려지는 굵기는 굵기 저장값 그대로다(GOODNOTES_PEN_DRAWN_PER_STORED = 1).
 */
export function inkPreviewFrame(ink: ExportInk) {
  const { fit } = inkPageLayout(ink, ink.setup);
  return { x: fit.offsetX, y: fit.offsetY, width: ink.width * fit.scale, height: ink.height * fit.scale };
}

/** 미리보기용 펜 색(CSS). 파일의 펜 색과 같다. */
export function inkPreviewColor(color: InkPdfColor) {
  return `rgb(${inkPenColor(color).map(value => Math.round(value * 255)).join(" ")})`;
}

export function goodnotesFileName(title: string) {
  // Titles may hold line breaks, so whitespace collapses before control characters go.
  const safe = title.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return `${Array.from(safe).slice(0, 60).join("").trim() || GOODNOTES_EXPORT_UNTITLED}${GOODNOTES_EXPORT_EXTENSION}`;
}

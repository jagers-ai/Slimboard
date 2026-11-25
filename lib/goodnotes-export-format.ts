// 굿노트로 보내기 파일 형식(.goodnotes)을 정하는 유일한 곳.
// 화면(components/GoodnotesExport.tsx)과 준비 흐름(lib/goodnotes-export.ts)은 형식을 모른다.
// Worker 주소 가져오기가 없는 순수 모듈이라 Node 테스트(scripts/goodnotes-export.test.mjs)가 그대로 불러 쓴다.
//
// 1쪽: 사진에서 옮긴 펜 획(흰 배경, A4, 사진 방향을 따라 가로나 세로).
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
  strokesToPage,
  type FitTransform,
  type GoodnotesPageInput,
  type GoodnotesProfile,
} from "./goodnotes-file.ts";
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

/** 사진 픽셀 좌표의 획(lib/ink-strokes.ts 결과). */
export type ExportStroke = { points: ReadonlyArray<readonly [number, number]>; color: InkPdfColor; width: number };
export type ExportInk = { width: number; height: number; strokes: ReadonlyArray<ExportStroke> };

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

/** 사진 픽셀 굵기를 페이지 단위 굵기로 바꾸고 0.8~6pt 범위로 자른다. */
export function inkPenWidth(pixelWidth: number, fit: FitTransform, setup: GoodnotesExportSetup) {
  const min = GOODNOTES_EXPORT_MIN_PEN_PT * setup.unitsPerPt;
  const max = GOODNOTES_EXPORT_MAX_PEN_PT * setup.unitsPerPt;
  const width = pixelWidth * fit.scale;
  if (!Number.isFinite(width)) return min;
  return Math.min(max, Math.max(min, width));
}

/** 펜 색(0~1 RGB). PDF로 보내던 때와 같은 4색. */
export function inkPenColor(color: InkPdfColor): readonly [number, number, number] {
  return INK_PDF_COLORS[color] ?? INK_PDF_COLORS.black;
}

/** 1쪽: 흰 배경 A4에 사진 비율 그대로 옮긴 획. 점이 없는 획은 뺀다. */
export function inkPage(ink: ExportInk, setup: GoodnotesExportSetup) {
  const { page, fit, margin } = inkPageLayout(ink, setup);
  const drawn = ink.strokes.filter(stroke => stroke.points.length > 0);
  const strokes = strokesToPage(drawn, fit).map((stroke, index) => ({
    points: stroke.points,
    color: inkPenColor(stroke.color),
    width: inkPenWidth(drawn[index].width, fit, setup),
  }));
  // 흰 배경 PDF도 배경 규칙(크기 × 6/11 pt)에 맞춘다. natural-ink 기본값(1배)이면 배경이 페이지보다 커진다.
  const input: GoodnotesPageInput = { width: page.width, height: page.height, strokes, background: { pdfScale: 1 / BACKGROUND_UNITS_PER_PT } };
  return { page: input, fit, margin };
}

/**
 * 2쪽: 사진 PDF의 2쪽을 배경으로. 페이지 크기 = 사진 PDF 크기(pt) × 11/6이라야 사진이 페이지를 꽉 채운다.
 * 사진이 JPEG가 아니면 null이고 1쪽만 보낸다.
 */
export function photoPage(ink: ExportInk, jpeg: Uint8Array, title: string): GoodnotesPageInput | null {
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

export async function buildGoodnotesExport({ ink, title, jpeg, setup = GOODNOTES_EXPORT_SETUP, idSeed, createdAt }: {
  ink: ExportInk; title: string; jpeg: Uint8Array | null;
  setup?: GoodnotesExportSetup; idSeed?: string; createdAt?: Date;
}): Promise<Uint8Array> {
  const shownTitle = title.trim() || GOODNOTES_EXPORT_UNTITLED;
  const pages: GoodnotesPageInput[] = [inkPage(ink, setup).page];
  const photo = jpeg ? photoPage(ink, jpeg, shownTitle) : null;
  if (photo) pages.push(photo);
  else console.warn("Goodnotes export: photo page skipped, the photo is not a JPEG");
  return buildGoodnotesDocument({ title: shownTitle, pages, profile: setup.profile, idSeed, createdAt });
}

/** 미리보기용: 파일에 들어가는 펜 색과 굵기를 사진 픽셀 기준으로. */
export function inkPreviewPen(ink: ExportInk, stroke: ExportStroke, setup: GoodnotesExportSetup = GOODNOTES_EXPORT_SETUP) {
  const { fit } = inkPageLayout(ink, setup);
  return {
    color: `rgb(${inkPenColor(stroke.color).map(value => Math.round(value * 255)).join(" ")})`,
    width: inkPenWidth(stroke.width, fit, setup) / fit.scale,
  };
}

export function goodnotesFileName(title: string) {
  // Titles may hold line breaks, so whitespace collapses before control characters go.
  const safe = title.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return `${Array.from(safe).slice(0, 60).join("").trim() || GOODNOTES_EXPORT_UNTITLED}${GOODNOTES_EXPORT_EXTENSION}`;
}

// 굿노트로 보내기 파일 형식(.goodnotes)을 정하는 유일한 곳.
// 화면(components/GoodnotesExport.tsx)과 준비 흐름(lib/goodnotes-export.ts)은 형식을 모른다.
// Worker 주소 가져오기가 없는 순수 모듈이라 Node 테스트(scripts/goodnotes-export.test.mjs)가 그대로 불러 쓴다.
//
// 1쪽: 사진에서 옮긴 펜 획(흰 배경, A4, 사진 방향을 따라 가로나 세로). 글씨 윤곽(lib/ink-outline.ts)을
//      펜 종류(GOODNOTES_EXPORT_PEN)에 따라 볼펜 획 여러 줄로 채우거나(lib/goodnotes-fill.ts) 만년필이나 붓의
//      가변 굵기 획으로 바꾼다(lib/ink-medial-strokes.ts). 변환(outlineToInk)은 Worker에서 돌고 문서 쓰기는 화면에서 돈다.
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
  variableCenterline,
  type GoodnotesPageInput,
  type GoodnotesProfile,
  type GoodnotesStroke,
} from "./goodnotes-file.ts";
import { fillShapesWithPen, type FillShape } from "./goodnotes-fill.ts";
import { medialStrokesFromShapes } from "./ink-medial-strokes.ts";
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
 * 하한 0.35pt(약 0.12mm, 2026-11-26): 처음에는 PDF로 보내던 때와 같은 0.8pt였다(쪽 전체 보기에서 흐린 가는 획이
 * 끊겨 보이지 않게). 아이패드에서 작은 글씨가 사진보다 굵어 보여 낮췄다. 실제 판서 윤곽 1118덩어리(A4, 사진 1px
 * = 0.365pt) 측정: 0.8pt는 630덩어리가 하한에 걸려 되읽은 모양 IoU 0.869, 가는 글씨 구역 IoU 0.63~0.73이다.
 * 0.35pt는 걸리는 덩어리 42개(획 굵기 약 1.2px 이하), IoU 0.898로 하한이 없을 때(0.898)와 같고,
 * 점은 15% 늘며(4.96만 → 5.75만) 파일은 512KB → 578KB, 채움 시간과 메모리는 그대로다(격자는 획 굵기로 정한다).
 * 0.25pt, 0.15pt는 IoU가 더 오르지 않으면서 쪽 전체 보기에서 화면 1px보다 가늘어질 수 있어(어림, 실기기 미확인) 0.35pt로 둔다.
 * 상한 6pt는 보드 테두리나 번진 자국이 굵은 띠로 남지 않게 한다.
 */
export const GOODNOTES_EXPORT_MIN_PEN_PT = 0.35;
/** 펜 굵기 하한과 상한은 가변 굵기 획의 점마다 지름에도 똑같이 적용한다. */
export const GOODNOTES_EXPORT_MAX_PEN_PT = 6;

/**
 * 1쪽 펜 종류.
 * - "ballpoint": 글씨 윤곽을 균일 굵기 볼펜 획 여러 줄로 채운다(시험 파일 D2 방식).
 * - "fountain", "brush": 글씨 가운데 선에 점마다 굵기를 준 만년필(f3 1), 붓(f3 4) 획 하나로 옮긴다.
 *   실제 판서 재구성 IoU 0.918(볼펜 0.898)이고 획 수가 적어 지우개, 올가미가 글자 단위로 먹는다.
 * 기본값은 "ballpoint"(2026-11-27). 만년필과 붓 파일이 굿노트 실기기에서 열리고 제 모양으로 보이는지 아직 확인하지
 * 않았다. 실기기에서 확인되면 이 한 줄만 "fountain"이나 "brush"로 바꾼다(Worker와 미리보기는 이 값을 따른다).
 */
export const GOODNOTES_EXPORT_PEN: ExportPen = "ballpoint";

export const GOODNOTES_EXPORT_TYPE = "application/zip";
export const GOODNOTES_EXPORT_EXTENSION = ".goodnotes";
export const GOODNOTES_EXPORT_UNTITLED = "슬림보드 노트";

/**
 * 사진 픽셀 좌표의 글씨 윤곽(lib/ink-outline.ts 결과). 덩어리마다 짝수-홀수 규칙으로 채우는 고리들.
 * width, height는 윤곽 좌표의 기준인 사진(분석 입력) 크기다.
 */
export type ExportOutline = { width: number; height: number; shapes: ReadonlyArray<FillShape<InkPdfColor>> };
export type ExportPen = "ballpoint" | "fountain" | "brush";
/** 1쪽에 그대로 들어가는 볼펜 획. 좌표와 굵기는 페이지 단위다. pen을 생략하면 볼펜이다. */
export type ExportBallpointStroke = { pen?: "ballpoint"; points: ReadonlyArray<readonly [number, number]>; color: InkPdfColor; width: number };
/** 1쪽에 그대로 들어가는 만년필이나 붓 획. widths는 점마다 지름(페이지 단위)이고 points와 길이가 같다. */
export type ExportVariableStroke = {
  pen: "fountain" | "brush";
  points: ReadonlyArray<readonly [number, number]>;
  widths: ReadonlyArray<number>;
  color: InkPdfColor;
};
export type ExportStroke = ExportBallpointStroke | ExportVariableStroke;

export function isVariableExportStroke(stroke: ExportStroke): stroke is ExportVariableStroke {
  return stroke.pen === "fountain" || stroke.pen === "brush";
}
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

/** 펜 굵기(페이지 단위)를 하한~상한(0.35~6pt) 범위로 자른다. */
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

/** 가변 굵기 획의 점마다 지름을 하한~상한으로 자른다. 지름이 모자라면 마지막 지름(없으면 하한)으로 채워 점 수와 맞춘다. */
export function inkPenWidths(points: ReadonlyArray<unknown>, widths: ReadonlyArray<number>, setup: GoodnotesExportSetup) {
  return points.map((_, index) => inkPenWidth(widths[Math.min(index, widths.length - 1)] ?? Number.NaN, setup));
}

/**
 * 윤곽을 1쪽의 펜 획으로 바꾼다. 덩어리 하나가 획 하나 이상이 되어 굿노트에서 지우개 한 번에 지워지고
 * 올가미로 덩어리째 옮겨진다. 굵기는 0.35~6pt 안이다.
 * - 볼펜: 윤곽을 균일 굵기 획 여러 줄로 채운다(lib/goodnotes-fill.ts, 시험 파일 D2 방식).
 * - 만년필, 붓: 가운데 선과 점마다 지름으로 옮긴다(lib/ink-medial-strokes.ts).
 * 실제 판서 사진에서 1초 안팎이 걸려 Worker에서 부른다(lib/goodnotes-ink.ts).
 */
export function outlineToInk(
  outline: ExportOutline,
  setup: GoodnotesExportSetup = GOODNOTES_EXPORT_SETUP,
  pen: ExportPen = GOODNOTES_EXPORT_PEN,
): ExportInk {
  const { fit } = inkPageLayout(outline, setup);
  const minWidth = GOODNOTES_EXPORT_MIN_PEN_PT * setup.unitsPerPt;
  const maxWidth = GOODNOTES_EXPORT_MAX_PEN_PT * setup.unitsPerPt;
  let strokes: ExportStroke[];
  if (pen === "fountain" || pen === "brush") {
    strokes = medialStrokesFromShapes(outline.shapes, { fit, minWidth, maxWidth })
      .filter(stroke => stroke.points.length > 0)
      .map(({ points, widths, color }) => ({ pen, points, widths: inkPenWidths(points, widths, setup), color }));
  } else {
    strokes = fillShapesWithPen(outline.shapes, { fit, minPenWidth: minWidth, maxPenWidth: maxWidth })
      .map(({ points, width, color }) => ({ points, width: inkPenWidth(width, setup), color }));
  }
  return { width: outline.width, height: outline.height, setup, strokes };
}

/** 1쪽: 흰 배경 A4에 사진 비율 그대로 옮긴 획. 점이 없는 획은 뺀다. 볼펜 획과 가변 굵기 획을 그대로 넘긴다. */
export function inkPage(ink: ExportInk) {
  const { setup } = ink;
  const { page, fit, margin } = inkPageLayout(ink, setup);
  const strokes: GoodnotesStroke[] = ink.strokes.filter(stroke => stroke.points.length > 0).map(stroke => isVariableExportStroke(stroke)
    ? { pen: stroke.pen, points: stroke.points, widths: inkPenWidths(stroke.points, stroke.widths, setup), color: inkPenColor(stroke.color) }
    : { points: stroke.points, color: inkPenColor(stroke.color), width: inkPenWidth(stroke.width, setup) });
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
 * 종이 비율이 사진 비율과 같다. 볼펜은 굵기 저장값 그대로, 만년필과 붓은 점마다 지름 그대로 그린다.
 */
export function inkPreviewFrame(ink: ExportInk) {
  const { fit } = inkPageLayout(ink, ink.setup);
  return { x: fit.offsetX, y: fit.offsetY, width: ink.width * fit.scale, height: ink.height * fit.scale };
}

/**
 * 미리보기용: 만년필, 붓 획의 채움 경로(SVG d, nonzero 규칙)를 색마다 하나씩. 파일과 같은 중심선(variableCenterline,
 * 중점 2차 Bézier와 반폭)을 따라 점마다 반폭 원을 잇는 외접선 윤곽을 획마다 닫힌 하위 경로 하나로 만든다. 바깥 모서리는
 * 원호, 안쪽 모서리는 가운데 점을 거쳐(스트로커의 안쪽 이음) 겹치는 곳의 감김 방향이 같아 구멍이 생기지 않는다.
 * 좌표는 frame 원점 기준 0.25단위(휴대폰 화면 약 0.1px)로 반올림한 상대 좌표다. 크기는 scripts/goodnotes-export.test.mjs 참고.
 */
export function inkPreviewFillPaths(
  strokes: ReadonlyArray<{ points: ReadonlyArray<readonly [number, number]>; widths: ReadonlyArray<number>; color: InkPdfColor }>,
  frame: { x: number; y: number },
) {
  const paths = new Map<InkPdfColor, PreviewPath>();
  for (const stroke of strokes) {
    if (!stroke.points.length) continue;
    let path = paths.get(stroke.color);
    if (!path) paths.set(stroke.color, path = new PreviewPath());
    appendFill(path, previewCenterline(stroke.points, stroke.widths).map(([x, y, r]) => [x - frame.x, y - frame.y, r] as const));
  }
  return [...paths].map(([color, path]) => ({ color, d: path.text() }));
}

function appendFill(path: PreviewPath, line: ReadonlyArray<readonly [number, number, number]>) {
  if (line.length === 1) {
    const [x, y, r] = line[0];
    const cx = PreviewPath.snap(x), radius = PreviewPath.radius(r);
    path.move(cx - radius, y);
    path.arc(radius, true, cx + radius, y);
    path.arc(radius, true, cx - radius, y);
    path.close();
    return;
  }
  // 구간마다 양쪽 접점의 단위 법선(왼쪽 = 진행 방향의 +90°, SVG 각도 기준).
  const left: Array<readonly [number, number]> = [];
  const right: Array<readonly [number, number]> = [];
  const forward: Array<readonly [number, number]> = [];
  for (let k = 0; k + 1 < line.length; k += 1) {
    const [x0, y0, r0] = line[k];
    const [x1, y1, r1] = line[k + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / d, uy = (y1 - y0) / d;
    const a = (r0 - r1) / d;
    const b = Math.sqrt(Math.max(0, 1 - a * a));
    left.push([a * ux - b * uy, a * uy + b * ux]);
    right.push([a * ux + b * uy, a * uy - b * ux]);
    forward.push([ux, uy]);
  }
  const at = (k: number, n: readonly [number, number]) => [line[k][0] + n[0] * line[k][2], line[k][1] + n[1] * line[k][2]] as const;
  const last = line.length - 1;
  const first = at(0, left[0]);
  path.move(first[0], first[1]);
  // 왼쪽 옆선(앞으로) → 끝 원호 → 오른쪽 옆선(뒤로) → 시작 원호. 원호는 모두 각도가 줄어드는 방향이다.
  // 끝 원호는 끝 점(진행 방향 앞)을 거치는 두 원호로 나눈다. 각각 반원보다 작아 반올림해도 큰 원호 여부가 헷갈리지 않는다.
  const tip = forward[last - 1];
  const turn = (k: number) => {
    const [ax, ay] = forward[k - 1], [bx, by] = forward[k];
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  };
  for (let k = 1; k < last; k += 1) join(path, line[k], left[k - 1], left[k], turn(k), 1);
  // 반폭이 작으면(약 0.68단위 이하) 원호 대신 끝 점을 거치는 꺾은선으로 그린다(어긋남 0.2단위 이하).
  const cap = (r: number, x: number, y: number) => r * (1 - Math.SQRT1_2) <= 0.2 ? path.line(x, y) : path.arc(r, false, x, y);
  path.line(...at(last, left[last - 1]));
  cap(line[last][2], ...at(last, tip));
  cap(line[last][2], ...at(last, right[last - 1]));
  for (let k = last - 1; k >= 1; k -= 1) join(path, line[k], right[k], right[k - 1], turn(k), -1);
  path.line(...at(0, right[0]));
  cap(line[0][2], ...at(0, [-forward[0][0], -forward[0][1]]));
  cap(line[0][2], first[0], first[1]);
  path.close();
}

// 거의 곧은 이음은 두 법선의 가운데 한 점으로 줄인다(약 14° 이하, 어긋남 반폭의 1% 이하).
const PREVIEW_STRAIGHT_JOIN = 0.25;
// 진행 방향이 이만큼 넘게 꺾이면(거의 되돌아가면) 양쪽 모두 바깥 모서리로 본다.
const PREVIEW_U_TURN = Math.PI - 0.1;

/**
 * 옆선 이음. turn은 진행 방향의 꺾임(라디안, SVG 각도), side는 왼쪽(앞으로 가는 옆선) 1, 오른쪽(뒤로 가는 옆선) -1.
 * 바깥 모서리는 각도가 줄어드는 원호, 안쪽 모서리는 가운데 점을 거친다.
 */
function join(path: PreviewPath, [x, y, r]: readonly [number, number, number], from: readonly [number, number], to: readonly [number, number], turn: number, side: 1 | -1) {
  const normalTurn = Math.atan2(from[0] * to[1] - from[1] * to[0], from[0] * to[0] + from[1] * to[1]);
  const uTurn = Math.abs(turn) > PREVIEW_U_TURN;
  if (!uTurn && Math.abs(normalTurn) < PREVIEW_STRAIGHT_JOIN) {
    const mx = from[0] + to[0], my = from[1] + to[1], ml = Math.hypot(mx, my);
    path.line(x + (mx / ml) * r, y + (my / ml) * r);
    return;
  }
  path.line(x + from[0] * r, y + from[1] * r);
  // 각도가 줄어드는 쪽으로 from에서 to까지 도는 양(0~2π).
  const span = ((-normalTurn % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const outer = (uTurn || turn * side < 0) && span < Math.PI + 0.2;
  if (!outer) {
    path.line(x, y);
    path.line(x + to[0] * r, y + to[1] * r);
    return;
  }
  // 원호가 현에서 0.2단위(화면 약 0.06px) 안이면 곧은 선으로 줄인다.
  if (r * (1 - Math.cos(span / 2)) <= 0.2) {
    path.line(x + to[0] * r, y + to[1] * r);
    return;
  }
  // 반원에 가까운 원호는 가운데에서 나눠 반올림해도 큰 원호 여부가 헷갈리지 않게 한다.
  if (span > Math.PI / 2) {
    const angle = Math.atan2(from[1], from[0]) - span / 2;
    path.arc(r, false, x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  path.arc(r, false, x + to[0] * r, y + to[1] * r);
}

/**
 * 파일의 중심선(variableCenterline)을 점과 반폭 꺾은선으로 펼친다. 2차 구간은 제어점이 현에서 0.25단위 넘게 떨어질
 * 때만 가운데 점을 더한다. 0.3단위 안에서 점을 줄이고, 이웃 원 안에 들어가는 원은 뺀다(외접선이 없다).
 */
function previewCenterline(points: ReadonlyArray<readonly [number, number]>, widths: ReadonlyArray<number>) {
  const sub = variableCenterline(points, points.map((_, k) => (widths[Math.min(k, widths.length - 1)] ?? 0) / 2));
  const out: Array<[number, number, number]> = [[sub.move[0], sub.move[1], sub.move[2]]];
  let p0 = sub.move;
  for (const { c, p } of sub.quads) {
    const mx = (p0[0] + p[0]) / 2, my = (p0[1] + p[1]) / 2;
    if (Math.hypot(c[0] - mx, c[1] - my) / 2 > 0.25) {
      out.push([(mx + c[0]) / 2, (my + c[1]) / 2, (p0[2] + 2 * c[2] + p[2]) / 4]);
    }
    out.push([p[0], p[1], p[2]]);
    p0 = p;
  }
  const kept = simplifyRadiusLine(out, 0.3);
  const line: Array<[number, number, number]> = [];
  for (const point of kept) {
    let top = line[line.length - 1];
    if (top && Math.hypot(point[0] - top[0], point[1] - top[1]) <= Math.abs(point[2] - top[2]) + 1e-6) {
      if (point[2] > top[2]) {
        line.pop();
        // 새 원이 앞의 원들을 덮으면 그것도 뺀다.
        while ((top = line[line.length - 1]) && Math.hypot(point[0] - top[0], point[1] - top[1]) <= point[2] - top[2] + 1e-6) line.pop();
        line.push(point);
      }
      continue;
    }
    line.push(point);
  }
  return line;
}

/** 점과 반폭을 함께 보는 Ramer-Douglas-Peucker(반복). 처음과 끝은 남긴다. */
function simplifyRadiusLine(points: ReadonlyArray<[number, number, number]>, tolerance: number) {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [x0, y0, r0] = points[s];
    const [x1, y1, r1] = points[e];
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    let worst = -1, index = -1;
    for (let k = s + 1; k < e; k += 1) {
      const [x, y, r] = points[k];
      const t = l2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
      const off = Math.hypot(x - x0 - t * dx, y - y0 - t * dy) + Math.abs(r - (r0 + (r1 - r0) * t));
      if (off > worst) { worst = off; index = k; }
    }
    if (worst > tolerance) {
      keep[index] = 1;
      stack.push([s, index], [index, e]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** 0.25단위로 반올림한 상대 좌표 경로. 반폭도 0.25단위이고 0.25 아래로 내리지 않는다. */
class PreviewPath {
  private d = "";
  /** 마지막 명령 글자. 같은 명령이 이어지면 글자를 생략한다(SVG 암묵 반복). */
  private op = "";
  private x = 0;
  private y = 0;
  private startX = 0;
  private startY = 0;
  static snap(value: number) { return Math.round(value * 4) / 4; }
  static radius(value: number) { return Math.max(0.25, PreviewPath.snap(value)); }
  private static num(value: number) { return String(value).replace(/^(-?)0\./, "$1."); }
  private pair(x: number, y: number) {
    const nx = PreviewPath.snap(x), ny = PreviewPath.snap(y);
    const dx = PreviewPath.num(nx - this.x), dy = PreviewPath.num(ny - this.y);
    this.x = nx;
    this.y = ny;
    return `${dx}${dy.startsWith("-") ? "" : " "}${dy}`;
  }
  /** 새 하위 경로. 첫 m은 절대 좌표로, 그 뒤 m은 앞 하위 경로의 시작점 기준으로 읽힌다(z 뒤 현재 점). */
  move(x: number, y: number) {
    this.x = this.startX;
    this.y = this.startY;
    this.d += `m${this.pair(x, y)}`;
    // m 뒤의 좌표 쌍은 l로 읽히므로 이어지는 l의 글자를 생략할 수 있다.
    this.op = "l";
    this.startX = this.x;
    this.startY = this.y;
  }
  line(x: number, y: number) {
    if (PreviewPath.snap(x) === this.x && PreviewPath.snap(y) === this.y) return;
    const pair = this.pair(x, y);
    this.d += this.op === "l" ? `${pair.startsWith("-") ? "" : " "}${pair}` : `l${pair}`;
    this.op = "l";
  }
  /** 반지름 r 원호, 각도가 줄어드는 방향(sweep 0). */
  arc(r: number, large: boolean, x: number, y: number) {
    if (PreviewPath.snap(x) === this.x && PreviewPath.snap(y) === this.y) return;
    const radius = PreviewPath.num(PreviewPath.radius(r));
    this.d += `a${radius} ${radius} 0 ${large ? 1 : 0} 0 ${this.pair(x, y)}`;
    this.op = "a";
  }
  close() {
    this.d += "z";
    this.op = "z";
    this.x = this.startX;
    this.y = this.startY;
  }
  text() { return this.d; }
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

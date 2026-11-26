// 글씨 윤곽(채움 모양)을 굿노트 볼펜 획 여러 줄로 채워 같은 모양을 만든다(시험 파일 D2 방식).
//
// 입력: 사진에서 딴 덩어리 윤곽(lib/ink-outline.ts). 덩어리마다 짝수-홀수 규칙으로 채우는 닫힌 고리(바깥 고리와 구멍).
// 출력: 덩어리 하나 = 볼펜 획 하나(점 수 상한을 넘으면 나눈다). 굿노트의 지우개 한 번이 덩어리를 지우고,
//       올가미가 덩어리째 옮기게 하려는 것이다. 덩어리 안의 서로 떨어진 조각은 다리를 놓으면 배경에 선이 생기므로
//       조각마다 따로 획을 낸다.
//
// 방법(격자 위에서):
// 1. 고리를 격자에 칠하고 안쪽 거리장 D(경계까지 거리)를 만든다. 바깥 등고선 둘레는 고리 선분까지의 정확한 거리로 고친다.
// 2. 펜 굵기 = 능선(골격) 반지름 90분위 × 2 × penWidthRatio. 하한과 상한으로 자르고, 실제로 그려질 굵기로 계획한다.
// 3. D의 등고선을 펜 반지름 r, r + 간격, r + 2 간격 … 에서 딴다. 간격은 펜 굵기 × ringStep(1보다 작아 고리끼리 겹친다).
// 4. 등고선 펜이 덮지 못한 잉크(능선 틈, 펜보다 가는 부분, 등고선 끝 사이의 가는 목)를 찾고, 덩어리 전체의 중심축
//    (Guo-Hall 세선화, 가지 끝 다듬기) 가운데 그 잉크에 펜이 닿는 부분을 골격 경로로 더한다.
//    중심축이 지나지 않는 모서리 끝의 작은 틈은 버린다(채우면 펜이 잉크 밖으로 나간다).
// 5. 항목(등고선 고리, 골격 경로)을 최소 신장 트리로 잇고(다리 길이 + 잉크 밖 벌점, 배경을 건너면 큰 벌점)
//    되짚으며 한붓 경로를 만든다.
// 6. 경로를 펜 굵기 기준 오차로 단순화하고 페이지 단위로 바꾼다.
//
// 브라우저, Web Worker, Node 24(type stripping)에서 돈다. enum, namespace, Buffer, 외부 패키지를 쓰지 않는다.

export type FillPoint = readonly [number, number];
export type FillColor = "black" | "blue" | "red" | "green";

export type FillShape<C extends string = FillColor> = {
  color: C;
  /** 짝수-홀수 규칙으로 채우는 닫힌 고리들(사진 픽셀 좌표). 마지막 점이 첫 점과 같아도 된다. */
  rings: ReadonlyArray<ReadonlyArray<FillPoint>>;
  /** 넓이(px²). 쓰지 않는다(약속 형식에 있어 받기만 한다). */
  area?: number;
  /** 대표 획 굵기(px). 격자 해상도를 정하는 데만 쓴다. 없으면 2 × 넓이 / 둘레로 어림한다. */
  strokeWidth?: number;
};

/** 사진 픽셀 → 페이지 단위 변환(goodnotes-file.ts의 FitTransform과 같은 모양). */
export type FillFit = { scale: number; offsetX: number; offsetY: number };

export type FillOptions = {
  /** 좌표 변환. 없으면 입력 좌표 그대로 낸다. 굵기와 하한, 상한도 변환한 단위로 본다. */
  fit?: FillFit;
  /** 파일에 쓰는 굵기 저장값의 하한과 상한(출력 단위). 기본 0과 무한대. */
  minPenWidth?: number;
  maxPenWidth?: number;
  /** 펜 굵기 / 능선 지름 90분위. 작을수록 모양이 정확하고 점이 많다. */
  penWidthRatio?: number;
  /** 등고선 간격 / 펜 굵기. 1보다 작아야 고리 사이가 겹친다. */
  ringStep?: number;
  /** 경로 단순화 오차 / 펜 굵기. */
  tolerance?: number;
  /** 대표 획 굵기 하나에 들어가는 격자 칸 수. */
  cellsPerWidth?: number;
  /** 덩어리 하나의 격자 칸 수 상한. 넘으면 칸을 키운다(큰 테두리 같은 덩어리의 시간을 묶는다). */
  maxCellsPerShape?: number;
  /** 획 하나의 점 수 상한. 넘으면 1점 겹쳐 나눈다. */
  maxPointsPerStroke?: number;
  /** 굵기 저장값 1이 실제로 그려지는 지름. 기본 GOODNOTES_PEN_DRAWN_PER_STORED. */
  penDrawnPerStored?: number;
  /** 출력 좌표를 이 간격으로 반올림한다(압축이 잘 된다). 0이면 그대로. */
  coordinateStep?: number;
};

export type FilledStroke<C extends string = FillColor> = {
  /** 출력 단위 좌표(fit이 있으면 페이지 단위) */
  points: Array<[number, number]>;
  /** 굵기 저장값(출력 단위). buildGoodnotesDocument의 width에 그대로 넣는다. */
  width: number;
  color: C;
  /** 입력 shapes에서의 번호 */
  shape: number;
};

/**
 * 볼펜 굵기 저장값 1이 굿노트에서 그려지는 지름(출력 단위).
 * 기본 1: 두 작성기(natural-ink, goodnotes-codec)가 저장값을 페이지 단위 지름으로 쓰고, 지금 내보내기
 * (goodnotes-export-format.ts)도 같은 가정이다. goodparse는 6/11 배율 파일에서 약 8% 가늘게(11/12) 잰 기록이 있어,
 * 실기기에서 가늘게 보이면 이 값을 11/12로 바꾼다. 그러면 계획한 굵기가 그려지도록 저장값을 그만큼 키워 쓴다.
 * 등고선 간격을 펜 굵기의 0.85배로 둔 것도 이 차이(최대 8%)가 있어도 고리 사이에 흰 줄이 생기지 않게 하려는 것이다.
 */
export const GOODNOTES_PEN_DRAWN_PER_STORED = 1;

/**
 * 기본값(2026-11-26 측정, 실제 판서 윤곽 1062덩어리, Mac Node). 격자 8칸/굵기, 오차 0.05는 6칸/0.07보다
 * 되읽은 모양 IoU가 0.853 → 0.872로 좋아지고, 시간은 약 0.6초 → 0.9초, 파일은 0.49MB → 0.50MB다.
 * 펜 비율 0.7은 IoU가 더 높지만 획이 만나는 곳에 흰 틈(없던 구멍)이 생겨 0.8로 둔다.
 */
export const FILL_DEFAULTS = {
  penWidthRatio: 0.8,
  ringStep: 0.85,
  tolerance: 0.05,
  cellsPerWidth: 8,
  maxCellsPerShape: 250_000,
  maxPointsPerStroke: 2000,
  coordinateStep: 1 / 32,
} as const;

type Pt = [number, number];

/** 골격 경로를 이웃 칸 평균으로 다듬는 횟수. */
const SKELETON_SMOOTHING = 3;
type Item = { pts: Pt[]; comp: number };

/** 덩어리들을 볼펜 획으로 채운다. 점이 하나라도 있는 덩어리는 적어도 획 하나를 낸다. */
export function fillShapesWithPen<C extends string>(shapes: ReadonlyArray<FillShape<C>>, options: FillOptions = {}): FilledStroke<C>[] {
  const out: FilledStroke<C>[] = [];
  shapes.forEach((shape, index) => {
    for (const s of fillShapeWithPen(shape, options)) out.push({ ...s, color: shape.color, shape: index });
  });
  return out;
}

/** 덩어리 하나. 결과의 shape는 0이다. */
export function fillShapeWithPen<C extends string>(shape: FillShape<C>, options: FillOptions = {}): FilledStroke<C>[] {
  const o = resolve(options);
  const rings = cleanRings(shape.rings);
  const all = rings.flat();
  if (all.length === 0) {
    const loose = shape.rings.flat().filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (loose.length === 0) return [];
    return [dotStroke(shape.color, loose, o)];
  }
  const filled = rings.filter(r => r.length >= 3);
  const paths = filled.length ? fillRings(filled, shape.strokeWidth, o) : null;
  if (!paths || paths.lines.length === 0) return [dotStroke(shape.color, all, o)];
  const strokes: FilledStroke<C>[] = [];
  for (const line of paths.lines) {
    for (const part of splitPoints(line.map(p => output(p, o)), o.maxPointsPerStroke)) {
      strokes.push({ points: part, width: paths.width, color: shape.color, shape: 0 });
    }
  }
  return strokes;
}

// ---------------------------------------------------------------------------
// 옵션과 출력

type Resolved = Required<Omit<FillOptions, "fit">> & { fit: FillFit };

function resolve(options: FillOptions): Resolved {
  const pick = (v: number | undefined, d: number, ok: (x: number) => boolean) => (v !== undefined && Number.isFinite(v) && ok(v) ? v : d);
  const fit = options.fit && options.fit.scale > 0 && Number.isFinite(options.fit.scale) ? options.fit : { scale: 1, offsetX: 0, offsetY: 0 };
  const minPenWidth = pick(options.minPenWidth, 0, v => v >= 0);
  const maxPenWidth = Math.max(minPenWidth, options.maxPenWidth !== undefined && options.maxPenWidth > 0 ? options.maxPenWidth : Infinity);
  return {
    fit,
    minPenWidth,
    maxPenWidth,
    penWidthRatio: pick(options.penWidthRatio, FILL_DEFAULTS.penWidthRatio, v => v > 0),
    ringStep: pick(options.ringStep, FILL_DEFAULTS.ringStep, v => v > 0.1 && v <= 1.5),
    tolerance: pick(options.tolerance, FILL_DEFAULTS.tolerance, v => v >= 0),
    cellsPerWidth: pick(options.cellsPerWidth, FILL_DEFAULTS.cellsPerWidth, v => v >= 2),
    maxCellsPerShape: pick(options.maxCellsPerShape, FILL_DEFAULTS.maxCellsPerShape, v => v >= 1000),
    maxPointsPerStroke: Math.max(2, Math.floor(pick(options.maxPointsPerStroke, FILL_DEFAULTS.maxPointsPerStroke, v => v >= 2))),
    penDrawnPerStored: pick(options.penDrawnPerStored, GOODNOTES_PEN_DRAWN_PER_STORED, v => v > 0),
    coordinateStep: pick(options.coordinateStep, FILL_DEFAULTS.coordinateStep, v => v >= 0),
  };
}

function output([x, y]: Pt, o: Resolved): [number, number] {
  const X = o.fit.offsetX + x * o.fit.scale;
  const Y = o.fit.offsetY + y * o.fit.scale;
  const q = o.coordinateStep;
  return q > 0 ? [Math.round(X / q) * q, Math.round(Y / q) * q] : [X, Y];
}

function clampWidth(stored: number, o: Resolved) {
  return Math.min(o.maxPenWidth, Math.max(o.minPenWidth, stored));
}

/** 고리가 없거나 너무 작은 덩어리: 가운데에 점 하나. 굵기는 덩어리 크기(하한, 상한 적용). */
function dotStroke<C extends string>(color: C, pts: ReadonlyArray<FillPoint>, o: Resolved): FilledStroke<C> {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const size = Math.max(x1 - x0, y1 - y0) * o.fit.scale;
  const stored = clampWidth(size / o.penDrawnPerStored, o);
  return { points: [output([(x0 + x1) / 2, (y0 + y1) / 2], o)], width: stored > 0 ? stored : Math.max(o.minPenWidth, 1e-3), color, shape: 0 };
}

function splitPoints(points: Array<[number, number]>, max: number): Array<Array<[number, number]>> {
  const pts = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  if (pts.length <= max) return [pts];
  const parts: Array<Array<[number, number]>> = [];
  for (let i = 0; i < pts.length - 1; i += max - 1) parts.push(pts.slice(i, Math.min(pts.length, i + max)));
  return parts;
}

function cleanRings(rings: FillShape<string>["rings"]): Pt[][] {
  const out: Pt[][] = [];
  for (const ring of rings) {
    const r: Pt[] = [];
    for (const p of ring) {
      const x = p[0], y = p[1];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const last = r[r.length - 1];
      if (!last || last[0] !== x || last[1] !== y) r.push([x, y]);
    }
    while (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    if (r.length) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 덩어리 하나를 경로로

type Grid = { W: number; H: number; cell: number; ox: number; oy: number };

function fillRings(rings: Pt[][], strokeWidth: number | undefined, o: Resolved): { lines: Pt[][]; width: number } | null {
  // 격자: 대표 굵기 하나에 cellsPerWidth칸. 여백 2칸.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0, perim = 0;
  for (const r of rings) {
    let a = 0;
    for (let i = 0; i < r.length; i += 1) {
      const p = r[i], q = r[(i + 1) % r.length];
      a += p[0] * q[1] - q[0] * p[1];
      perim += Math.hypot(q[0] - p[0], q[1] - p[1]);
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    area += a / 2;
  }
  const span = Math.max(x1 - x0, y1 - y0);
  if (!(span > 0) || !(perim > 0)) return null;
  let est = strokeWidth !== undefined && strokeWidth > 0 && Number.isFinite(strokeWidth) ? strokeWidth : (2 * Math.abs(area)) / perim;
  if (!(est > 0)) est = span;
  est = Math.min(est, span);
  const PAD = 2;
  let cell = est / o.cellsPerWidth;
  const cellsFor = (c: number) => (Math.ceil((x1 - x0) / c) + 2 * PAD) * (Math.ceil((y1 - y0) / c) + 2 * PAD);
  if (cellsFor(cell) > o.maxCellsPerShape) cell *= Math.sqrt(cellsFor(cell) / o.maxCellsPerShape) * 1.02;
  const g: Grid = { W: Math.ceil((x1 - x0) / cell) + 2 * PAD, H: Math.ceil((y1 - y0) / cell) + 2 * PAD, cell, ox: x0 - PAD * cell, oy: y0 - PAD * cell };
  const segs = gridSegments(rings, g);
  const mask = rasterize(segs, g);
  const N = g.W * g.H;
  let inkCells = 0;
  for (let p = 0; p < N; p += 1) inkCells += mask[p];
  if (inkCells === 0) return null;

  // 안쪽 거리장(경계까지, 칸). 바깥은 -0.5로 둔다(등고선은 안쪽에서만 딴다).
  const outside = new Uint8Array(N);
  for (let p = 0; p < N; p += 1) outside[p] = mask[p] ? 0 : 1;
  const inSq = edtSq(outside, g.W, g.H);
  let D: Float32Array = new Float32Array(N);
  for (let p = 0; p < N; p += 1) D[p] = mask[p] ? Math.sqrt(inSq[p]) - 0.5 : -0.5;
  // 펜 굵기(칸, 실제로 그려지는 지름). 능선값은 흐리기 전에 잰다(흐리면 능선이 낮아진다).
  const ridge = ridgeRadii(D, mask, g.W, g.H);
  D = blur(D, g.W, g.H);
  const r90 = ridge.length ? ridge[Math.min(ridge.length - 1, Math.floor(0.9 * ridge.length))] : 0.5;
  const toOut = g.cell * o.fit.scale;
  const stored = clampWidth((o.penWidthRatio * 2 * Math.max(0.5, r90) * toOut) / o.penDrawnPerStored, o);
  const d = (stored * o.penDrawnPerStored) / toOut;
  const r = d / 2;

  exactBand(D, mask, segs, g, r);
  let dmax = 0;
  for (let p = 0; p < N; p += 1) if (D[p] > dmax) dmax = D[p];

  const tol = o.tolerance * d;
  const spacing = Math.max(0.5, d / 3);
  const items: Item[] = [];
  const step = Math.max(0.25, o.ringStep * d);
  for (let l = r; l < dmax; l += step) {
    for (const loop of contourLoops(D, g.W, g.H, l)) {
      if (perimeter(loop, true) < Math.max(0.5, 0.25 * d)) { items.push({ pts: [centroid(loop)], comp: 0 }); continue; }
      const simple = simplifyClosed(loop, Math.max(0.05, Math.min(tol, 0.5)));
      items.push({ pts: densify(simple, true, spacing), comp: 0 });
    }
  }

  // 등고선 펜이 덮지 못한 잉크 → 골격 경로
  // 첫 등고선 안쪽 칸: 가장 가까운 등고선까지 거리 = D - (그 칸 아래 가장 높은 등고선값). 거리장이라 정확하다.
  // 첫 등고선 바깥 칸(경계 띠, 펜보다 가는 부분): 경로 선분까지의 실제 거리. 칸 단위 거리로 어림하면
  // 두 등고선 끝 사이의 가는 목이 덮인 것으로 잘못 보여 고리가 끊긴다.
  const slackIn = 0.04 * d, reachOut = r + 0.3;
  const U = new Uint8Array(N), band: number[] = [];
  for (let p = 0; p < N; p += 1) {
    if (!mask[p]) continue;
    if (!items.length) { U[p] = 1; continue; }
    const v = D[p];
    if (v >= r) {
      const gap = v - (r + Math.floor((v - r) / step) * step);
      if (gap > r + slackIn) U[p] = 1;
    } else band.push(p);
  }
  if (band.length) {
    const dist = pathDistance(items, g.W, band, reachOut);
    band.forEach((p, k) => { if (dist[k] > reachOut) U[p] = 1; });
  }
  for (const piece of skeletonItems(mask, U, D, g, r)) items.push(piece);

  // 잉크 조각마다 따로 잇는다
  const comp = labels(mask, g.W, g.H, D);
  for (const it of items) it.comp = compAt(comp.label, it.pts[0], g.W);
  const lines: Pt[][] = [];
  for (let c = 1; c <= comp.count; c += 1) {
    let mine = items.filter(it => it.comp === c);
    if (mine.length === 0) {
      const p = comp.peak[c];
      mine = [{ pts: [[(p % g.W) + 0.5, Math.floor(p / g.W) + 0.5]], comp: c }];
    }
    const path = connect(mine, D, g, r, d);
    const simple = simplifyOpen(trimTail(path), tol);
    lines.push(simple.map(([x, y]) => [g.ox + x * g.cell, g.oy + y * g.cell] as Pt));
  }
  return { lines, width: stored };
}

// ---------------------------------------------------------------------------
// 격자 도구

type Segs = { ax: Float64Array; ay: Float64Array; bx: Float64Array; by: Float64Array; n: number };

function gridSegments(rings: Pt[][], g: Grid): Segs {
  let n = 0;
  for (const r of rings) n += r.length;
  const s: Segs = { ax: new Float64Array(n), ay: new Float64Array(n), bx: new Float64Array(n), by: new Float64Array(n), n };
  let k = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 1) {
      const p = r[i], q = r[(i + 1) % r.length];
      s.ax[k] = (p[0] - g.ox) / g.cell; s.ay[k] = (p[1] - g.oy) / g.cell;
      s.bx[k] = (q[0] - g.ox) / g.cell; s.by[k] = (q[1] - g.oy) / g.cell;
      k += 1;
    }
  }
  return s;
}

/** 짝수-홀수 규칙, 칸 중심 기준. */
function rasterize(s: Segs, g: Grid): Uint8Array {
  const { W, H } = g, mask = new Uint8Array(W * H), rows: number[][] = [];
  for (let j = 0; j < H; j += 1) rows.push([]);
  for (let k = 0; k < s.n; k += 1) {
    const ay = s.ay[k], by = s.by[k];
    if (ay === by) continue;
    const ya = Math.min(ay, by), yb = Math.max(ay, by);
    const j0 = Math.max(0, Math.ceil(ya - 0.5)), j1 = Math.min(H - 1, Math.ceil(yb - 0.5) - 1);
    const ax = s.ax[k], slope = (s.bx[k] - ax) / (by - ay);
    for (let j = j0; j <= j1; j += 1) rows[j].push(ax + (j + 0.5 - ay) * slope);
  }
  for (let j = 0; j < H; j += 1) {
    const xs = rows[j].sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let i = i0; i <= i1; i += 1) mask[j * W + i] = 1;
    }
  }
  return mask;
}

/** 원천 칸(src = 1)까지의 유클리드 거리 제곱(칸 중심 사이). Felzenszwalb-Huttenlocher. */
function edtSq(src: Uint8Array, W: number, H: number): Float64Array {
  const INF = 1e20, f = new Float64Array(W * H);
  for (let p = 0; p < W * H; p += 1) f[p] = src[p] ? 0 : INF;
  const n = Math.max(W, H), g = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q += 1) {
      if (g[q] >= INF) continue;
      if (g[v[k]] >= INF) { v[k] = q; continue; }
      let s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (k > 0 && s <= z[k]) { k -= 1; s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k += 1; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q += 1) {
      while (z[k + 1] < q) k += 1;
      d[q] = g[v[k]] >= INF ? INF : (q - v[k]) * (q - v[k]) + g[v[k]];
    }
  };
  for (let x = 0; x < W; x += 1) {
    for (let y = 0; y < H; y += 1) g[y] = f[y * W + x];
    pass(H);
    for (let y = 0; y < H; y += 1) f[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) g[x] = f[y * W + x];
    pass(W);
    for (let x = 0; x < W; x += 1) f[y * W + x] = d[x];
  }
  return f;
}

function blur(a: Float32Array, W: number, H: number): Float32Array {
  const t = new Float32Array(a.length), out = new Float32Array(a.length);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const p = y * W + x;
    t[p] = x === 0 || x === W - 1 ? a[p] : 0.25 * a[p - 1] + 0.5 * a[p] + 0.25 * a[p + 1];
  }
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const p = y * W + x;
    out[p] = y === 0 || y === H - 1 ? t[p] : 0.25 * t[p - W] + 0.5 * t[p] + 0.25 * t[p + W];
  }
  return out;
}

/** 능선 칸(네 방향 중 하나에서 극대)의 거리값, 오름차순. */
function ridgeRadii(D: Float32Array, mask: Uint8Array, W: number, H: number): Float32Array {
  const out: number[] = [];
  const offs = [1, W, W + 1, W - 1];
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
    const p = y * W + x;
    if (!mask[p]) continue;
    const v = D[p];
    for (const o of offs) {
      if (v >= D[p - o] && v >= D[p + o] && (v > D[p - o] || v > D[p + o])) { out.push(v); break; }
    }
  }
  return Float32Array.from(out).sort();
}

/** 펜 반지름 r 근처 칸의 거리값을 고리 선분까지의 정확한 거리로 바꾼다(바깥 등고선이 칸 해상도에 덜 묶이게). */
function exactBand(D: Float32Array, mask: Uint8Array, s: Segs, g: Grid, r: number) {
  const { W, H } = g, S = 8, NX = Math.ceil(W / S), NY = Math.ceil(H / S), R = r + 2.6;
  const buckets: number[][] = [];
  for (let i = 0; i < NX * NY; i += 1) buckets.push([]);
  for (let k = 0; k < s.n; k += 1) {
    const bx0 = Math.max(0, Math.floor((Math.min(s.ax[k], s.bx[k]) - R) / S)), bx1 = Math.min(NX - 1, Math.floor((Math.max(s.ax[k], s.bx[k]) + R) / S));
    const by0 = Math.max(0, Math.floor((Math.min(s.ay[k], s.by[k]) - R) / S)), by1 = Math.min(NY - 1, Math.floor((Math.max(s.ay[k], s.by[k]) + R) / S));
    for (let by = by0; by <= by1; by += 1) for (let bx = bx0; bx <= bx1; bx += 1) buckets[by * NX + bx].push(k);
  }
  const near = (x: number, y: number) => {
    let best = Infinity;
    for (const k of buckets[Math.floor(y / S) * NX + Math.floor(x / S)]) {
      const ax = s.ax[k], ay = s.ay[k], dx = s.bx[k] - ax, dy = s.by[k] - ay, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const ex = x - ax - t * dx, ey = y - ay - t * dy, v = ex * ex + ey * ey;
      if (v < best) best = v;
    }
    return Math.sqrt(best);
  };
  for (let y = 1; y < H - 1; y += 1) for (let x = 1; x < W - 1; x += 1) {
    const p = y * W + x, v = D[p];
    let use = mask[p] ? v >= r - 1.6 && v <= r + 1.6 : false;
    if (!mask[p] && r < 2.5) use = mask[p - 1] + mask[p + 1] + mask[p - W] + mask[p + W] > 0;
    if (!use) continue;
    const e = near(x + 0.5, y + 0.5);
    if (Number.isFinite(e)) D[p] = mask[p] ? e : -e;
  }
}

/** 등고선(칸 중심 격자, 값 > level 쪽이 안). 닫힌 고리들. */
function contourLoops(D: Float32Array, W: number, H: number, level: number): Pt[][] {
  const E = 2 * W * H, next = new Int32Array(E).fill(-1), px = new Float32Array(E), py = new Float32Array(E);
  const hEdge = (x: number, y: number) => y * W + x, vEdge = (x: number, y: number) => W * H + y * W + x;
  const setH = (x: number, y: number) => { const e = hEdge(x, y), a = D[y * W + x], b = D[y * W + x + 1]; px[e] = x + (level - a) / (b - a) + 0.5; py[e] = y + 0.5; return e; };
  const setV = (x: number, y: number) => { const e = vEdge(x, y), a = D[y * W + x], b = D[(y + 1) * W + x]; px[e] = x + 0.5; py[e] = y + (level - a) / (b - a) + 0.5; return e; };
  let any = false;
  for (let y = 0; y + 1 < H; y += 1) for (let x = 0; x + 1 < W; x += 1) {
    const a = D[y * W + x] > level, b = D[y * W + x + 1] > level, c = D[(y + 1) * W + x + 1] > level, d = D[(y + 1) * W + x] > level;
    const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
    if (code === 0 || code === 15) continue;
    any = true;
    const T = a !== b ? setH(x, y) : -1, R = b !== c ? setV(x + 1, y) : -1, B = d !== c ? setH(x, y + 1) : -1, L = a !== d ? setV(x, y) : -1;
    switch (code) {
      case 1: next[L] = B; break;
      case 2: next[B] = R; break;
      case 3: next[L] = R; break;
      case 4: next[R] = T; break;
      case 5: next[L] = T; next[R] = B; break;
      case 6: next[B] = T; break;
      case 7: next[L] = T; break;
      case 8: next[T] = L; break;
      case 9: next[T] = B; break;
      case 10: next[T] = R; next[B] = L; break;
      case 11: next[T] = R; break;
      case 12: next[R] = L; break;
      case 13: next[R] = B; break;
      case 14: next[B] = L; break;
      default: break;
    }
  }
  const loops: Pt[][] = [];
  if (!any) return loops;
  for (let s = 0; s < E; s += 1) {
    if (next[s] < 0) continue;
    const loop: Pt[] = [];
    let e = s;
    while (e >= 0 && next[e] >= 0) {
      loop.push([px[e], py[e]]);
      const n = next[e];
      next[e] = -1;
      e = n;
    }
    if (loop.length >= 2) loops.push(loop);
  }
  return loops;
}

/** 칸 중심에서 항목 경로(닫힌 차례열)까지의 거리. limit보다 먼 값은 limit보다 큰 값으로만 보장한다. */
function pathDistance(items: Item[], W: number, cells: number[], limit: number): Float64Array {
  const S = Math.max(4, Math.ceil(limit)), NX = Math.ceil(W / S) + 1, buckets = new Map<number, number[]>();
  const ax: number[] = [], ay: number[] = [], bx: number[] = [], by: number[] = [];
  for (const it of items) {
    const P = it.pts, n = P.length;
    for (let k = 0; k < n; k += 1) {
      const a = P[k], b = P[(k + 1) % n], id = ax.length;
      ax.push(a[0]); ay.push(a[1]); bx.push(b[0]); by.push(b[1]);
      const x0 = Math.floor((Math.min(a[0], b[0]) - limit) / S), x1 = Math.floor((Math.max(a[0], b[0]) + limit) / S);
      const y0 = Math.floor((Math.min(a[1], b[1]) - limit) / S), y1 = Math.floor((Math.max(a[1], b[1]) + limit) / S);
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
        const key = y * NX + x;
        let list = buckets.get(key);
        if (!list) buckets.set(key, list = []);
        list.push(id);
      }
    }
  }
  const out = new Float64Array(cells.length);
  cells.forEach((p, i) => {
    const px = (p % W) + 0.5, py = Math.floor(p / W) + 0.5;
    let best = Infinity;
    for (const k of buckets.get(Math.floor(py / S) * NX + Math.floor(px / S)) ?? []) {
      const dx = bx[k] - ax[k], dy = by[k] - ay[k], l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax[k]) * dx + (py - ay[k]) * dy) / l2)) : 0;
      const ex = px - ax[k] - t * dx, ey = py - ay[k] - t * dy, v = ex * ex + ey * ey;
      if (v < best) best = v;
    }
    out[i] = Math.sqrt(best);
  });
  return out;
}

/**
 * 덩어리 번호(1부터)와 덩어리마다 가장 깊은 칸. 한 칸 틈까지는 같은 덩어리로 본다: 칸보다 가는 목(고리의 가는 곳)이
 * 칠해지지 않아 끊기면 조각마다 따로 획이 나가고 그 틈이 비어 고리의 구멍이 바깥과 이어진다.
 */
function labels(mask: Uint8Array, W: number, H: number, D: Float32Array) {
  const label = new Int32Array(W * H), stack = new Int32Array(W * H), peakAt: number[] = [-1];
  let count = 0;
  for (let s = 0; s < W * H; s += 1) {
    if (!mask[s] || label[s]) continue;
    count += 1;
    let top = 0, best = s;
    stack[top++] = s; label[s] = count;
    while (top) {
      const p = stack[--top], x = p % W, y = (p - x) / W;
      if (D[p] > D[best]) best = p;
      for (let j = -2; j <= 2; j += 1) for (let i = -2; i <= 2; i += 1) {
        const X = x + i, Y = y + j;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const q = Y * W + X;
        if (mask[q] && !label[q]) { label[q] = count; stack[top++] = q; }
      }
    }
    peakAt.push(best);
  }
  return { label, count, peak: peakAt };
}

function compAt(label: Int32Array, p: Pt, W: number): number {
  const x = Math.floor(p[0]), y = Math.floor(p[1]);
  let best = 0, bd = Infinity;
  for (let j = -1; j <= 1; j += 1) for (let i = -1; i <= 1; i += 1) {
    const v = label[(y + j) * W + x + i];
    const dd = (x + i + 0.5 - p[0]) ** 2 + (y + j + 0.5 - p[1]) ** 2;
    if (v && dd < bd) { bd = dd; best = v; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 덮이지 않은 잉크의 골격

/** 8방향 연결 덩어리(칸 번호 목록). */
function components8(m: Uint8Array, W: number, H: number): number[][] {
  const N = W * H, lab = new Uint8Array(N), stack = new Int32Array(N), out: number[][] = [];
  const N8 = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  for (let s = 0; s < N; s += 1) {
    if (!m[s] || lab[s]) continue;
    const list: number[] = [];
    let top = 0;
    stack[top++] = s; lab[s] = 1;
    while (top) {
      const p = stack[--top];
      list.push(p);
      for (const o of N8) {
        const q = p + o;
        if (q >= 0 && q < N && m[q] && !lab[q]) { lab[q] = 1; stack[top++] = q; }
      }
    }
    out.push(list);
  }
  return out;
}

/**
 * 덮이지 않은 잉크(U)를 채울 골격 경로. 덩어리 전체의 중심축(세선화)을 만들고 가지 끝을 다듬은 뒤,
 * 덮이지 않은 잉크에 펜이 닿는 중심축 칸만 골라 덩어리마다 되짚는 한붓 경로(닫힌 항목)로 만든다.
 * U 자체를 세선화하면 등고선 끝의 초승달 모양 틈에서 획을 가로지르는 짧은 가지가 생겨 펜이 잉크 밖으로 나간다.
 */
function skeletonItems(mask: Uint8Array, U: Uint8Array, D: Float32Array, g: Grid, r: number): Item[] {
  const { W, H } = g, N = W * H, items: Item[] = [];
  let anyU = false;
  for (let p = 0; p < N && !anyU; p += 1) anyU = U[p] === 1;
  if (!anyU) return items;

  // 덩어리 전체의 중심축
  const sk = mask.slice();
  const inkList: number[] = [];
  for (let p = 0; p < N; p += 1) if (sk[p]) inkList.push(p);
  thin(sk, inkList, W);
  const N8 = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1];
  const ORDER = [-W, 1, W, -1, -W + 1, W + 1, W - 1, -W - 1];
  const deg = (p: number) => { let n = 0; for (const o of N8) n += sk[p + o]; return n; };
  // 끝 다듬기: 끝 칸의 원(반지름 D)이 이웃 칸의 원에 들어가면 지운다(모서리와 잔물결로 뻗은 가지).
  const queue = inkList.filter(p => sk[p] && deg(p) <= 1);
  while (queue.length) {
    const p = queue.pop() as number;
    if (!sk[p] || D[p] >= r || deg(p) !== 1) continue;
    let n = -1;
    for (const o of N8) if (sk[p + o]) n = p + o;
    const step = Math.abs(n - p) === 1 || Math.abs(n - p) === W ? 1 : Math.SQRT2;
    if (step + D[p] <= D[n] + 0.35) { sk[p] = 0; queue.push(n); }
  }

  // 덮이지 않은 잉크에 펜이 닿는 중심축 칸만 쓴다. 모서리 끝처럼 중심축에서 먼 작은 틈은 저절로 빠진다
  // (그곳까지 펜을 보내면 잉크 밖으로 나간다). 작은 틈이라도 중심축 가까이 있으면 채운다: 가는 목 양옆의
  // 작은 틈을 버리면 고리가 끊겨 구멍이 바깥과 이어진다.
  // 덩어리 조각에 항목이 하나도 없으면 부르는 쪽이 가장 깊은 칸에 점을 찍는다.
  const near = edtSq(U, W, H), reach = (r + 1) ** 2;
  const use = new Uint8Array(N);
  for (const p of inkList) if (sk[p] && near[p] <= reach) use[p] = 1;
  // 칸 중심을 그대로 이으면 비스듬한 선이 계단을 따라 지그재그로 가서 펜 가장자리가 구슬 꿴 듯 울퉁불퉁해진다.
  // 이웃 칸 평균으로 몇 번 다듬는다(끝 칸은 그대로 둔다).
  const sx = new Float64Array(N), sy = new Float64Array(N);
  const usedCells: number[] = [];
  for (const p of inkList) if (use[p]) { usedCells.push(p); sx[p] = (p % W) + 0.5; sy[p] = Math.floor(p / W) + 0.5; }
  for (let iter = 0; iter < SKELETON_SMOOTHING; iter += 1) {
    const nx = new Float64Array(usedCells.length), ny = new Float64Array(usedCells.length);
    usedCells.forEach((p, i) => {
      let n = 0, ax = 0, ay = 0;
      for (const o of N8) if (use[p + o]) { n += 1; ax += sx[p + o]; ay += sy[p + o]; }
      nx[i] = n >= 2 ? 0.5 * sx[p] + (0.5 * ax) / n : sx[p];
      ny[i] = n >= 2 ? 0.5 * sy[p] + (0.5 * ay) / n : sy[p];
    });
    usedCells.forEach((p, i) => { sx[p] = nx[i]; sy[p] = ny[i]; });
  }
  const at = (p: number): Pt => [sx[p], sy[p]];
  for (const list of components8(use, W, H)) {
    if (list.length === 1) { items.push({ pts: [at(list[0])], comp: 0 }); continue; }
    // 되짚는 깊이 우선 경로(끝 칸에서 시작)
    let start = list[0];
    for (const p of list) { let n = 0; for (const o of N8) n += use[p + o]; if (n <= 1) { start = p; break; } }
    const seen = new Set<number>([start]), path: Pt[] = [at(start)], st: Array<[number, number]> = [[start, 0]];
    while (st.length) {
      const top = st[st.length - 1];
      let moved = false;
      while (top[1] < 8) {
        const q = top[0] + ORDER[top[1]];
        top[1] += 1;
        if (use[q] && !seen.has(q)) { seen.add(q); st.push([q, 0]); path.push(at(q)); moved = true; break; }
      }
      if (!moved) { st.pop(); if (st.length) path.push(at(st[st.length - 1][0])); }
    }
    if (path.length > 1) path.pop();
    items.push({ pts: path, comp: 0 });
  }
  return items;
}

/** Guo-Hall 세선화. Zhang-Suen은 두 칸 굵기의 대각선을 통째로 지워 가늘게 삐친 끝이 사라진다. */
function thin(m: Uint8Array, list: number[], W: number) {
  let cur = list.filter(p => m[p]);
  for (let changed = true; changed;) {
    changed = false;
    for (let step = 0; step < 2; step += 1) {
      const del: number[] = [];
      for (const p of cur) {
        const p2 = m[p - W], p3 = m[p - W + 1], p4 = m[p + 1], p5 = m[p + W + 1], p6 = m[p + W], p7 = m[p + W - 1], p8 = m[p - 1], p9 = m[p - W - 1];
        const c = (!p2 && (p3 || p4) ? 1 : 0) + (!p4 && (p5 || p6) ? 1 : 0) + (!p6 && (p7 || p8) ? 1 : 0) + (!p8 && (p9 || p2) ? 1 : 0);
        if (c !== 1) continue;
        const n1 = (p9 | p2) + (p3 | p4) + (p5 | p6) + (p7 | p8), n2 = (p2 | p3) + (p4 | p5) + (p6 | p7) + (p8 | p9);
        const n = Math.min(n1, n2);
        if (n < 2 || n > 3) continue;
        const keepIt = step === 0 ? (p6 | p7 | (p9 ? 0 : 1)) & p8 : (p2 | p3 | (p5 ? 0 : 1)) & p4;
        if (keepIt) continue;
        del.push(p);
      }
      for (const p of del) m[p] = 0;
      if (del.length) { changed = true; cur = cur.filter(p => m[p]); }
    }
  }
}

// ---------------------------------------------------------------------------
// 항목 잇기

function sampleD(D: Float32Array, g: Grid, x: number, y: number) {
  const u = Math.max(0, Math.min(g.W - 1.001, x - 0.5)), v = Math.max(0, Math.min(g.H - 1.001, y - 0.5));
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, p = j * g.W + i;
  return (D[p] * (1 - fu) + D[p + 1] * fu) * (1 - fv) + (D[p + g.W] * (1 - fu) + D[p + g.W + 1] * fu) * fv;
}

/**
 * 다리 비용: 길이 + 펜이 잉크 밖으로 나가는 양의 6배 + 펜 중심이 잉크 밖(배경)을 지나는 길이의 100배.
 * 배경을 건너는 다리는 열린 획 사이를 이어 없던 구멍을 만들므로 잉크 안으로 도는 길이 있으면 그쪽을 고른다.
 */
function bridgeCost(a: Pt, b: Pt, D: Float32Array, g: Grid, r: number, slack: number) {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / 0.5));
  let pen = 0, out = 0;
  for (let k = 0; k <= n; k += 1) {
    const v = sampleD(D, g, a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n);
    pen += Math.max(0, r - slack - v);
    if (v < 0) out += 1;
  }
  return l + ((6 * pen + 100 * out) * l) / n;
}

type Link = { i: number; j: number; ia: number; jb: number; cost: number };

/** 항목들을 최소 신장 트리로 잇고 되짚는 한붓 경로를 만든다. */
function connect(items: Item[], D: Float32Array, g: Grid, r: number, d: number): Pt[] {
  if (items.length === 1) return walkAll(items, [], 0);
  const slack = Math.max(0.5, 0.15 * d);
  // 가까운 점 쌍 후보(격자 해시)
  const B = Math.max(1.5, 1.25 * d), NX = Math.ceil(g.W / B) + 1;
  const hash = new Map<number, number[]>();
  const gi: number[] = [], gk: number[] = [];
  items.forEach((it, i) => it.pts.forEach((p, k) => {
    const key = Math.floor(p[1] / B) * NX + Math.floor(p[0] / B);
    let list = hash.get(key);
    if (!list) hash.set(key, list = []);
    list.push(gi.length);
    gi.push(i); gk.push(k);
  }));
  const n = items.length, K = 4;
  const cands = new Map<number, Array<{ v: number; ia: number; jb: number }>>();
  for (let a = 0; a < gi.length; a += 1) {
    const i = gi[a], p = items[i].pts[gk[a]], bx = Math.floor(p[0] / B), by = Math.floor(p[1] / B);
    for (let y = by - 1; y <= by + 1; y += 1) for (let x = bx - 1; x <= bx + 1; x += 1) {
      const list = hash.get(y * NX + x);
      if (!list) continue;
      for (const b of list) {
        const j = gi[b];
        if (j <= i) continue;
        const q = items[j].pts[gk[b]], v = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2, key = i * n + j;
        let c = cands.get(key);
        if (!c) cands.set(key, c = []);
        if (c.length < K || v < c[c.length - 1].v) {
          c.push({ v, ia: gk[a], jb: gk[b] });
          c.sort((s, t) => s.v - t.v);
          if (c.length > K) c.pop();
        }
      }
    }
  }
  const links: Link[] = [];
  for (const [key, c] of cands) {
    const i = Math.floor(key / n), j = key % n;
    let best: Link | null = null;
    for (const { ia, jb } of c) {
      const cost = bridgeCost(items[i].pts[ia], items[j].pts[jb], D, g, r, slack);
      if (!best || cost < best.cost) best = { i, j, ia, jb, cost };
    }
    if (best) links.push(best);
  }
  links.sort((s, t) => s.cost - t.cost);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const tree: Link[] = [];
  for (const l of links) {
    const a = find(l.i), b = find(l.j);
    if (a !== b) { parent[a] = b; tree.push(l); }
  }
  // 멀리 떨어진 항목(드묾): 가장 가까운 점 쌍으로 잇는다.
  for (;;) {
    const root = find(0), inA: number[] = [], out: number[] = [];
    for (let i = 0; i < n; i += 1) (find(i) === root ? inA : out).push(i);
    if (!out.length) break;
    let best: Link | null = null;
    for (const i of inA) for (const j of out) {
      const P = items[i].pts, Q = items[j].pts, si = Math.max(1, Math.floor(P.length / 200)), sj = Math.max(1, Math.floor(Q.length / 200));
      for (let a = 0; a < P.length; a += si) for (let b = 0; b < Q.length; b += sj) {
        const v = (P[a][0] - Q[b][0]) ** 2 + (P[a][1] - Q[b][1]) ** 2;
        if (!best || v < best.cost) best = { i, j, ia: a, jb: b, cost: v };
      }
    }
    if (!best) break;
    parent[find(best.j)] = root;
    tree.push(best);
  }
  let rootItem = 0;
  items.forEach((it, i) => { if (it.pts.length > items[rootItem].pts.length) rootItem = i; });
  return walkAll(items, tree, rootItem);
}

/** 트리를 따라 걷는다. 항목은 모두 닫힌 차례열이다(고리, 되짚는 골격, 점 하나). */
function walkAll(items: Item[], tree: Link[], root: number): Pt[] {
  const adj: Array<Array<{ to: number; at: number; start: number }>> = items.map(() => []);
  for (const l of tree) {
    adj[l.i].push({ to: l.j, at: l.ia, start: l.jb });
    adj[l.j].push({ to: l.i, at: l.jb, start: l.ia });
  }
  const out: Pt[] = [], seen = new Uint8Array(items.length);
  const emit = (p: Pt) => { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); };
  const visit = (i: number, s: number) => {
    seen[i] = 1;
    const pts = items[i].pts, n = pts.length, kids = new Map<number, Array<{ to: number; start: number }>>();
    for (const e of adj[i]) {
      if (seen[e.to]) continue;
      let l = kids.get(e.at);
      if (!l) kids.set(e.at, l = []);
      l.push(e);
    }
    for (let t = 0; t <= n; t += 1) {
      const k = (s + t) % n;
      emit(pts[k]);
      if (t === n) break;
      for (const c of kids.get(k) ?? []) {
        if (seen[c.to]) continue;
        visit(c.to, c.start);
        emit(pts[k]);
      }
    }
  };
  visit(root, 0);
  return out;
}

/** 끝에 남은 되짚기(이미 그린 선분을 거꾸로 가는 것)를 떼어 낸다. */
function trimTail(path: Pt[]): Pt[] {
  if (path.length < 3) return path;
  const key = (a: Pt, b: Pt) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a[0]},${a[1]},${b[0]},${b[1]}` : `${b[0]},${b[1]},${a[0]},${a[1]}`);
  const count = new Map<string, number>();
  for (let i = 1; i < path.length; i += 1) { const k = key(path[i - 1], path[i]); count.set(k, (count.get(k) ?? 0) + 1); }
  let end = path.length;
  while (end > 2) {
    const k = key(path[end - 2], path[end - 1]), c = count.get(k) ?? 0;
    if (c < 2) break;
    count.set(k, c - 1);
    end -= 1;
  }
  return path.slice(0, end);
}

// ---------------------------------------------------------------------------
// 폴리라인 도구

function perimeter(pts: Pt[], closed: boolean) {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) s += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return s;
}

function centroid(pts: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

function densify(pts: Pt[], closed: boolean, step: number): Pt[] {
  const out: Pt[] = [], n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i += 1) {
    const a = pts[i], b = pts[(i + 1) % n], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < m; k += 1) out.push([a[0] + ((b[0] - a[0]) * k) / m, a[1] + ((b[1] - a[1]) * k) / m]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Douglas-Peucker(열린 폴리라인). */
function simplifyOpen(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3 || tol <= 0) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const st: Array<[number, number]> = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop() as [number, number];
    let bi = -1, bd = tol;
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i += 1) {
      const qx = pts[i][0] - ax, qy = pts[i][1] - ay, t = l2 ? Math.max(0, Math.min(1, (qx * dx + qy * dy) / l2)) : 0;
      const e = Math.hypot(qx - t * dx, qy - t * dy);
      if (e > bd) { bd = e; bi = i; }
    }
    if (bi > 0) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 닫힌 고리 단순화: 가장 먼 두 점에서 나눠 각각 단순화한다. */
function simplifyClosed(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 4) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i += 1) {
    const v = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (v > fd) { fd = v; far = i; }
  }
  const a = simplifyOpen(pts.slice(0, far + 1), tol), b = simplifyOpen([...pts.slice(far), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

// 글씨 윤곽(채움 모양)을 "가운데 선 + 점마다 굵기" 획으로 바꾼다(굿노트 만년필, 붓 펜용 기하).
//
// 입력: 사진에서 딴 덩어리 윤곽(lib/ink-outline.ts, goodnotes-fill.ts와 같은 FillShape). 짝수-홀수 고리.
// 출력: 덩어리마다 획 몇 개. 획 하나는 펜을 떼지 않는 경로이고, 점마다 지름(widths)을 가진다(페이지 단위).
//       반지름이 선형으로 바뀌는 캡슐들을 이은 모양이 원래 윤곽에 가깝게 되도록 만든다(중심축 변환: 도형은
//       가운데 선 위 원들의 합이다).
//
// 방법(덩어리마다 촘촘한 격자 위에서):
// 1. 고리를 격자에 칠하고 안쪽 거리장 D(칸 중심에서 경계까지 거리)를 만든다.
// 2. Guo-Hall 세선화로 한 칸 굵기 골격을 얻는다. 세선화는 연결과 구멍 수를 지키므로 ㅇ, ㅁ은 고리로 남는다.
// 3. 골격을 그래프(끝점, 갈림길 마디, 그 사이 가지)로 바꾼다. 가지 하나로만 이루어진 고리는 닫힌 가지다.
// 4. 짧은 가시 가지(모서리에서 생기는 가지)를 지우고, 서로 가까운 갈림길 마디는 하나로 합친다.
// 5. 갈림길마다 방향이 가장 곧게 이어지는 가지끼리 짝지어, 짝을 따라 가지를 이어 긴 획으로 만든다.
// 6. 획의 점과 반지름을 다듬고, 열린 끝은 둥근 끝이 원래 끝을 덮도록 늘이고, 점을 줄인다.
// 7. 지름 = 2 × 거리(페이지 단위로 바꾸고 하한, 상한으로 자른다).
// 아주 작은 덩어리나 골격이 없는 조각은 점 하나짜리 획으로 남긴다(획이 사라지는 덩어리가 없게).
//
// 브라우저, Web Worker, Node 24(type stripping)에서 돈다. enum, namespace, Buffer, 외부 패키지를 쓰지 않는다.

import type { FillFit, FillPoint, FillShape } from "./goodnotes-fill.ts";

export type MedialOptions = {
  /** 사진 픽셀 → 페이지 단위 변환. 없으면 입력 좌표 그대로 낸다. */
  fit?: FillFit;
  /** 지름의 하한과 상한(출력 단위). 기본 0과 무한대. */
  minWidth?: number;
  maxWidth?: number;
  /** 대표 획 굵기 하나에 들어가는 격자 칸 수. */
  cellsPerWidth?: number;
  /** 덩어리 하나의 격자 칸 수 상한. 넘으면 칸을 키운다. */
  maxCellsPerShape?: number;
  /** 가시 가지 판정: (가지 길이 + 끝 반지름 − 갈림길 반지름) < spurRatio × 갈림길 반지름 + 1칸이면 지운다. */
  spurRatio?: number;
  /** 갈림길에서 이을 가지 사이 꺾임 허용(도). 0이면 곧은 방향만, 90이면 직각까지. */
  maxTurnDegrees?: number;
  /** 점 줄이기 오차 / 획 지름 중앙값. */
  tolerance?: number;
  /** 다듬기(이웃 평균) 횟수. */
  smoothing?: number;
  /** 획 하나의 점 수 상한. 넘으면 1점 겹쳐 나눈다. */
  maxPointsPerStroke?: number;
  /** 출력 좌표를 이 간격으로 반올림한다. 0이면 그대로. */
  coordinateStep?: number;
};

export type MedialStroke<C extends string = string> = {
  color: C;
  /** 입력 shapes에서의 번호 */
  shape: number;
  /** 출력 단위 좌표. 닫힌 획은 마지막 점이 첫 점과 같다. */
  points: Array<[number, number]>;
  /** 점마다 지름(출력 단위). points와 길이가 같다. */
  widths: number[];
  /** 고리(ㅇ, ㅁ)처럼 처음과 끝이 이어진 획 */
  closed: boolean;
};

export const MEDIAL_DEFAULTS = {
  cellsPerWidth: 6,
  maxCellsPerShape: 250_000,
  spurRatio: 0.8,
  maxTurnDegrees: 55,
  tolerance: 0.06,
  smoothing: 2,
  maxPointsPerStroke: 2000,
  coordinateStep: 1 / 32,
} as const;

type Pt = [number, number];
type Resolved = Required<Omit<MedialOptions, "fit">> & { fit: FillFit };
type Grid = { W: number; H: number; cell: number; ox: number; oy: number };
/** 격자 위 획: 칸 좌표 점과 반지름(칸), 열린 끝이 골격 끝점인지 */
type GridPath = { pts: Pt[]; rad: number[]; closed: boolean; tipStart: boolean; tipEnd: boolean };

/** 덩어리들을 가변 굵기 획으로 바꾼다. 점이 하나라도 있는 덩어리는 적어도 획 하나를 낸다. */
export function medialStrokesFromShapes<C extends string>(shapes: ReadonlyArray<FillShape<C>>, options: MedialOptions = {}): MedialStroke<C>[] {
  const o = resolve(options);
  const out: MedialStroke<C>[] = [];
  shapes.forEach((shape, index) => {
    for (const s of shapeStrokes(shape, o)) out.push({ ...s, color: shape.color, shape: index });
  });
  return out;
}

/** 덩어리 하나. 결과의 shape는 0이다. */
export function medialStrokesFromShape<C extends string>(shape: FillShape<C>, options: MedialOptions = {}): MedialStroke<C>[] {
  return shapeStrokes(shape, resolve(options)).map(s => ({ ...s, color: shape.color, shape: 0 }));
}

// ---------------------------------------------------------------------------
// 옵션과 출력

function resolve(options: MedialOptions): Resolved {
  const pick = (v: number | undefined, d: number, ok: (x: number) => boolean) => (v !== undefined && Number.isFinite(v) && ok(v) ? v : d);
  const fit = options.fit && options.fit.scale > 0 && Number.isFinite(options.fit.scale) ? options.fit : { scale: 1, offsetX: 0, offsetY: 0 };
  const minWidth = pick(options.minWidth, 0, v => v >= 0);
  const maxWidth = Math.max(minWidth, options.maxWidth !== undefined && options.maxWidth > 0 ? options.maxWidth : Infinity);
  return {
    fit,
    minWidth,
    maxWidth,
    cellsPerWidth: pick(options.cellsPerWidth, MEDIAL_DEFAULTS.cellsPerWidth, v => v >= 2),
    maxCellsPerShape: pick(options.maxCellsPerShape, MEDIAL_DEFAULTS.maxCellsPerShape, v => v >= 1000),
    spurRatio: pick(options.spurRatio, MEDIAL_DEFAULTS.spurRatio, v => v >= 0),
    maxTurnDegrees: pick(options.maxTurnDegrees, MEDIAL_DEFAULTS.maxTurnDegrees, v => v >= 0 && v <= 180),
    tolerance: pick(options.tolerance, MEDIAL_DEFAULTS.tolerance, v => v >= 0),
    smoothing: Math.floor(pick(options.smoothing, MEDIAL_DEFAULTS.smoothing, v => v >= 0 && v <= 20)),
    maxPointsPerStroke: Math.max(2, Math.floor(pick(options.maxPointsPerStroke, MEDIAL_DEFAULTS.maxPointsPerStroke, v => v >= 2))),
    coordinateStep: pick(options.coordinateStep, MEDIAL_DEFAULTS.coordinateStep, v => v >= 0),
  };
}

type Plain = { points: Array<[number, number]>; widths: number[]; closed: boolean };

function output([x, y]: Pt, o: Resolved): [number, number] {
  const X = o.fit.offsetX + x * o.fit.scale;
  const Y = o.fit.offsetY + y * o.fit.scale;
  const q = o.coordinateStep;
  return q > 0 ? [Math.round(X / q) * q, Math.round(Y / q) * q] : [X, Y];
}

function outWidth(diameterPx: number, o: Resolved) {
  const w = diameterPx * o.fit.scale;
  const c = Math.min(o.maxWidth, Math.max(o.minWidth, Number.isFinite(w) ? w : 0));
  return c > 0 ? c : Math.max(o.minWidth, 1e-3);
}

function dot(p: Pt, diameterPx: number, o: Resolved): Plain {
  return { points: [output(p, o)], widths: [outWidth(diameterPx, o)], closed: false };
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

function bboxDot(pts: ReadonlyArray<FillPoint>, o: Resolved): Plain {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return dot([(x0 + x1) / 2, (y0 + y1) / 2], Math.max(x1 - x0, y1 - y0), o);
}

function shapeStrokes(shape: FillShape<string>, o: Resolved): Plain[] {
  const rings = cleanRings(shape.rings);
  const all = rings.flat();
  if (all.length === 0) {
    const loose = shape.rings.flat().filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    return loose.length ? [bboxDot(loose, o)] : [];
  }
  const filled = rings.filter(r => r.length >= 3);
  const made = filled.length ? gridStrokes(filled, shape.strokeWidth, o) : null;
  if (!made || made.length === 0) return [bboxDot(all, o)];
  return made;
}

// ---------------------------------------------------------------------------
// 덩어리 하나

function gridStrokes(rings: Pt[][], strokeWidth: number | undefined, o: Resolved): Plain[] | null {
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
  const { W, H } = g, N = W * H;
  const mask = rasterize(rings, g);
  let inkCells = 0;
  for (let p = 0; p < N; p += 1) inkCells += mask[p];
  if (inkCells === 0) return null;

  const outside = new Uint8Array(N);
  for (let p = 0; p < N; p += 1) outside[p] = mask[p] ? 0 : 1;
  const sq = edtSq(outside, W, H);
  const D = new Float32Array(N);
  for (let p = 0; p < N; p += 1) D[p] = mask[p] ? Math.sqrt(sq[p]) - 0.5 : 0;

  const skel = mask.slice();
  thin(skel, W, H);
  const paths = skeletonPaths(skel, D, W, H, o);
  const segs = segmentIndex(rings, g);

  const toPx = (p: Pt): Pt => [g.ox + p[0] * cell, g.oy + p[1] * cell];
  const result: Plain[] = [];
  for (const path of paths) {
    const done = finishPath(path, mask, D, segs, W, H, o);
    for (const part of splitStroke(done, o.maxPointsPerStroke)) {
      result.push({
        points: part.pts.map(p => output(toPx(p), o)),
        widths: part.rad.map(r => outWidth(2 * r * cell, o)),
        closed: part.closed,
      });
    }
  }

  // 획이 하나도 지나지 않는 잉크 조각(세선화가 점 하나로 줄인 작은 조각 포함)은 가장 두꺼운 칸에 점 하나
  const label = new Int32Array(N);
  let count = 0;
  const peaks: number[] = [];
  for (let s = 0; s < N; s += 1) {
    if (!mask[s] || label[s]) continue;
    count += 1;
    label[s] = count;
    let best = s;
    const st = [s];
    while (st.length) {
      const p = st.pop() as number;
      if (D[p] > D[best]) best = p;
      for (const q of [p - 1, p + 1, p - W, p + W, p - W - 1, p - W + 1, p + W - 1, p + W + 1]) {
        if (mask[q] && !label[q]) { label[q] = count; st.push(q); }
      }
    }
    peaks.push(best);
  }
  const covered = new Uint8Array(count + 1);
  for (const path of paths) {
    for (const [x, y] of path.pts) {
      const p = Math.floor(y) * W + Math.floor(x);
      if (p >= 0 && p < N && label[p]) covered[label[p]] = 1;
    }
  }
  for (let c = 1; c <= count; c += 1) {
    if (covered[c]) continue;
    const p = peaks[c - 1];
    const d = refineDot(D, segs, W, H, (p % W) + 0.5, Math.floor(p / W) + 0.5);
    result.push(dot(toPx(d.p), 2 * d.r * cell, o));
  }
  return result;
}

// ---------------------------------------------------------------------------
// 격자 도구

/** 짝수-홀수 규칙, 칸 중심 기준. */
function rasterize(rings: Pt[][], g: Grid): Uint8Array {
  const { W, H } = g, mask = new Uint8Array(W * H), rows: number[][] = [];
  for (let j = 0; j < H; j += 1) rows.push([]);
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 1) {
      const p = r[i], q = r[(i + 1) % r.length];
      const ax = (p[0] - g.ox) / g.cell, ay = (p[1] - g.oy) / g.cell, bx = (q[0] - g.ox) / g.cell, by = (q[1] - g.oy) / g.cell;
      if (ay === by) continue;
      const j0 = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5)), j1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) - 0.5) - 1);
      const slope = (bx - ax) / (by - ay);
      for (let j = j0; j <= j1; j += 1) rows[j].push(ax + (j + 0.5 - ay) * slope);
    }
  }
  for (let j = 0; j < H; j += 1) {
    const xs = rows[j].sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5)), i1 = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
      for (let i = i0; i <= i1; i += 1) mask[j * W + i] ^= 1;
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
    let k = -1;
    for (let q = 0; q < len; q += 1) {
      if (g[q] >= INF) continue;
      if (k < 0) { k = 0; v[0] = q; z[0] = -INF; z[1] = INF; continue; }
      let s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (k > 0 && s <= z[k]) { k -= 1; s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      if (k === 0 && s <= z[0]) { v[0] = q; z[1] = INF; continue; }
      k += 1; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    if (k < 0) { for (let q = 0; q < len; q += 1) d[q] = INF; return; }
    k = 0;
    for (let q = 0; q < len; q += 1) {
      while (z[k + 1] < q) k += 1;
      d[q] = (q - v[k]) * (q - v[k]) + g[v[k]];
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

/** Guo-Hall 세선화(제자리). 가장자리 칸은 비어 있어야 한다(여백 2칸). */
function thin(m: Uint8Array, W: number, H: number) {
  let list: number[] = [];
  for (let p = 0; p < W * H; p += 1) if (m[p]) list.push(p);
  const del: number[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (let it = 0; it < 2; it += 1) {
      del.length = 0;
      for (const p of list) {
        const x = p % W, y = (p - x) / W;
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const p2 = m[p - W], p3 = m[p - W + 1], p4 = m[p + 1], p5 = m[p + W + 1];
        const p6 = m[p + W], p7 = m[p + W - 1], p8 = m[p - 1], p9 = m[p - W - 1];
        const C = (!p2 && (p3 || p4) ? 1 : 0) + (!p4 && (p5 || p6) ? 1 : 0) + (!p6 && (p7 || p8) ? 1 : 0) + (!p8 && (p9 || p2) ? 1 : 0);
        if (C !== 1) continue;
        const N1 = (p9 | p2) + (p3 | p4) + (p5 | p6) + (p7 | p8);
        const N2 = (p2 | p3) + (p4 | p5) + (p6 | p7) + (p8 | p9);
        const Nn = Math.min(N1, N2);
        if (Nn < 2 || Nn > 3) continue;
        const M = it === 0 ? (p6 | p7 | (p9 ? 0 : 1)) & p8 : (p2 | p3 | (p5 ? 0 : 1)) & p4;
        if (M === 0) del.push(p);
      }
      if (del.length) {
        changed = true;
        for (const p of del) m[p] = 0;
      }
    }
    if (changed) list = list.filter(p => m[p]);
  }
}

// ---------------------------------------------------------------------------
// 골격 그래프

type GNode = { x: number; y: number; r: number; pix: number[] };
type GEdge = { a: number; b: number; pix: number[]; len: number; alive: boolean; closed: boolean };

function skeletonPaths(skel: Uint8Array, D: Float32Array, W: number, H: number, o: Resolved): GridPath[] {
  const N = W * H;
  const off = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1]; // 위부터 시계 방향
  const pixels: number[] = [];
  for (let p = 0; p < N; p += 1) if (skel[p]) pixels.push(p);
  if (!pixels.length) return [];
  const neighbours = (p: number) => {
    const out: number[] = [];
    for (const d of off) if (skel[p + d]) out.push(p + d);
    return out;
  };
  // 칸 종류: 끝점(이웃 1개 또는 이웃이 서로 붙은 2개), 갈림길(이웃 3개 이상, 둘레 건너기 3번 이상)
  const kind = new Uint8Array(N); // 0 없음, 1 보통, 2 끝점, 3 갈림길
  for (const p of pixels) {
    let nb = 0, cn = 0;
    for (let k = 0; k < 8; k += 1) {
      const a = skel[p + off[k]], b = skel[p + off[(k + 1) % 8]];
      nb += a;
      if (!a && b) cn += 1;
    }
    kind[p] = nb <= 1 || cn === 1 ? 2 : cn >= 3 && nb >= 3 ? 3 : 1;
  }
  // 마디: 끝점 하나씩, 붙어 있는 갈림길 칸 묶음 하나씩
  const nodeOf = new Int32Array(N).fill(-1);
  const nodes: GNode[] = [];
  for (const p of pixels) {
    if (kind[p] < 2 || nodeOf[p] >= 0) continue;
    const id = nodes.length, pix: number[] = [];
    nodeOf[p] = id;
    const st = [p];
    while (st.length) {
      const q = st.pop() as number;
      pix.push(q);
      if (kind[q] !== 3) continue;
      for (const s of neighbours(q)) if (kind[s] === 3 && nodeOf[s] < 0) { nodeOf[s] = id; st.push(s); }
    }
    let sx = 0, sy = 0, r = 0;
    for (const q of pix) { sx += (q % W) + 0.5; sy += Math.floor(q / W) + 0.5; r = Math.max(r, D[q]); }
    nodes.push({ x: sx / pix.length, y: sy / pix.length, r, pix });
  }
  const edges: GEdge[] = [];
  const visited = new Uint8Array(N);
  const direct = new Set<string>();
  const lenOf = (pix: number[]) => {
    let l = 0;
    for (let i = 1; i < pix.length; i += 1) {
      const a = pix[i - 1], b = pix[i];
      l += Math.hypot((a % W) - (b % W), Math.floor(a / W) - Math.floor(b / W));
    }
    return l;
  };
  const step = (cur: number, prev: number, from: number, startLen: number) => {
    // 다음 칸: 다른 마디 칸이 붙어 있으면 그 마디에서 끝, 아니면 아직 안 간 보통 칸(네 방향 우선)
    let nodeHit = -1, next = -1, nextDiag = -1;
    for (let k = 0; k < 8; k += 1) {
      const s = cur + off[k];
      if (!skel[s] || s === prev) continue;
      if (nodeOf[s] >= 0) {
        if (nodeOf[s] === from && startLen < 3) continue;
        if (nodeHit < 0) nodeHit = s;
      } else if (!visited[s]) {
        if (k % 2 === 0) { if (next < 0) next = s; } else if (nextDiag < 0) nextDiag = s;
      }
    }
    return { nodeHit, next: next >= 0 ? next : nextDiag };
  };
  for (let id = 0; id < nodes.length; id += 1) {
    for (const q of nodes[id].pix) {
      for (const s of neighbours(q)) {
        if (nodeOf[s] >= 0) {
          const m = nodeOf[s];
          if (m === id) continue;
          const key = id < m ? `${id}:${m}` : `${m}:${id}`;
          if (direct.has(key)) continue;
          direct.add(key);
          edges.push({ a: id, b: m, pix: [q, s], len: lenOf([q, s]), alive: true, closed: false });
          continue;
        }
        if (visited[s]) continue;
        visited[s] = 1;
        const pix = [q, s];
        let prev = q, cur = s, end = -1;
        for (;;) {
          const { nodeHit, next } = step(cur, prev, id, pix.length);
          if (nodeHit >= 0) { pix.push(nodeHit); end = nodeOf[nodeHit]; break; }
          if (next < 0) break;
          // 계단 모서리 칸(지금 칸과 다음 칸에 모두 붙은 칸)은 지나간 것으로 둔다
          for (const d of off) {
            const c = cur + d;
            if (skel[c] && !visited[c] && nodeOf[c] < 0 && c !== next && isAdjacent(c, next, W)) visited[c] = 1;
          }
          visited[next] = 1;
          pix.push(next);
          prev = cur; cur = next;
        }
        if (end < 0) {
          // 막다른 칸: 끝점 마디를 새로 만든다
          end = nodes.length;
          nodes.push({ x: (cur % W) + 0.5, y: Math.floor(cur / W) + 0.5, r: D[cur], pix: [cur] });
        }
        edges.push({ a: id, b: end, pix, len: lenOf(pix), alive: true, closed: false });
      }
    }
  }
  // 마디 없는 고리(ㅇ처럼 갈림길이 없는 고리)
  for (const p of pixels) {
    if (visited[p] || nodeOf[p] >= 0) continue;
    visited[p] = 1;
    const pix = [p];
    let prev = -1, cur = p;
    for (;;) {
      let next = -1, nextDiag = -1;
      for (let k = 0; k < 8; k += 1) {
        const s = cur + off[k];
        if (!skel[s] || s === prev || visited[s] || nodeOf[s] >= 0) continue;
        if (k % 2 === 0) { if (next < 0) next = s; } else if (nextDiag < 0) nextDiag = s;
      }
      const n = next >= 0 ? next : nextDiag;
      if (n < 0) break;
      visited[n] = 1; pix.push(n); prev = cur; cur = n;
    }
    if (pix.length < 3) continue;
    const closed = isAdjacent(pix[0], pix[pix.length - 1], W) && pix.length >= 4;
    const a = nodes.length;
    nodes.push({ x: (p % W) + 0.5, y: Math.floor(p / W) + 0.5, r: D[p], pix: [p] });
    let b = a;
    if (!closed) {
      b = nodes.length;
      nodes.push({ x: (cur % W) + 0.5, y: Math.floor(cur / W) + 0.5, r: D[cur], pix: [cur] });
    } else pix.push(p);
    edges.push({ a, b, pix, len: lenOf(pix), alive: true, closed });
  }

  // 차수와 가시 가지 지우기
  const degree = () => {
    const deg = new Int32Array(nodes.length);
    for (const e of edges) if (e.alive) { deg[e.a] += 1; deg[e.b] += 1; }
    return deg;
  };
  // 한 갈림길의 가시는 한꺼번에 지운다(네모난 획 끝의 Y자 두 가시를 함께 지워야 끝이 모서리로 휘지 않는다).
  // 갈림길의 가지가 모두 가시면 가장 긴 것 하나는 남긴다.
  for (let round = 0; round < 4; round += 1) {
    const deg = degree();
    const spurs = new Map<number, GEdge[]>();
    for (const e of edges) {
      if (!e.alive || e.a === e.b) continue;
      const tipA = deg[e.a] === 1, tipB = deg[e.b] === 1;
      if (tipA === tipB) continue;
      const tip = tipA ? e.a : e.b, hub = tipA ? e.b : e.a;
      if (deg[hub] < 3) continue;
      const rTip = D[nodes[tip].pix[0]], rHub = nodes[hub].r;
      if (e.len + rTip - rHub < o.spurRatio * rHub + 1) {
        const list = spurs.get(hub);
        if (list) list.push(e); else spurs.set(hub, [e]);
      }
    }
    if (!spurs.size) break;
    for (const [hub, list] of spurs) {
      if (list.length >= deg[hub]) list.sort((x, y) => x.len - y.len).pop();
      for (const e of list) e.alive = false;
    }
  }
  // 가까운 갈림길 합치기(X자 교차가 두 갈림길과 짧은 다리로 갈라지는 것)
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  {
    const deg = degree();
    for (const e of edges) {
      if (!e.alive || e.a === e.b || deg[e.a] < 3 || deg[e.b] < 3) continue;
      if (e.len < 0.9 * Math.max(nodes[e.a].r, nodes[e.b].r) + 1) {
        const ra = find(e.a), rb = find(e.b);
        if (ra === rb) continue;
        e.alive = false;
        parent[rb] = ra;
        const A = nodes[ra], B = nodes[rb], wa = A.pix.length, wb = B.pix.length;
        A.x = (A.x * wa + B.x * wb) / (wa + wb); A.y = (A.y * wa + B.y * wb) / (wa + wb);
        A.r = Math.max(A.r, B.r); A.pix = A.pix.concat(B.pix);
      }
    }
    for (const e of edges) { e.a = find(e.a); e.b = find(e.b); }
  }

  // 갈림길마다 방향이 곧게 이어지는 가지끼리 짝짓기. 끝 번호 = 2 × 가지 + (0: a쪽, 1: b쪽)
  const live = edges.filter(e => e.alive);
  const at = new Map<number, number[]>();
  live.forEach((e, i) => {
    if (e.closed && e.a === e.b && degreeOf(live, e.a) === 1) return;
    for (const side of [0, 1]) {
      const n = side === 0 ? e.a : e.b;
      const list = at.get(n);
      if (list) list.push(2 * i + side); else at.set(n, [2 * i + side]);
    }
  });
  const pair = new Int32Array(2 * live.length).fill(-1);
  const coord = (p: number): Pt => [(p % W) + 0.5, Math.floor(p / W) + 0.5];
  const cosMax = Math.cos((o.maxTurnDegrees * Math.PI) / 180);
  for (const [n, ends] of at) {
    if (ends.length < 2) continue;
    const node = nodes[n];
    if (ends.length === 2) { pair[ends[0]] = ends[1]; pair[ends[1]] = ends[0]; continue; }
    const dirs = ends.map(end => {
      const e = live[end >> 1], pix = end & 1 ? e.pix.slice().reverse() : e.pix;
      const want = Math.min(Math.max(2, 1.5 * node.r), e.len / 2);
      let l = 0, k = 1;
      for (; k < pix.length - 1; k += 1) {
        const a = coord(pix[k - 1]), b = coord(pix[k]);
        l += Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l >= want) break;
      }
      const t = coord(pix[Math.min(k, pix.length - 1)]);
      const dx = t[0] - node.x, dy = t[1] - node.y, len = Math.hypot(dx, dy) || 1;
      return [dx / len, dy / len] as Pt;
    });
    const cand: Array<[number, number, number]> = [];
    for (let i = 0; i < ends.length; i += 1) for (let j = i + 1; j < ends.length; j += 1) {
      // 곧게 이어질수록 두 방향의 내적이 -1에 가깝다
      const straight = -(dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]);
      if (straight >= cosMax) cand.push([straight, i, j]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    const used = new Uint8Array(ends.length);
    for (const [, i, j] of cand) {
      if (used[i] || used[j]) continue;
      used[i] = used[j] = 1;
      pair[ends[i]] = ends[j]; pair[ends[j]] = ends[i];
    }
  }

  // 짝을 따라 가지 잇기
  const deg = degree();
  const usedEdge = new Uint8Array(live.length);
  const paths: GridPath[] = [];
  const walk = (startEnd: number) => {
    const seq: number[] = [];
    let end = startEnd, closed = false;
    for (;;) {
      const i = end >> 1;
      usedEdge[i] = 1;
      const e = live[i];
      const pix = end & 1 ? e.pix.slice().reverse() : e.pix;
      for (const p of pix) if (seq[seq.length - 1] !== p) seq.push(p);
      if (e.closed && e.a === e.b && pair[2 * i] < 0 && pair[2 * i + 1] < 0) { closed = true; break; }
      const arrive = end ^ 1, nxt = pair[arrive];
      if (nxt < 0) break;
      if (nxt === startEnd) { closed = true; break; }
      if (usedEdge[nxt >> 1]) break;
      end = nxt;
    }
    const first = startEnd & 1 ? live[startEnd >> 1].b : live[startEnd >> 1].a;
    const lastEnd = end ^ 1;
    const last = lastEnd & 1 ? live[lastEnd >> 1].b : live[lastEnd >> 1].a;
    if (closed && seq.length > 1 && seq[0] === seq[seq.length - 1]) seq.pop();
    paths.push({
      pts: seq.map(coord),
      rad: seq.map(p => Math.max(0.5, D[p])),
      closed,
      tipStart: !closed && deg[first] === 1,
      tipEnd: !closed && deg[last] === 1,
    });
  };
  for (let i = 0; i < live.length; i += 1) {
    for (const side of [0, 1]) {
      const end = 2 * i + side;
      if (!usedEdge[i] && pair[end] < 0) walk(end);
    }
  }
  for (let i = 0; i < live.length; i += 1) if (!usedEdge[i]) walk(2 * i);
  return paths;
}

function degreeOf(edges: GEdge[], n: number) {
  let d = 0;
  for (const e of edges) { if (e.a === n) d += 1; if (e.b === n) d += 1; }
  return d;
}

function isAdjacent(a: number, b: number, W: number) {
  const ax = a % W, bx = b % W;
  return a !== b && Math.abs(ax - bx) <= 1 && Math.abs((a - ax) / W - (b - bx) / W) <= 1;
}

// ---------------------------------------------------------------------------
// 획 다듬기

function sampleD(D: Float32Array, W: number, H: number, x: number, y: number) {
  const fx = Math.min(W - 1.001, Math.max(0, x - 0.5)), fy = Math.min(H - 1.001, Math.max(0, y - 0.5));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, p = j * W + i;
  return (D[p] * (1 - u) + D[p + 1] * u) * (1 - v) + (D[p + W] * (1 - u) + D[p + W + 1] * u) * v;
}

/**
 * 점 (x, y)에서 방향 (nx, ny)로 본 거리장 단면의 꼭대기. 거리장은 능선 양쪽에서 기울기 1인 천막 모양이라
 * 가운데 값 d0과 높은 쪽 이웃 d1(한 칸 떨어진)으로 꼭대기 위치 c = (d1 − d0 + 1) / 2, 높이 (d0 + d1 + 1) / 2를 얻는다.
 */
function ridge(D: Float32Array, W: number, H: number, x: number, y: number, nx: number, ny: number) {
  const d0 = sampleD(D, W, H, x, y), dp = sampleD(D, W, H, x + nx, y + ny), dm = sampleD(D, W, H, x - nx, y - ny);
  const side = dp >= dm ? 1 : -1, d1 = Math.max(dp, dm);
  const c = Math.min(1, Math.max(0, (d1 - d0 + 1) / 2));
  return { shift: side * c, peak: Math.max(d0, d0 + c) };
}

/** 점 하나: 가로, 세로로 거리장 꼭대기를 찾아 가운데를 고치고, 반지름은 윤곽까지의 정확한 거리로 둔다. */
function refineDot(D: Float32Array, segs: SegIndex, W: number, H: number, x: number, y: number): { p: Pt; r: number } {
  const a = ridge(D, W, H, x, y, 1, 0), b = ridge(D, W, H, x, y, 0, 1);
  const p: Pt = [x + a.shift, y + b.shift];
  const reach = Math.max(a.peak, b.peak) + 3;
  const exact = nearestSegment(segs, p[0], p[1], reach);
  return { p, r: Math.max(0.5, exact < reach ? exact : Math.max(a.peak, b.peak)) };
}

// ---------------------------------------------------------------------------
// 고리 선분 찾기(칸 좌표). 덩어리 격자를 S칸 묶음으로 나눈 칸마다 지나는 선분 번호.

type SegIndex = { ax: Float64Array; ay: Float64Array; bx: Float64Array; by: Float64Array; S: number; NX: number; NY: number; start: Int32Array; list: Int32Array };

function segmentIndex(rings: Pt[][], g: Grid): SegIndex {
  let n = 0;
  for (const r of rings) n += r.length;
  const ax = new Float64Array(n), ay = new Float64Array(n), bx = new Float64Array(n), by = new Float64Array(n);
  let k = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 1) {
      const p = r[i], q = r[(i + 1) % r.length];
      ax[k] = (p[0] - g.ox) / g.cell; ay[k] = (p[1] - g.oy) / g.cell; bx[k] = (q[0] - g.ox) / g.cell; by[k] = (q[1] - g.oy) / g.cell;
      k += 1;
    }
  }
  const S = 4, NX = Math.ceil(g.W / S) + 1, NY = Math.ceil(g.H / S) + 1;
  const range = (i: number) => {
    const x0 = Math.max(0, Math.min(NX - 1, Math.floor(Math.min(ax[i], bx[i]) / S))), x1 = Math.max(0, Math.min(NX - 1, Math.floor(Math.max(ax[i], bx[i]) / S)));
    const y0 = Math.max(0, Math.min(NY - 1, Math.floor(Math.min(ay[i], by[i]) / S))), y1 = Math.max(0, Math.min(NY - 1, Math.floor(Math.max(ay[i], by[i]) / S)));
    return [x0, x1, y0, y1];
  };
  const count = new Int32Array(NX * NY + 1);
  for (let i = 0; i < n; i += 1) {
    const [x0, x1, y0, y1] = range(i);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) count[y * NX + x + 1] += 1;
  }
  for (let c = 0; c < NX * NY; c += 1) count[c + 1] += count[c];
  const start = count.slice(), fillAt = count.slice(), list = new Int32Array(count[NX * NY]);
  for (let i = 0; i < n; i += 1) {
    const [x0, x1, y0, y1] = range(i);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) list[fillAt[y * NX + x]++] = i;
  }
  return { ax, ay, bx, by, S, NX, NY, start, list };
}

/** (x, y)에서 가장 가까운 선분까지 거리. limit 안에 없으면 limit 이상의 값. */
function nearestSegment(s: SegIndex, x: number, y: number, limit: number) {
  const c0 = Math.max(0, Math.floor((x - limit) / s.S)), c1 = Math.min(s.NX - 1, Math.floor((x + limit) / s.S));
  const r0 = Math.max(0, Math.floor((y - limit) / s.S)), r1 = Math.min(s.NY - 1, Math.floor((y + limit) / s.S));
  let best = limit * limit;
  for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) {
    const b = r * s.NX + c;
    for (let k = s.start[b]; k < s.start[b + 1]; k += 1) {
      const i = s.list[k], dx = s.bx[i] - s.ax[i], dy = s.by[i] - s.ay[i], l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax[i]) * dx + (y - s.ay[i]) * dy) / l2)) : 0;
      const ex = x - s.ax[i] - t * dx, ey = y - s.ay[i] - t * dy, d2 = ex * ex + ey * ey;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

/** (x, y)에서 방향 (dx, dy)(단위 벡터)로 쏜 반직선이 처음 만나는 선분까지 거리. limit 안에 없으면 limit. */
function rayHit(s: SegIndex, x: number, y: number, dx: number, dy: number, limit: number) {
  const ex = x + dx * limit, ey = y + dy * limit;
  const c0 = Math.max(0, Math.floor(Math.min(x, ex) / s.S)), c1 = Math.min(s.NX - 1, Math.floor(Math.max(x, ex) / s.S));
  const r0 = Math.max(0, Math.floor(Math.min(y, ey) / s.S)), r1 = Math.min(s.NY - 1, Math.floor(Math.max(y, ey) / s.S));
  let best = limit;
  for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) {
    const b = r * s.NX + c;
    for (let k = s.start[b]; k < s.start[b + 1]; k += 1) {
      const i = s.list[k], qx = s.bx[i] - s.ax[i], qy = s.by[i] - s.ay[i];
      const den = dx * qy - dy * qx;
      if (Math.abs(den) < 1e-12) continue;
      const wx = s.ax[i] - x, wy = s.ay[i] - y;
      const t = (wx * qy - wy * qx) / den, u = (wx * dy - wy * dx) / den;
      if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
    }
  }
  return best;
}

function inside(mask: Uint8Array, W: number, H: number, x: number, y: number) {
  const i = Math.floor(x), j = Math.floor(y);
  return i >= 0 && j >= 0 && i < W && j < H && mask[j * W + i] === 1;
}

function finishPath(path: GridPath, mask: Uint8Array, D: Float32Array, segs: SegIndex, W: number, H: number, o: Resolved): GridPath {
  let pts = path.pts.map(p => [p[0], p[1]] as Pt), rad = path.rad.slice();
  let n = pts.length;
  if (n === 1) {
    const d = refineDot(D, segs, W, H, pts[0][0], pts[0][1]);
    return { ...path, pts: [d.p], rad: [d.r] };
  }
  // 이웃 평균으로 다듬기(열린 획은 양 끝 고정)
  for (let it = 0; it < o.smoothing; it += 1) {
    const np = pts.map(p => [p[0], p[1]] as Pt), nr = rad.slice();
    for (let i = 0; i < n; i += 1) {
      if (!path.closed && (i === 0 || i === n - 1)) continue;
      const a = (i - 1 + n) % n, b = (i + 1) % n;
      np[i] = [0.25 * pts[a][0] + 0.5 * pts[i][0] + 0.25 * pts[b][0], 0.25 * pts[a][1] + 0.5 * pts[i][1] + 0.25 * pts[b][1]];
      nr[i] = 0.25 * rad[a] + 0.5 * rad[i] + 0.25 * rad[b];
    }
    pts = np; rad = nr;
  }
  // 가운데 맞추기: 골격 칸은 칸 중심에 묶여 있고 비스듬한 획에서는 계단처럼 흔들린다. 획에 수직인 양쪽으로
  // 원래 윤곽(고리 선분)까지 거리를 재어 가운데로 옮기고, 반지름은 그 점에서 윤곽까지의 정확한 거리로 둔다.
  // 갈림길처럼 양쪽 거리가 크게 다르면 옮기지 않는다(내접원 반지름만 쓴다).
  for (let i = 0; i < n; i += 1) {
    const ia = path.closed ? (i - 2 + 2 * n) % n : Math.max(0, i - 2), ib = path.closed ? (i + 2) % n : Math.min(n - 1, i + 2);
    const tx = pts[ib][0] - pts[ia][0], ty = pts[ib][1] - pts[ia][1], tl = Math.hypot(tx, ty);
    const reach = 3 * rad[i] + 3;
    if (tl > 0) {
      const nx = -ty / tl, ny = tx / tl;
      const dl = rayHit(segs, pts[i][0], pts[i][1], nx, ny, reach), dr = rayHit(segs, pts[i][0], pts[i][1], -nx, -ny, reach);
      if (dl < reach && dr < reach && Math.abs(dl - dr) < 0.6 * (dl + dr)) {
        const sh = Math.max(-1.5, Math.min(1.5, (dl - dr) / 2));
        pts[i] = [pts[i][0] + nx * sh, pts[i][1] + ny * sh];
      }
    }
    const exact = nearestSegment(segs, pts[i][0], pts[i][1], reach);
    rad[i] = Math.max(0.5, exact < reach ? exact : rad[i]);
  }
  // 열린 끝에서 앞 점의 원 안에 들어가는 점은 버린다. 세선화 골격은 둥근 끝 안쪽까지 뻗어 반지름이 0으로 줄어드는데,
  // 그 점을 남기면 점 줄이기 뒤 반지름이 선형으로 줄어 끝이 뾰족해진다.
  const inDisc = (j: number, k: number) => Math.hypot(pts[j][0] - pts[k][0], pts[j][1] - pts[k][1]) + rad[j] <= rad[k] + 0.15;
  const swallowed = (j: number, from: number, to: number) => {
    for (let k = from; k !== to; k += from < to ? 1 : -1) if (inDisc(j, k)) return true;
    return false;
  };
  if (path.tipEnd) while (pts.length > 2 && swallowed(pts.length - 1, pts.length - 2, Math.max(-1, pts.length - 16))) { pts.pop(); rad.pop(); }
  if (path.tipStart) while (pts.length > 2 && swallowed(0, 1, Math.min(pts.length, 16))) { pts.shift(); rad.shift(); }
  n = pts.length;
  // 반지름 떨림(칸 단위 거리장에서 오는) 줄이기
  for (let it = 0; it < 2; it += 1) {
    const nr = rad.slice();
    for (let i = 0; i < n; i += 1) {
      if (!path.closed && (i === 0 || i === n - 1)) continue;
      nr[i] = 0.25 * rad[(i - 1 + n) % n] + 0.5 * rad[i] + 0.25 * rad[(i + 1) % n];
    }
    rad = nr;
  }
  // 열린 끝 늘이기: 둥근 끝이 원래 끝까지 닿게
  const extend = (forward: boolean) => {
    const idx = forward ? n - 1 : 0, dir = forward ? -1 : 1;
    const p = pts[idx], r = rad[idx];
    let k = idx, l = 0;
    while (k + dir >= 0 && k + dir < n && l < Math.max(2, r)) { l += Math.hypot(pts[k + dir][0] - pts[k][0], pts[k + dir][1] - pts[k][1]); k += dir; }
    const tx0 = p[0] - pts[k][0], ty0 = p[1] - pts[k][1], tl = Math.hypot(tx0, ty0);
    if (!(tl > 0)) return null;
    const tx = tx0 / tl, ty = ty0 / tl;
    let sMax = 0;
    while (sMax < 3 * r + 3 && inside(mask, W, H, p[0] + tx * (sMax + 0.25), p[1] + ty * (sMax + 0.25))) sMax += 0.25;
    for (let s = 0; s <= sMax; s += 0.25) {
      const x = p[0] + tx * s, y = p[1] + ty * s;
      const rs = Math.max(0.5, Math.min(r, nearestSegment(segs, x, y, r + 1)));
      if (s + rs >= sMax + 0.25) return s > 0.3 ? { p: [x, y] as Pt, r: rs } : null;
    }
    return null;
  };
  const head = path.tipStart ? extend(false) : null, tail = path.tipEnd ? extend(true) : null;
  if (head) { pts.unshift(head.p); rad.unshift(head.r); }
  if (tail) { pts.push(tail.p); rad.push(tail.r); }
  // 점 줄이기
  const sorted = rad.slice().sort((a, b) => a - b);
  const tol = Math.max(0.2, o.tolerance * 2 * sorted[sorted.length >> 1]);
  let keep: number[];
  if (path.closed) {
    let far = 0, best = -1;
    for (let i = 1; i < pts.length; i += 1) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > best) { best = d; far = i; } }
    const ring = pts.concat([pts[0]]), rr = rad.concat([rad[0]]);
    const a = rdp(ring, rr, 0, far, tol), b = rdp(ring, rr, far, ring.length - 1, tol);
    keep = a.concat(b.slice(1));
  } else keep = rdp(pts, rad, 0, pts.length - 1, tol);
  const outPts: Pt[] = [], outRad: number[] = [];
  const m = pts.length;
  for (const i of keep) { outPts.push(pts[i % m]); outRad.push(rad[i % m]); }
  // 길이가 거의 없는 획은 점 하나로
  let span = 0;
  for (const p of outPts) span = Math.max(span, Math.hypot(p[0] - outPts[0][0], p[1] - outPts[0][1]));
  if (span < 0.5) {
    let r = 0;
    for (const v of outRad) r = Math.max(r, v);
    return { ...path, pts: [outPts[0]], rad: [r], closed: false };
  }
  return { ...path, pts: outPts, rad: outRad };
}

/** 점과 반지름을 함께 보는 Ramer-Douglas-Peucker. 남길 번호(처음과 끝 포함)를 돌려준다. */
function rdp(pts: Pt[], rad: number[], s: number, e: number, tol: number): number[] {
  const keep = new Uint8Array(e + 1);
  keep[s] = keep[e] = 1;
  const stack: Array<[number, number]> = [[s, e]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    if (b - a < 2) continue;
    const ax = pts[a][0], ay = pts[a][1], dx = pts[b][0] - ax, dy = pts[b][1] - ay, l2 = dx * dx + dy * dy;
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i += 1) {
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2)) : 0;
      const dp = Math.hypot(pts[i][0] - ax - t * dx, pts[i][1] - ay - t * dy);
      const dr = Math.abs(rad[i] - (rad[a] + t * (rad[b] - rad[a])));
      const v = Math.max(dp, 2 * dr);
      if (v > worst) { worst = v; wi = i; }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  const out: number[] = [];
  for (let i = s; i <= e; i += 1) if (keep[i]) out.push(i);
  return out;
}

function splitStroke(p: GridPath, max: number): GridPath[] {
  const pts = p.closed && p.pts.length > 1 ? p.pts.concat([p.pts[0]]) : p.pts;
  const rad = p.closed && p.pts.length > 1 ? p.rad.concat([p.rad[0]]) : p.rad;
  if (pts.length <= max) return [{ ...p, pts, rad }];
  const parts: GridPath[] = [];
  for (let i = 0; i < pts.length - 1; i += max - 1) {
    const j = Math.min(pts.length, i + max);
    parts.push({ ...p, pts: pts.slice(i, j), rad: rad.slice(i, j), closed: false });
  }
  return parts;
}

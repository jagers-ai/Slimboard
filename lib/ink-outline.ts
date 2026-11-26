/**
 * 화이트보드 사진에서 손글씨를 윤곽(채움 모양)으로 뽑는다.
 *
 * 단계
 * 1. 긴 변 maxSide 이하로 줄이고(면적 평균), 배경 밝기를 추정해 농도 D = (배경 - 휘도) / 배경을 구한다.
 * 2. 농도의 바탕 수준과 잡음을 최빈값 기준으로 재서 문턱 low, high를 정한다.
 * 3. 굵은 덩어리(테두리, 자석, 그림자)와 그 둘레를 제외하고, low 이상인 곳을 1px 넓혀 그룹으로 묶는다.
 * 4. 그룹이 있는 곳만 Lanczos3로 2배 확대한 농도에 국소 문턱 t = max(low, min((국소최대 + 국소최소) / 2, 0.6 국소최대))을
 *    적용한다. 창 크기는 대표 획 굵기에서 정한다.
 * 5. 번져서 붙은 두 획 사이와 메워진 글자 속의 골짜기를 잘라 낸다(cutValleys).
 * 6. 0 등고선을 marching squares로 따서 고리(바깥 고리와 구멍)를 만들고, 색이 섞인 조각은 색 경계에서 나눈다.
 * 7. 조각을 넓이, 최고 농도, 칸별 잡음, 굵기, 덩어리와의 거리로 걸러 지운 자국, 얼룩, 그림자, 잡음 알갱이를 뺀다.
 * 8. 고리를 Ramer-Douglas-Peucker로 줄이고 입력 픽셀 좌표로 돌려준다.
 *
 * 출력 좌표는 입력 이미지 픽셀의 연속 좌표다(픽셀 (i, j)의 중심이 (i + 0.5, j + 0.5)). 한 모양의 고리들은
 * 짝수-홀수 규칙으로 채운다. 브라우저, Web Worker, Node에서 외부 패키지 없이 돈다.
 */

import {
  downsample,
  estimateBackground,
  inkContrastMap,
  inkDistance2,
  labelComponents,
  localMax,
  sqDistanceTo,
  type Background,
  type InkColor,
  type InkImageInput,
} from "./ink-strokes.ts";

export type { InkColor, InkImageInput };
export type InkOutlinePoint = [number, number];

export interface InkOutlineShape {
  color: InkColor;
  rings: InkOutlinePoint[][];
  area: number;
  strokeWidth: number;
}

export interface InkOutlineOptions {
  /** 처리 해상도의 긴 변(px). 입력이 더 크면 줄여서 처리한다. 기본 2000. */
  maxSide?: number;
  /** 잉크로 볼 최소 농도(배경 대비 어두운 비율). 기본 0.14. */
  inkContrast?: number;
  /** 이보다 굵은 덩어리는 글씨가 아닌 물체로 본다(입력 px). */
  maxStrokeWidth?: number;
  /** 고리 단순화 허용 오차(입력 px). 기본은 획 굵기의 5%. */
  simplifyTolerance?: number;
  /** 모양 수 상한. 넘으면 작은 것부터 버린다. */
  maxShapes?: number;
  /** 전체 꼭짓점 수 상한. 넘으면 작은 것부터 버린다. */
  maxPoints?: number;
}

export interface InkOutlineResult {
  width: number;
  height: number;
  shapes: InkOutlineShape[];
  /** 상한 때문에 모양을 버렸으면 true. */
  truncated: boolean;
  /** 처리 해상도 / 입력 해상도. */
  scale: number;
  /** 사진 전체의 대표 획 굵기(입력 px). */
  strokeWidth: number;
}

const DEFAULTS = { maxSide: 2000, maxShapes: 20000, maxPoints: 600000, inkContrast: 0.14 };
const COLORS: InkColor[] = ["black", "red", "blue", "green"];

/** 국소 문턱의 상한: 국소 최대 농도에 곱하는 비율. */
const THRESHOLD_CAP = 0.6;
/** 국소 최소를 재는 창 반경(획 굵기 배수). */
const MIN_WINDOW = 0.8;
/** 국소 최대를 재는 창 반경(획 굵기 배수). */
const MAX_WINDOW = 0.7;
/**
 * 조각의 최고 농도가 이보다 낮으면 버린다. 지운 자국의 잔상과 얼룩은 0.16 안팎에서 멈추고,
 * 흐리고 작은 글씨도 0.2 아래로 내려가는 일이 드물다.
 */
const MIN_PEAK = 0.18;
/** 살짝 흐린 1배 농도로 잰 최고값의 하한. 넓고 옅은 자국은 잡음 알갱이 하나로 MIN_PEAK를 넘기도 한다. */
const MIN_PEAK_SMOOTH = 0.15;
/** 조각의 최고 농도가 칸별 바탕 수준 + 잡음의 이 배수보다 낮으면 잡음 알갱이로 본다. */
const NOISE_K = 6;

function emptyResult(width: unknown, height: unknown, scale = 1): InkOutlineResult {
  const safe = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { width: safe(width), height: safe(height), shapes: [], truncated: false, scale, strokeWidth: 0 };
}

function positive(v: number | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * 대비 지도의 바탕 수준과 잡음 크기. 글씨가 사진의 넓은 몫을 덮으면 중앙값과 MAD가 잉크 쪽으로 끌려가
 * 문턱이 치솟는다. 잉크는 대비를 한쪽(양수)으로만 늘리므로 최빈값을 바탕으로 보고, 최빈값보다 작은 쪽의
 * 편차만으로 잡음을 잰다.
 */
function backgroundNoise(d: Float32Array): { median: number; sigma: number } {
  const bins = 4000;
  const lo = -1;
  const span = 2;
  const hist = new Int32Array(bins);
  const step = Math.max(1, Math.floor(d.length / 400000));
  for (let i = 0; i < d.length; i += step) {
    let b = Math.floor(((d[i] - lo) / span) * bins);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    hist[b]++;
  }
  // 이웃 다섯 칸 합이 가장 큰 곳을 최빈값으로 본다.
  let mb = 0;
  let best = -1;
  for (let b = 2; b < bins - 2; b++) {
    const v = hist[b - 2] + hist[b - 1] + hist[b] + hist[b + 1] + hist[b + 2];
    if (v > best) {
      best = v;
      mb = b;
    }
  }
  let below = 0;
  for (let b = 0; b < mb; b++) below += hist[b];
  below += hist[mb] / 2;
  let cum = 0;
  let k = 0;
  for (let b = mb; b >= 0; b--) {
    cum += b === mb ? hist[b] / 2 : hist[b];
    if (cum >= below / 2) {
      k = mb - b;
      break;
    }
  }
  const bw = span / bins;
  return { median: lo + (mb + 0.5) * bw, sigma: 1.4826 * Math.max(0.5, k) * bw };
}

/**
 * 칸마다 대비 지도(흐리지 않은 것)의 바탕 수준과 잡음을 잰다. 조명이 어두운 곳은 같은 센서 잡음도 대비로는
 * 커지므로 사진 전체의 잡음 하나로는 어두운 구석의 잡음 알갱이를 거르지 못한다. 잉크는 값을 위로만 밀므로
 * 글씨가 칸의 3/4을 덮지 않는 한 아래쪽 분위수(10%, 25%)는 바탕이다. 그 차이로 잡음을 재고, 바탕이 고르지
 * 않은 칸이 잡음을 부풀리지 않게 이웃 3x3 칸의 최솟값을 쓴다.
 */
function localNoise(raw: Float32Array, pw: number, ph: number, block: number): { gw: number; gh: number; level: Float32Array; sigma: Float32Array } {
  const gw = Math.ceil(pw / block);
  const gh = Math.ceil(ph / block);
  const level = new Float32Array(gw * gh);
  const sig = new Float32Array(gw * gh);
  const step = block >= 16 ? 2 : 1;
  const buf = new Float32Array(Math.ceil(block / step) ** 2);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let n = 0;
      const y1 = Math.min(ph, (by + 1) * block);
      const x1 = Math.min(pw, (bx + 1) * block);
      for (let y = by * block; y < y1; y += step) for (let x = bx * block; x < x1; x += step) buf[n++] = raw[y * pw + x];
      const a = buf.subarray(0, n).sort();
      const q25 = a[n >> 2];
      const s = (q25 - a[Math.floor(n * 0.1)]) / 0.6071;
      level[by * gw + bx] = q25 + 0.6745 * s;
      sig[by * gw + bx] = s;
    }
  }
  const sigma = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let v = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = by + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = bx + dx;
          if (xx >= 0 && xx < gw && sig[yy * gw + xx] < v) v = sig[yy * gw + xx];
        }
      }
      sigma[by * gw + bx] = v;
    }
  }
  return { gw, gh, level, sigma };
}

function classifyColor(tr: number, tg: number, tb: number): number {
  const ab = (t: number): number => -Math.log(Math.min(1, Math.max(0.02, t)));
  const ar = ab(tr);
  const ag = ab(tg);
  const a3 = ab(tb);
  const max = Math.max(ar, ag, a3);
  const ch = max - Math.min(ar, ag, a3);
  if (ch < 0.06 || ch / max < 0.2) return 0;
  let h = max === ar ? 60 * (((ag - a3) / ch + 6) % 6) : max === ag ? 60 * ((a3 - ar) / ch + 2) : 60 * ((ar - ag) / ch + 4);
  h = (h + 180) % 360;
  if (h >= 300 || h < 40) return 1;
  if (h >= 75 && h < 170) return 3;
  if (h >= 170 && h < 285) return 2;
  return 0;
}

/** 배경 격자를 처리 해상도 전체로 쌍선형 보간한다. */
function backgroundMap(grid: Float32Array, bg: Background, pw: number, ph: number): Float32Array {
  const out = new Float32Array(pw * ph);
  const ix = new Int32Array(pw);
  const jx = new Int32Array(pw);
  const tx = new Float32Array(pw);
  for (let x = 0; x < pw; x++) {
    let gx = (x + 0.5) / bg.block - 0.5;
    if (gx < 0) gx = 0;
    else if (gx > bg.gw - 1) gx = bg.gw - 1;
    ix[x] = Math.floor(gx);
    jx[x] = ix[x] < bg.gw - 1 ? ix[x] + 1 : ix[x];
    tx[x] = gx - ix[x];
  }
  for (let y = 0; y < ph; y++) {
    let gy = (y + 0.5) / bg.block - 0.5;
    if (gy < 0) gy = 0;
    else if (gy > bg.gh - 1) gy = bg.gh - 1;
    const iy = Math.floor(gy);
    const jy = iy < bg.gh - 1 ? iy + 1 : iy;
    const ty = gy - iy;
    const ra = iy * bg.gw;
    const rb = jy * bg.gw;
    const o = y * pw;
    for (let x = 0; x < pw; x++) {
      const a = grid[ra + ix[x]] * (1 - tx[x]) + grid[ra + jx[x]] * tx[x];
      const b = grid[rb + ix[x]] * (1 - tx[x]) + grid[rb + jx[x]] * tx[x];
      out[o + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2배 확대와 창 필터

const LANCZOS = ((): { base: number; w: Float64Array }[] => {
  const a = 3;
  const ker = (x: number): number => {
    x = Math.abs(x);
    if (x < 1e-9) return 1;
    if (x >= a) return 0;
    const p = Math.PI * x;
    return (a * Math.sin(p) * Math.sin(p / a)) / (p * p);
  };
  const out: { base: number; w: Float64Array }[] = [];
  for (let f = 0; f < 2; f++) {
    const c = (f + 0.5) / 2 - 0.5;
    const b = Math.floor(c);
    const w = new Float64Array(6);
    let s = 0;
    for (let j = 0; j < 6; j++) {
      w[j] = ker(c - (b + j - 2));
      s += w[j];
    }
    for (let j = 0; j < 6; j++) w[j] /= s;
    out.push({ base: b - 2, w });
  }
  return out;
})();

/** src(pw×ph)의 [ox, ox+bw)×[oy, oy+bh) 영역을 Lanczos3로 2배 확대한다. 출력 (X+0.5)/2가 입력 연속좌표다. */
function upscale2(src: Float32Array, pw: number, ph: number, ox: number, oy: number, bw: number, bh: number): Float32Array {
  const W2 = bw * 2;
  const H2 = bh * 2;
  const sy0 = Math.max(0, oy - 3);
  const sy1 = Math.min(ph, oy + bh + 3);
  const rows = sy1 - sy0;
  const col = new Int32Array(W2 * 6);
  for (let X = 0; X < W2; X++) {
    const base = ox + (X >> 1) + LANCZOS[X & 1].base;
    for (let j = 0; j < 6; j++) {
      const x = base + j;
      col[X * 6 + j] = x < 0 ? 0 : x >= pw ? pw - 1 : x;
    }
  }
  const tmp = new Float32Array(W2 * rows);
  const w0 = LANCZOS[0].w;
  const w1 = LANCZOS[1].w;
  for (let r = 0; r < rows; r++) {
    const row = (sy0 + r) * pw;
    const o = r * W2;
    for (let X = 0; X < W2; X++) {
      const w = X & 1 ? w1 : w0;
      const c = X * 6;
      tmp[o + X] =
        src[row + col[c]] * w[0] +
        src[row + col[c + 1]] * w[1] +
        src[row + col[c + 2]] * w[2] +
        src[row + col[c + 3]] * w[3] +
        src[row + col[c + 4]] * w[4] +
        src[row + col[c + 5]] * w[5];
    }
  }
  const out = new Float32Array(W2 * H2);
  for (let Y = 0; Y < H2; Y++) {
    const { base, w } = LANCZOS[Y & 1];
    const o = Y * W2;
    for (let j = 0; j < 6; j++) {
      let y = oy + (Y >> 1) + base + j;
      y = y < 0 ? 0 : y >= ph ? ph - 1 : y;
      const r = (y - sy0) * W2;
      const g = w[j];
      for (let X = 0; X < W2; X++) out[o + X] += tmp[r + X] * g;
    }
  }
  return out;
}

/** 반경 r 정사각 창의 최댓값(sign = 1) 또는 최솟값(sign = -1). van Herk 분리 필터. */
function extremum(src: Float32Array, W: number, H: number, r: number, sign: number): Float32Array {
  const size = 2 * r + 1;
  const n = Math.max(W, H) + 2 * r;
  const line = new Float32Array(n);
  const fwd = new Float32Array(n);
  const bwd = new Float32Array(n);
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const run = (len: number): void => {
    const total = len + 2 * r;
    for (let i = 0; i < r; i++) {
      line[i] = -Infinity;
      line[r + len + i] = -Infinity;
    }
    for (let i = 0; i < total; i++) fwd[i] = i % size === 0 || line[i] > fwd[i - 1] ? line[i] : fwd[i - 1];
    for (let i = total - 1; i >= 0; i--) {
      bwd[i] = i === total - 1 || (i + 1) % size === 0 || line[i] > bwd[i + 1] ? line[i] : bwd[i + 1];
    }
  };
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) line[r + x] = sign * src[row + x];
    run(W);
    for (let x = 0; x < W; x++) tmp[row + x] = bwd[x] > fwd[x + size - 1] ? bwd[x] : fwd[x + size - 1];
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) line[r + y] = tmp[y * W + x];
    run(H);
    for (let y = 0; y < H; y++) out[y * W + x] = sign * (bwd[y] > fwd[y + size - 1] ? bwd[y] : fwd[y + size - 1]);
  }
  return out;
}

/** 반경 r 상자 평균(가장자리는 끝값 반복). 제자리에서 바꾼다. */
function boxBlur(a: Float32Array, W: number, H: number, r: number): Float32Array {
  if (r < 1) return a;
  const n = 2 * r + 1;
  const line = new Float32Array(Math.max(W, H));
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let s = 0;
    for (let i = -r; i <= r; i++) s += a[o + Math.min(W - 1, Math.max(0, i))];
    for (let x = 0; x < W; x++) {
      line[x] = s / n;
      s += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
    }
    for (let x = 0; x < W; x++) a[o + x] = line[x];
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += a[Math.min(H - 1, Math.max(0, i)) * W + x];
    for (let y = 0; y < H; y++) {
      line[y] = s / n;
      s += a[Math.min(H - 1, y + r + 1) * W + x] - a[Math.max(0, y - r) * W + x];
    }
    for (let y = 0; y < H; y++) a[y * W + x] = line[y];
  }
  return a;
}

// ---------------------------------------------------------------------------
// 골짜기 자르기

/** 골짜기를 재는 거리(획 굵기 배수). */
const VALLEY_REACH = 0.5;
/** 양쪽보다 이 비율 밑으로 옅으면 골짜기로 본다. */
const VALLEY_DEPTH = 0.85;
/** 떼어 낸 두 덩어리가 모두 이 넓이(획 굵기 제곱 배수) 이상일 때만 자른다. 작은 조각은 같은 글자의 일부로 본다. */
const VALLEY_MIN_PART = 4;

/**
 * 흐린 사진에서는 가까운 두 획 사이 틈과 작은 글자의 속(ㅇ, ㅁ)이 번져 문턱을 넘는다. 그런 곳은 농도가 양쪽
 * (거리 L)보다 확실히 낮은 골짜기다. 골짜기 픽셀을 잉크에서 빼되, 뺀 자리가 실제로 두 덩어리를 떼어 놓거나
 * 덩어리 안쪽에 새 구멍을 낼 때만 남긴다. 한 획 안의 얼룩이나 획이 만나는 안쪽 모서리처럼 빼도 아무것도
 * 떨어지지 않는 곳은 되돌린다(고리 모양 글자에서 고리가 끊겨 구멍이 새는 일을 막는다). 떨어지는 쪽이
 * minPart보다 작으면 같은 글자의 가는 부분으로 보고 되돌린다. F는 제자리에서 바꾼다.
 */
function cutValleys(F: Float32Array, D: Float32Array, W: number, H: number, L: number, beta: number, minPart: number): void {
  const S = boxBlur(Float32Array.from(D), W, H, 1);
  const d = Math.max(1, Math.round(L * Math.SQRT1_2));
  const offs = [L, L * W, d * (W + 1), d * (W - 1)];
  const cut = new Uint8Array(W * H);
  let any = false;
  for (let Y = L; Y < H - L; Y++) {
    for (let X = L; X < W - L; X++) {
      const i = Y * W + X;
      if (F[i] <= 0) continue;
      const v = S[i];
      for (const o of offs) {
        const a = S[i + o];
        const b = S[i - o];
        if (v < beta * (a < b ? a : b) && F[i + o] > 0 && F[i - o] > 0) {
          cut[i] = 1;
          any = true;
          break;
        }
      }
    }
  }
  if (!any) return;
  const rest = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) rest[i] = F[i] > 0 && !cut[i] ? 1 : 0;
  const parts = labelComponents(rest, W, H, true);
  const cuts = labelComponents(cut, W, H, true);
  const n = cuts.count;
  const first = new Int32Array(n + 1);
  const second = new Int32Array(n + 1);
  const touchBg = new Uint8Array(n + 1);
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const i = Y * W + X;
      const c = cuts.labels[i];
      if (!c) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = X + dx;
          if (xx < 0 || xx >= W) continue;
          const j = yy * W + xx;
          if (F[j] <= 0) {
            if (dx === 0 || dy === 0) touchBg[c] = 1;
            continue;
          }
          const l = parts.labels[j];
          if (!l) continue;
          if (!first[c]) first[c] = l;
          else if (l !== first[c] && (!second[c] || parts.areas[l] > parts.areas[second[c]])) second[c] = l;
        }
      }
    }
  }
  // 뺀 자리에 닿은 덩어리가 둘 이상이면(뺀 뒤 라벨이 다르면) 다른 경로로 이어지지 않은 것, 즉 떨어진 것이다.
  // 바탕에 닿지 않은 자리는 덩어리 안쪽에 새 구멍을 낸다.
  const keep = new Uint8Array(n + 1);
  for (let c = 1; c <= n; c++) {
    if (second[c] && Math.min(parts.areas[first[c]], parts.areas[second[c]]) >= minPart) keep[c] = 1;
    else if (!touchBg[c]) keep[c] = 1;
  }
  for (let i = 0; i < W * H; i++) {
    const c = cuts.labels[i];
    if (c && keep[c]) F[i] = -1e-3;
  }
}

// ---------------------------------------------------------------------------
// 등고선

interface Ring {
  comp: number;
  xy: number[];
  area: number;
}

/**
 * F(W×H, 픽셀 중심 표본)의 0 등고선을 marching squares로 딴다. lab은 F > 0인 곳의 8연결 라벨이다.
 * 안장점은 잉크 쪽을 이어 8연결 라벨과 맞춘다. 격자 밖은 바탕으로 본다. 잉크를 진행 방향 오른쪽에 두므로
 * (화면 좌표) 바깥 고리의 넓이는 양수, 구멍은 음수다.
 */
function contours(F: Float32Array, W: number, H: number, lab: Int32Array): Ring[] {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? -1e-3 : F[y * W + x]);
  const PW = W + 2;
  const N = (W + 2) * (H + 2);
  const next = new Int32Array(2 * N).fill(-1);
  const starts: number[] = [];
  const seg = (s: number, e: number): void => {
    next[s] = e;
    starts.push(s);
  };
  for (let y = -1; y < H; y++) {
    for (let x = -1; x < W; x++) {
      const a = at(x, y) > 0;
      const b = at(x + 1, y) > 0;
      const c = at(x + 1, y + 1) > 0;
      const d = at(x, y + 1) > 0;
      const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const p = (y + 1) * PW + x + 1;
      const T = 2 * p;
      const B = 2 * (p + PW);
      const L = 2 * p + 1;
      const R = 2 * (p + 1) + 1;
      switch (code) {
        case 1: seg(T, L); break;
        case 2: seg(R, T); break;
        case 4: seg(B, R); break;
        case 8: seg(L, B); break;
        case 3: seg(R, L); break;
        case 6: seg(B, T); break;
        case 12: seg(L, R); break;
        case 9: seg(T, B); break;
        case 14: seg(L, T); break;
        case 13: seg(T, R); break;
        case 11: seg(R, B); break;
        case 7: seg(B, L); break;
        case 5: seg(T, R); seg(B, L); break;
        case 10: seg(R, B); seg(L, T); break;
      }
    }
  }
  const out: Ring[] = [];
  for (const s0 of starts) {
    if (next[s0] < 0) continue;
    const xy: number[] = [];
    let e = s0;
    let comp = 0;
    while (next[e] >= 0) {
      const p = e >> 1;
      const px = (p % PW) - 1;
      const py = ((p / PW) | 0) - 1;
      const ver = e & 1;
      const qx = ver ? px : px + 1;
      const qy = ver ? py + 1 : py;
      const va = at(px, py);
      const vb = at(qx, qy);
      let t = va / (va - vb);
      t = t < 0.02 ? 0.02 : t > 0.98 ? 0.98 : t;
      xy.push(px + (qx - px) * t + 0.5, py + (qy - py) * t + 0.5);
      if (!comp) comp = va > 0 ? lab[py * W + px] : lab[qy * W + qx];
      const nx = next[e];
      next[e] = -1;
      e = nx;
    }
    let A = 0;
    const m = xy.length;
    for (let i = 0; i < m; i += 2) {
      const j = (i + 2) % m;
      A += xy[i] * xy[j + 1] - xy[j] * xy[i + 1];
    }
    out.push({ comp, xy, area: A / 2 });
  }
  return out;
}

function ringPerimeter(xy: number[]): number {
  let s = 0;
  const m = xy.length;
  for (let i = 0; i < m; i += 2) {
    const j = (i + 2) % m;
    s += Math.hypot(xy[i] - xy[j], xy[i + 1] - xy[j + 1]);
  }
  return s;
}

/** 닫힌 고리를 Ramer-Douglas-Peucker로 줄인다. */
function simplifyRing(xy: number[], tol: number): number[] {
  const n = xy.length / 2;
  if (n < 8) return xy.slice();
  let far = 0;
  let fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (xy[2 * i] - xy[0]) ** 2 + (xy[2 * i + 1] - xy[1]) ** 2;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const stack: number[] = [0, far, far, n];
  while (stack.length) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    if (b - a < 2) continue;
    const ax = xy[2 * a];
    const ay = xy[2 * a + 1];
    const bi = b % n;
    const dx = xy[2 * bi] - ax;
    const dy = xy[2 * bi + 1] - ay;
    const L = dx * dx + dy * dy;
    let m = -1;
    let md = tol * tol;
    for (let i = a + 1; i < b; i++) {
      let ux = xy[2 * i] - ax;
      let uy = xy[2 * i + 1] - ay;
      if (L > 0) {
        let t = (ux * dx + uy * dy) / L;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        ux -= t * dx;
        uy -= t * dy;
      }
      const d = ux * ux + uy * uy;
      if (d > md) {
        md = d;
        m = i;
      }
    }
    if (m >= 0) {
      keep[m] = 1;
      stack.push(a, m, m, b);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(xy[2 * i], xy[2 * i + 1]);
  return out.length >= 6 ? out : xy.slice();
}

// ---------------------------------------------------------------------------
// 조각

interface Piece {
  area: number;
  sumD: number;
  peak: number;
  thick: number;
  near: number;
  /** 최고 농도가 나온 곳(1배 격자 번호). */
  peakAt: number;
  /** 살짝 흐린 1배 농도의 최고값. 넓고 옅은 자국에서 잡음 알갱이 하나가 최고값을 끌어올리지 않는다. */
  peakS: number;
  edge: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: number;
  perim: number;
  /** 색 단위로 묶은 고리. */
  parts: { color: number; rings: { xy: number[]; area: number }[] }[];
}

function weightedMedian(items: [number, number][]): number | undefined {
  if (items.length === 0) return undefined;
  items.sort((p, q) => p[0] - q[0]);
  const total = items.reduce((s, v) => s + v[1], 0);
  let acc = 0;
  for (const [v, w] of items) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return items[items.length - 1][0];
}

/** 길이 L, 굵기 w인 스타디움의 넓이와 둘레에서 굵기를 되푼다. 원(점)이면 지름이 나온다. */
function stadiumWidth(area: number, perim: number): number {
  if (perim <= 0) return 0;
  const disc = perim * perim - 4 * Math.PI * area;
  return disc > 0 ? (perim - Math.sqrt(disc)) / Math.PI : perim / Math.PI;
}

// ---------------------------------------------------------------------------
// 공개 함수

export function extractInkOutlines(image: InkImageInput, options: InkOutlineOptions = {}): InkOutlineResult {
  const width = image?.width;
  const height = image?.height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !image.data ||
    image.data.length < width * height * 4
  ) {
    return emptyResult(width, height);
  }
  const maxSide = Math.max(64, Math.round(positive(options.maxSide) ?? DEFAULTS.maxSide));
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  const pw = Math.max(1, Math.round(width * ratio));
  const ph = Math.max(1, Math.round(height * ratio));
  const sx = pw / width;
  const sy = ph / height;
  const s = (sx + sy) / 2;
  if (pw < 8 || ph < 8) return emptyResult(width, height, s);
  const maxWidthP = (positive(options.maxStrokeWidth) ?? Math.max(18, Math.max(pw, ph) * 0.014) / s) * s;
  const maxShapes = Math.floor(positive(options.maxShapes) ?? DEFAULTS.maxShapes);
  const maxPoints = Math.floor(positive(options.maxPoints) ?? DEFAULTS.maxPoints);
  const inkContrast = Math.min(0.9, positive(options.inkContrast) ?? DEFAULTS.inkContrast);
  const n1 = pw * ph;
  const prof: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string): void => {
    const t = performance.now();
    prof[k] = (prof[k] ?? 0) + t - t0;
    t0 = t;
  };

  const img = downsample(image.data, width, height, pw, ph);
  const bg = estimateBackground(img);
  const { raw, smooth: d } = inkContrastMap(img, bg);
  const noise = backgroundNoise(d);
  const noiseBlock = Math.max(12, Math.round(Math.max(pw, ph) / 64));
  const ln = localNoise(raw, pw, ph, noiseBlock);
  const high = Math.max(inkContrast, noise.median + 7 * noise.sigma);
  const low = Math.max(inkContrast * 0.55, noise.median + 3.5 * noise.sigma);
  lap("prep");

  // 굵은 덩어리(테두리, 그림자, 자석, 물건)와 그 둘레
  const R = maxWidthP / 2 + 0.5;
  const reach = 1.25 * R + 1.5;
  let near: Float32Array | null = null;
  const excl = new Uint8Array(n1);
  {
    const notBold = new Uint8Array(n1);
    for (let i = 0; i < n1; i++) notBold[i] = d[i] >= 0.3 ? 0 : 1;
    const bd = sqDistanceTo(notBold, pw, ph);
    const core = new Uint8Array(n1);
    let any = false;
    for (let i = 0; i < n1; i++) {
      if (bd[i] > R * R) {
        core[i] = 1;
        any = true;
      }
    }
    if (any) {
      near = sqDistanceTo(core, pw, ph);
      for (let i = 0; i < n1; i++) {
        near[i] = Math.sqrt(Math.min(1e12, near[i]));
        if (near[i] <= reach) excl[i] = 1;
      }
    }
  }
  lap("thick");

  // 후보: 잉크일 수 있는 곳과 그 둘레 1px
  const cand = new Uint8Array(n1);
  let anyCand = false;
  {
    for (let i = 0; i < n1; i++) {
      if (!excl[i] && d[i] >= low) {
        cand[i] = 1;
        anyCand = true;
      }
    }
  }
  if (!anyCand) return emptyResult(width, height, s);

  // 굵기 첫 추정(1배): 반값 경계 마스크의 진한 요소에서 2A/P. 테두리나 그림자처럼 큰 덩어리 하나가
  // 중앙값을 끌고 가지 않도록 넓이의 제곱근으로 가중한다.
  let w0 = 3;
  {
    const peakR = Math.max(2, Math.round(Math.max(pw, ph) * 0.003));
    const peak = localMax(d, pw, ph, peakR);
    const m = new Uint8Array(n1);
    for (let i = 0; i < n1; i++) if (cand[i] && d[i] >= low && raw[i] >= 0.5 * peak[i]) m[i] = 1;
    const { labels, count, areas } = labelComponents(m, pw, ph, true);
    const edges = new Float64Array(count + 1);
    const strong = new Uint8Array(count + 1);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const i = y * pw + x;
        const l = labels[i];
        if (!l) continue;
        if (d[i] >= high) strong[l] = 1;
        let e = 0;
        if (x === 0 || !m[i - 1]) e++;
        if (x === pw - 1 || !m[i + 1]) e++;
        if (y === 0 || !m[i - pw]) e++;
        if (y === ph - 1 || !m[i + pw]) e++;
        edges[l] += e;
      }
    }
    const items: [number, number][] = [];
    for (let l = 1; l <= count; l++) {
      if (strong[l] && areas[l] >= 20) items.push([(2 * areas[l]) / (edges[l] * (Math.PI / 4)), Math.sqrt(areas[l])]);
    }
    const v = weightedMedian(items);
    if (v !== undefined) w0 = Math.max(1.2, Math.min(maxWidthP, v));
  }

  // 그룹: 후보를 1px 넓힌 8연결 요소
  const grown = new Uint8Array(n1);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = y * pw + x;
      if (!cand[i]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= ph) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < pw) grown[yy * pw + xx] = 1;
        }
      }
    }
  }
  const groups = labelComponents(grown, pw, ph, true);
  const gbox = new Int32Array((groups.count + 1) * 4);
  for (let l = 1; l <= groups.count; l++) gbox.set([pw, ph, -1, -1], l * 4);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const l = groups.labels[y * pw + x];
      if (!l) continue;
      const b = l * 4;
      if (x < gbox[b]) gbox[b] = x;
      if (y < gbox[b + 1]) gbox[b + 1] = y;
      if (x > gbox[b + 2]) gbox[b + 2] = x;
      if (y > gbox[b + 3]) gbox[b + 3] = y;
    }
  }
  lap("groups");

  // 창 크기(2배 격자)
  const rMin = Math.max(1, Math.round(MIN_WINDOW * w0 * 2));
  const rMax = Math.max(1, Math.round(MAX_WINDOW * w0 * 2));
  const sMin = Math.max(1, Math.round(rMin / 2));
  const sMax = Math.max(1, Math.round(rMax / 2));
  const pad = Math.ceil((Math.max(rMin, rMax) + Math.max(sMin, sMax)) / 2) + 4;

  // 처리 묶음: 가까운 작은 그룹을 칸 단위로 묶는다.
  const cell = 128;
  const batchOf = new Int32Array(groups.count + 1).fill(-1);
  const batches: number[][] = [];
  {
    const byCell = new Map<number, number>();
    for (let l = 1; l <= groups.count; l++) {
      const b = l * 4;
      const bw = gbox[b + 2] - gbox[b] + 1;
      const bh = gbox[b + 3] - gbox[b + 1] + 1;
      let id: number;
      if (bw > cell || bh > cell) {
        id = batches.length;
        batches.push([gbox[b], gbox[b + 1], gbox[b + 2], gbox[b + 3]]);
      } else {
        const key = Math.floor((gbox[b + 1] + gbox[b + 3]) / 2 / cell) * 65536 + Math.floor((gbox[b] + gbox[b + 2]) / 2 / cell);
        const got = byCell.get(key);
        if (got === undefined) {
          id = batches.length;
          byCell.set(key, id);
          batches.push([gbox[b], gbox[b + 1], gbox[b + 2], gbox[b + 3]]);
        } else {
          id = got;
          const bb = batches[id];
          bb[0] = Math.min(bb[0], gbox[b]);
          bb[1] = Math.min(bb[1], gbox[b + 1]);
          bb[2] = Math.max(bb[2], gbox[b + 2]);
          bb[3] = Math.max(bb[3], gbox[b + 3]);
        }
      }
      batchOf[l] = id;
    }
  }

  // 색 지도(1배): 농도 가중 국소 평균 투과율
  const cmap = new Uint8Array(n1);
  {
    const br = backgroundMap(bg.r, bg, pw, ph);
    const bgG = backgroundMap(bg.g, bg, pw, ph);
    const bb = backgroundMap(bg.b, bg, pw, ph);
    const ww = new Float32Array(n1);
    const cr = new Float32Array(n1);
    const cg = new Float32Array(n1);
    const cb = new Float32Array(n1);
    for (let i = 0; i < n1; i++) {
      const v = Math.max(0, d[i] - 0.5 * low);
      const w = v * v + 1e-6;
      ww[i] = w;
      cr[i] = (w * img.rgb[i * 3]) / Math.max(8, br[i]);
      cg[i] = (w * img.rgb[i * 3 + 1]) / Math.max(8, bgG[i]);
      cb[i] = (w * img.rgb[i * 3 + 2]) / Math.max(8, bb[i]);
    }
    const r = Math.max(1, Math.round(w0 * 0.7));
    boxBlur(ww, pw, ph, r);
    boxBlur(cr, pw, ph, r);
    boxBlur(cg, pw, ph, r);
    boxBlur(cb, pw, ph, r);
    for (let i = 0; i < n1; i++) if (grown[i]) cmap[i] = classifyColor(cr[i] / ww[i], cg[i] / ww[i], cb[i] / ww[i]);
  }
  lap("color");

  // 묶음별 2배 처리
  const pieces: Piece[] = [];
  const grp = groups.labels;
  let area2 = 0;
  for (let bi = 0; bi < batches.length; bi++) {
    const [gx0, gy0, gx1, gy1] = batches[bi];
    const ox = Math.max(0, gx0 - pad);
    const oy = Math.max(0, gy0 - pad);
    const bw = Math.min(pw, gx1 + pad + 1) - ox;
    const bh = Math.min(ph, gy1 + pad + 1) - oy;
    const W2 = bw * 2;
    const H2 = bh * 2;
    const n2 = W2 * H2;
    area2 += n2;
    const D2 = upscale2(raw, pw, ph, ox, oy, bw, bh);
    const hi = boxBlur(extremum(D2, W2, H2, rMax, 1), W2, H2, sMax);
    const lo = boxBlur(extremum(D2, W2, H2, rMin, -1), W2, H2, sMin);
    const F = hi;
    for (let i = 0; i < n2; i++) {
      const h = hi[i];
      const t = Math.min(0.5 * (h + Math.max(0, lo[i])), THRESHOLD_CAP * h);
      F[i] = D2[i] - Math.max(low, t);
    }
    cutValleys(F, D2, W2, H2, Math.max(1, Math.round(VALLEY_REACH * w0 * 2)), VALLEY_DEPTH, VALLEY_MIN_PART * w0 * w0 * 4);
    lap("field");
    const mask = new Uint8Array(n2);
    const q1 = new Int32Array(n2);
    for (let Y = 1; Y < H2 - 1; Y++) {
      const row = (oy + (Y >> 1)) * pw + ox;
      for (let X = 1; X < W2 - 1; X++) {
        const i = Y * W2 + X;
        const q = row + (X >> 1);
        q1[i] = q;
        if (F[i] > 0 && !excl[q] && grp[q] && batchOf[grp[q]] === bi) mask[i] = 1;
      }
    }
    const { labels: lab, count } = labelComponents(mask, W2, H2, true);
    if (count === 0) continue;
    const dist2 = inkDistance2(mask, W2, H2);
    const base = pieces.length;
    const hist = new Float64Array((count + 1) * 4);
    for (let l = 1; l <= count; l++) {
      pieces.push({
        area: 0, sumD: 0, peak: 0, thick: 0, near: Infinity, peakAt: 0, peakS: 0, edge: false,
        x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, color: 0, perim: 0, parts: [],
      });
    }
    for (let Y = 0; Y < H2; Y++) {
      for (let X = 0; X < W2; X++) {
        const i = Y * W2 + X;
        const l = lab[i];
        if (!l) continue;
        const pc = pieces[base + l - 1];
        const q = q1[i];
        const v = D2[i];
        pc.area += 0.25;
        pc.sumD += v;
        if (v > pc.peak) {
          pc.peak = v;
          pc.peakAt = q;
        }
        if (d[q] > pc.peakS) pc.peakS = d[q];
        if (dist2[i] > pc.thick) pc.thick = dist2[i];
        if (near && near[q] < pc.near) pc.near = near[q];
        const x = ox + X / 2;
        const y = oy + Y / 2;
        if (x < 2 || y < 2 || x >= pw - 2 || y >= ph - 2) pc.edge = true;
        if (x < pc.x0) pc.x0 = x;
        if (y < pc.y0) pc.y0 = y;
        if (x > pc.x1) pc.x1 = x;
        if (y > pc.y1) pc.y1 = y;
        hist[l * 4 + cmap[q]]++;
      }
    }
    lap("label");
    // 색: 다수결. 다른 색이 충분히 섞인 조각은 색 경계에서 나눈다.
    const mixed = new Uint8Array(count + 1);
    let anyMixed = false;
    for (let l = 1; l <= count; l++) {
      const pc = pieces[base + l - 1];
      pc.thick = Math.sqrt(pc.thick);
      let m = 0;
      let sum = 0;
      for (let c = 0; c < 4; c++) {
        sum += hist[l * 4 + c];
        if (hist[l * 4 + c] > hist[l * 4 + m]) m = c;
      }
      pc.color = m;
      const rest = sum - hist[l * 4 + m];
      if (rest > 0.06 * sum && rest / 4 > 3 * w0 * w0) {
        mixed[l] = 1;
        anyMixed = true;
      }
    }
    for (let i = 0; i < n2; i++) {
      const l = lab[i];
      if (!l) {
        if (F[i] >= 0) F[i] = -1e-4;
      } else if (F[i] <= 0) F[i] = 1e-4;
    }
    const addRings = (rings: Ring[], colorOf: (comp: number) => number, pieceOf: (comp: number) => number): void => {
      const partOf = new Map<number, { color: number; rings: { xy: number[]; area: number }[] }>();
      for (const r of rings) {
        if (!r.comp) continue;
        const pi = pieceOf(r.comp);
        const pc = pieces[base + pi - 1];
        for (let k = 0; k < r.xy.length; k += 2) {
          r.xy[k] = ox + r.xy[k] / 2;
          r.xy[k + 1] = oy + r.xy[k + 1] / 2;
        }
        const area = r.area / 4;
        let part = partOf.get(r.comp);
        if (!part) {
          part = { color: colorOf(r.comp), rings: [] };
          partOf.set(r.comp, part);
          pc.parts.push(part);
        }
        part.rings.push({ xy: r.xy, area });
        pc.perim += ringPerimeter(r.xy);
      }
    };
    {
      const Fa = anyMixed ? new Float32Array(n2) : F;
      if (anyMixed) for (let i = 0; i < n2; i++) Fa[i] = lab[i] && mixed[lab[i]] ? -Math.abs(F[i]) : F[i];
      addRings(contours(Fa, W2, H2, lab), (l) => pieces[base + l - 1].color, (l) => l);
    }
    if (anyMixed) {
      const pcol = new Uint8Array(n2);
      for (let i = 0; i < n2; i++) if (lab[i] && mixed[lab[i]]) pcol[i] = cmap[q1[i]] + 1;
      // 작은 색 섬은 조각의 다수색으로 돌린다.
      for (let c = 1; c <= 4; c++) {
        const m = new Uint8Array(n2);
        let any = false;
        for (let i = 0; i < n2; i++) if (pcol[i] === c) { m[i] = 1; any = true; }
        if (!any) continue;
        const sub = labelComponents(m, W2, H2, true);
        for (let i = 0; i < n2; i++) {
          const k = sub.labels[i];
          if (k && sub.areas[k] / 4 < 3 * w0 * w0) pcol[i] = pieces[base + lab[i] - 1].color + 1;
        }
      }
      for (let c = 1; c <= 4; c++) {
        const m = new Uint8Array(n2);
        let any = false;
        for (let i = 0; i < n2; i++) if (pcol[i] === c) { m[i] = 1; any = true; }
        if (!any) continue;
        const sub = labelComponents(m, W2, H2, true);
        const Fc = new Float32Array(n2);
        for (let i = 0; i < n2; i++) Fc[i] = pcol[i] === c ? F[i] : -Math.abs(F[i]);
        const firstPix = new Int32Array(sub.count + 1).fill(-1);
        for (let i = 0; i < n2; i++) if (sub.labels[i] && firstPix[sub.labels[i]] < 0) firstPix[sub.labels[i]] = i;
        addRings(contours(Fc, W2, H2, sub.labels), () => c - 1, (k) => lab[firstPix[k]]);
      }
    }
    lap("contour");
  }

  // 전체 통계로 거른다.
  let w = w0;
  {
    const items: [number, number][] = [];
    for (const p of pieces) if (p.area > 20 && p.peak >= high && p.perim > 0 && p.thick <= 5 * w0) items.push([(2 * p.area) / p.perim, p.area]);
    const v = weightedMedian(items);
    if (v !== undefined) w = Math.max(1, v);
  }
  const minA = 0.5 * w * w;
  const minHole = 0.06 * w * w;
  const maxT = 5 * w;
  let med = 0;
  {
    const items: [number, number][] = [];
    for (const p of pieces) if (p.area >= minA && p.thick <= maxT && p.peak >= high) items.push([p.sumD / (4 * p.area), p.area]);
    med = weightedMedian(items) ?? high;
  }
  const minPeak = Math.max(high, MIN_PEAK);
  const noiseFloor = (p: Piece): number => {
    const x = p.peakAt % pw;
    const y = (p.peakAt / pw) | 0;
    const b = Math.floor(y / noiseBlock) * ln.gw + Math.floor(x / noiseBlock);
    return ln.level[b] + NOISE_K * ln.sigma[b];
  };
  const why: Record<string, number> = {};
  const keep = pieces.filter((p) => {
    const a = p.area;
    const mD = p.sumD / (4 * a);
    let r = "";
    if (a < minA && !(a >= 0.4 * minA && p.peak >= 0.6 * med)) r = "small";
    else if (p.peak < Math.max(minPeak, 0.4 * med) || p.peakS < MIN_PEAK_SMOOTH) r = "faint";
    else if (p.peak < noiseFloor(p)) r = "noise";
    else if (p.thick > maxT) r = "thick";
    else if ((mD < 0.35 * med && p.thick > 1.5 * w) || (mD < 0.25 * med && a > 2 * w * w)) r = "faintWide";
    else if (p.edge && p.color === 0 && mD < 0.6 * med) r = "edge";
    else if (p.near <= 4 * R && (p.color === 0 || mD < 0.35 * med || p.near <= reach + 3)) r = "nearBlob";
    why[r || "kept"] = (why[r || "kept"] ?? 0) + 1;
    return !r;
  });
  lap("filter");

  // 모양 만들기
  const tol = positive(options.simplifyTolerance) !== undefined ? (options.simplifyTolerance as number) * s : Math.max(0.1, 0.05 * w);
  const ix = 1 / sx;
  const iy = 1 / sy;
  const round2 = (v: number): number => Math.round(v * 100) / 100;
  const shapes: (InkOutlineShape & { order: number; points: number })[] = [];
  for (const p of keep) {
    for (const part of p.parts) {
      let area = 0;
      let perim = 0;
      let points = 0;
      const rings: InkOutlinePoint[][] = [];
      for (const r of part.rings) {
        if (Math.abs(r.area) < minHole) continue;
        const xy = simplifyRing(r.xy, tol);
        const ring: InkOutlinePoint[] = [];
        for (let k = 0; k < xy.length; k += 2) ring.push([round2(xy[k] * ix), round2(xy[k + 1] * iy)]);
        rings.push(ring);
        area += r.area;
        perim += ringPerimeter(xy);
        points += ring.length;
      }
      if (rings.length === 0 || area <= 0) continue;
      shapes.push({
        color: COLORS[part.color],
        rings,
        area: round2(area / (s * s)),
        strokeWidth: round2(Math.max(0.5, stadiumWidth(area, perim)) / s),
        order: Math.floor(p.y0 / 8) * 1e6 + p.x0,
        points,
      });
    }
  }
  shapes.sort((a, b) => b.area - a.area);
  const kept: typeof shapes = [];
  let total = 0;
  let truncated = false;
  for (const sh of shapes) {
    if (kept.length >= maxShapes || total + sh.points > maxPoints) {
      truncated = true;
      break;
    }
    kept.push(sh);
    total += sh.points;
  }
  kept.sort((a, b) => a.order - b.order);
  lap("shapes");
  // 측정 도구용: 전역에 __inkOutlineDebug 키를 미리 두면 단계별 시간과 거른 이유를 적는다.
  const dbg = globalThis as unknown as { __inkOutlineDebug?: unknown };
  if ("__inkOutlineDebug" in dbg) dbg.__inkOutlineDebug = { prof, why, w0, w, med, low, high, batches: batches.length, area2, n1, pieces: pieces.length };
  return {
    width,
    height,
    shapes: kept.map(({ color, rings, area, strokeWidth }) => ({ color, rings, area, strokeWidth })),
    truncated,
    scale: s,
    strokeWidth: round2(w / s),
  };
}

/**
 * 화이트보드 사진에서 손글씨 획을 펜 획(폴리라인)으로 뽑는다.
 *
 * DOM, canvas, 외부 패키지에 의존하지 않는 순수 함수 모듈이다. 브라우저 메인 스레드,
 * Web Worker, Node(type stripping)에서 그대로 돈다. 그래서 enum, namespace,
 * parameter property처럼 지워지지 않는 TS 문법을 쓰지 않는다.
 *
 * 좌표계: 결과 좌표는 입력 이미지의 연속 픽셀 좌표다. 왼쪽 위 모서리가 (0, 0),
 * 오른쪽 아래 모서리가 (width, height)이고, 픽셀 (i, j)의 중심은 (i + 0.5, j + 0.5)다.
 *
 * 처리 순서
 * 1. 긴 변이 maxSide보다 크면 면적 평균으로 줄인다.
 * 2. 블록별 밝은 쪽 값으로 보드 배경 밝기와 배경색을 추정하고, 배경 대비 어두운 비율로 잉크 대비를 구한다.
 *    대비의 잡음 수준을 재서 임계를 정하고 강약 두 임계(히스테리시스)로 이진화한다.
 * 3. 작은 연결 요소를 지우고 획 안의 작은 구멍(반사광)을 메운다.
 * 4. 거리 변환으로 펜보다 훨씬 굵은 부분(테두리, 그림자, 자석, 벽)을 깎아 낸다.
 * 5. Zhang-Suen 골격화 후 계단 픽셀을 지워 1픽셀 골격을 만든다.
 * 6. 골격 그래프에서 잔가지를 지우고 가까운 분기점을 합친 뒤, 분기점에서 방향이 가장 곧게
 *    이어지는 가지끼리 이어 붙여 획을 만든다.
 * 7. 가볍게 평활한 뒤 Ramer-Douglas-Peucker로 점 수를 줄인다.
 * 8. 획 굵기는 골격 위 거리 변환 값의 중앙값, 색은 배경으로 나눈 투과율의 흡광도로 정한다.
 * 9. 획 수와 점 수 상한을 넘으면 짧은 획부터 버린다.
 */

export type InkColor = "black" | "blue" | "red" | "green";
export type InkPoint = [number, number];

export interface InkStroke {
  /** 입력 이미지 좌표의 점 목록. 점 하나짜리 획(마침표)은 같은 점을 두 번 담는다. */
  points: InkPoint[];
  color: InkColor;
  /** 획 굵기(입력 이미지 px). */
  width: number;
  /** 닫힌 획이면 true이고, 이때 마지막 점은 첫 점과 같다. */
  closed: boolean;
}

export interface InkImageInput {
  width: number;
  height: number;
  /** RGBA 순서의 픽셀 값. ImageData.data와 같은 모양이다. */
  data: ArrayLike<number>;
}

export interface InkStrokeOptions {
  /** 처리 해상도의 긴 변(px). 입력이 더 크면 줄여서 처리한다. 기본 1600. */
  maxSide?: number;
  /** 이보다 짧은 획은 버린다(입력 px). 홀로 떨어진 점은 예외. 기본은 처리 해상도 4px에 해당하는 길이. */
  minStrokeLength?: number;
  /** 단순화 허용 오차(입력 px). 기본은 처리 해상도 0.6px. */
  simplifyTolerance?: number;
  /** 펜 획으로 인정하는 최대 굵기(입력 px). 더 굵은 덩어리는 잉크가 아닌 것으로 본다. 기본은 처리 해상도 긴 변의 1.4%. */
  maxStrokeWidth?: number;
  /** 이보다 면적이 작은 잉크 조각은 잡음으로 본다(입력 px²). 기본은 처리 해상도 8px². */
  minComponentArea?: number;
  /** 잉크로 판정할 최소 상대 대비(0~1, 배경보다 몇 비율 어두운지). 기본 0.14. */
  inkContrast?: number;
  /** 평활 여부. 기본 true. */
  smooth?: boolean;
  /** 획 수 상한. 기본 4000. */
  maxStrokes?: number;
  /** 전체 점 수 상한. 기본 200000. */
  maxPoints?: number;
}

export interface InkStrokeResult {
  width: number;
  height: number;
  strokes: InkStroke[];
  /** 상한 때문에 버린 획이 있으면 true. */
  truncated: boolean;
  /** 처리 해상도 / 입력 해상도. */
  scale: number;
}

const DEFAULTS = {
  maxSide: 1600,
  maxStrokes: 4000,
  maxPoints: 200000,
  inkContrast: 0.14,
};

type Pt = [number, number];

function emptyResult(width: unknown, height: unknown, scale = 1): InkStrokeResult {
  const safe = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { width: safe(width), height: safe(height), strokes: [], truncated: false, scale };
}

function positive(v: number | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// 1. 축소

interface Downsampled {
  w: number;
  h: number;
  rgb: Uint8Array;
  lum: Float32Array;
}

function downsample(src: ArrayLike<number>, sw: number, sh: number, w: number, h: number): Downsampled {
  const rgb = new Uint8Array(w * h * 3);
  const lum = new Float32Array(w * h);
  const x0 = new Int32Array(w);
  const x1 = new Int32Array(w);
  for (let i = 0; i < w; i++) {
    x0[i] = Math.floor((i * sw) / w);
    x1[i] = Math.max(x0[i] + 1, Math.floor(((i + 1) * sw) / w));
  }
  const acc = new Float64Array(w * 3);
  for (let j = 0; j < h; j++) {
    const y0 = Math.floor((j * sh) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * sh) / h));
    acc.fill(0);
    for (let y = y0; y < y1; y++) {
      const row = y * sw * 4;
      for (let i = 0; i < w; i++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let x = x0[i], e = x1[i]; x < e; x++) {
          const o = row + x * 4;
          r += src[o];
          g += src[o + 1];
          b += src[o + 2];
        }
        acc[i * 3] += r;
        acc[i * 3 + 1] += g;
        acc[i * 3 + 2] += b;
      }
    }
    const rows = y1 - y0;
    for (let i = 0; i < w; i++) {
      const n = rows * (x1[i] - x0[i]);
      const r = acc[i * 3] / n;
      const g = acc[i * 3 + 1] / n;
      const b = acc[i * 3 + 2] / n;
      const o = (j * w + i) * 3;
      rgb[o] = r + 0.5;
      rgb[o + 1] = g + 0.5;
      rgb[o + 2] = b + 0.5;
      lum[j * w + i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return { w, h, rgb, lum };
}

// ---------------------------------------------------------------------------
// 2. 배경 추정

interface Background {
  block: number;
  gw: number;
  gh: number;
  lum: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

function estimateBackground(img: Downsampled): Background {
  const { w, h, rgb, lum } = img;
  const block = Math.max(12, Math.round(Math.max(w, h) / 64));
  const gw = Math.ceil(w / block);
  const gh = Math.ceil(h / block);
  const n = gw * gh;
  const gl = new Float32Array(n);
  const gr = new Float32Array(n);
  const gg = new Float32Array(n);
  const gb = new Float32Array(n);
  const hist = new Int32Array(256);
  for (let by = 0; by < gh; by++) {
    const ya = by * block;
    const yb = Math.min(h, ya + block);
    for (let bx = 0; bx < gw; bx++) {
      const xa = bx * block;
      const xb = Math.min(w, xa + block);
      hist.fill(0);
      let count = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          let v = (lum[y * w + x] + 0.5) | 0;
          if (v > 255) v = 255;
          hist[v]++;
          count++;
        }
      }
      // 블록의 밝은 쪽 30%를 배경으로 본다. 잉크가 블록의 70% 이상을 덮지 않으면 배경이 잡힌다.
      const target = count * 0.7;
      let cum = 0;
      let cut = 255;
      for (let v = 0; v < 256; v++) {
        cum += hist[v];
        if (cum >= target) {
          cut = v;
          break;
        }
      }
      let sl = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let m = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const p = y * w + x;
          if (lum[p] + 0.5 >= cut) {
            sl += lum[p];
            sr += rgb[p * 3];
            sg += rgb[p * 3 + 1];
            sb += rgb[p * 3 + 2];
            m++;
          }
        }
      }
      const k = by * gw + bx;
      if (m === 0) m = 1;
      gl[k] = sl / m;
      gr[k] = sr / m;
      gg[k] = sg / m;
      gb[k] = sb / m;
    }
  }
  // 3x3 순위 필터: 이웃 중 밝은 쪽 3번째 블록을 고른다.
  // 잉크가 빽빽한 블록이나 반사광 블록 하나는 이웃 값으로 바뀐다.
  const rl = new Float32Array(n);
  const rr = new Float32Array(n);
  const rg = new Float32Array(n);
  const rb = new Float32Array(n);
  const idx: number[] = [];
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      idx.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          idx.push(yy * gw + xx);
        }
      }
      idx.sort((a, b) => gl[b] - gl[a]);
      const pick = idx[Math.min(idx.length - 1, idx.length >= 6 ? 2 : 1)];
      const k = y * gw + x;
      rl[k] = gl[pick];
      rr[k] = gr[pick];
      rg[k] = gg[pick];
      rb[k] = gb[pick];
    }
  }
  return {
    block,
    gw,
    gh,
    lum: boxGrid(boxGrid(rl, gw, gh), gw, gh),
    r: boxGrid(rr, gw, gh),
    g: boxGrid(rg, gw, gh),
    b: boxGrid(rb, gw, gh),
  };
}

function boxGrid(src: Float32Array, gw: number, gh: number): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          s += src[yy * gw + xx];
          c++;
        }
      }
      out[y * gw + x] = s / c;
    }
  }
  return out;
}

/** 그리드를 쌍선형 보간한다. x, y는 처리 해상도의 픽셀 인덱스. */
function sampleGrid(grid: Float32Array, bg: Background, x: number, y: number): number {
  let gx = (x + 0.5) / bg.block - 0.5;
  let gy = (y + 0.5) / bg.block - 0.5;
  if (gx < 0) gx = 0;
  else if (gx > bg.gw - 1) gx = bg.gw - 1;
  if (gy < 0) gy = 0;
  else if (gy > bg.gh - 1) gy = bg.gh - 1;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const jx = ix < bg.gw - 1 ? ix + 1 : ix;
  const jy = iy < bg.gh - 1 ? iy + 1 : iy;
  const tx = gx - ix;
  const ty = gy - iy;
  const a = grid[iy * bg.gw + ix] * (1 - tx) + grid[iy * bg.gw + jx] * tx;
  const b = grid[jy * bg.gw + ix] * (1 - tx) + grid[jy * bg.gw + jx] * tx;
  return a * (1 - ty) + b * ty;
}

/** 배경 대비 어두운 비율(잉크 대비)을 구하고 [1,2,1] 커널로 살짝 흐린다. */
function inkContrastMap(img: Downsampled, bg: Background): Float32Array {
  const { w, h, lum } = img;
  const d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = Math.max(8, sampleGrid(bg.lum, bg, x, y));
      d[y * w + x] = (b - lum[y * w + x]) / b;
    }
  }
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const l = d[row + (x > 0 ? x - 1 : x)];
      const r = d[row + (x < w - 1 ? x + 1 : x)];
      tmp[row + x] = (l + 2 * d[row + x] + r) * 0.25;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = (y > 0 ? y - 1 : y) * w;
    const dn = (y < h - 1 ? y + 1 : y) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      d[row + x] = (tmp[up + x] + 2 * tmp[row + x] + tmp[dn + x]) * 0.25;
    }
  }
  return d;
}

/** 반경 r 안의 최댓값(정사각 창, 가로와 세로로 나눠 계산). */
function localMax(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = src[row + x];
      const e = Math.min(w - 1, x + r);
      for (let k = Math.max(0, x - r); k <= e; k++) if (src[row + k] > m) m = src[row + k];
      tmp[row + x] = m;
    }
  }
  const out = tmp.slice();
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const e = Math.min(h - 1, y + r);
    for (let yy = Math.max(0, y - r); yy <= e; yy++) {
      const other = yy * w;
      for (let x = 0; x < w; x++) if (tmp[other + x] > out[row + x]) out[row + x] = tmp[other + x];
    }
  }
  return out;
}

/** 대비 지도의 중앙값과 잡음 크기(MAD 기반 표준편차)를 잰다. */
function contrastNoise(d: Float32Array): { median: number; sigma: number } {
  const bins = 4000;
  const lo = -1;
  const span = 2;
  const hist = new Int32Array(bins);
  const step = Math.max(1, Math.floor(d.length / 250000));
  let count = 0;
  for (let i = 0; i < d.length; i += step) {
    let b = Math.floor(((d[i] - lo) / span) * bins);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    hist[b]++;
    count++;
  }
  const quantile = (h: Int32Array): number => {
    let cum = 0;
    for (let b = 0; b < bins; b++) {
      cum += h[b];
      if (cum >= count * 0.5) return b;
    }
    return bins - 1;
  };
  const mb = quantile(hist);
  const median = lo + ((mb + 0.5) / bins) * span;
  const dev = new Int32Array(bins);
  for (let b = 0; b < bins; b++) dev[Math.abs(b - mb)] += hist[b];
  const sigma = 1.4826 * ((quantile(dev) + 0.5) / bins) * span;
  return { median, sigma };
}

// ---------------------------------------------------------------------------
// 공통: 연결 요소, 거리 변환 (1px 패딩된 격자에서 동작)

interface Labels {
  labels: Int32Array;
  count: number;
  areas: Int32Array;
}

/** 연결 요소 라벨링(두 패스 union-find). 라벨은 1부터, 0은 바탕. */
function labelComponents(mask: Uint8Array, W: number, H: number, conn8: boolean): Labels {
  const labels = new Int32Array(W * H);
  const parent: number[] = [0];
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number): number => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return ra;
    if (ra < rb) {
      parent[rb] = ra;
      return ra;
    }
    parent[ra] = rb;
    return rb;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let l = x > 0 ? labels[i - 1] : 0;
      if (y > 0) {
        const up = labels[i - W];
        if (up) l = l ? union(l, up) : up;
        if (conn8) {
          const ul = x > 0 ? labels[i - W - 1] : 0;
          if (ul) l = l ? union(l, ul) : ul;
          const ur = x < W - 1 ? labels[i - W + 1] : 0;
          if (ur) l = l ? union(l, ur) : ur;
        }
      }
      if (!l) {
        l = parent.length;
        parent.push(l);
      }
      labels[i] = l;
    }
  }
  const remap = new Int32Array(parent.length);
  let count = 0;
  for (let l = 1; l < parent.length; l++) if (find(l) === l) remap[l] = ++count;
  for (let l = 1; l < parent.length; l++) remap[l] = remap[find(l)];
  const areas = new Int32Array(count + 1);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) {
      const v = remap[labels[i]];
      labels[i] = v;
      areas[v]++;
    }
  }
  return { labels, count, areas };
}

/** target이 1인 가장 가까운 픽셀까지의 제곱 유클리드 거리(Felzenszwalb-Huttenlocher). */
function sqDistanceTo(target: Uint8Array, W: number, H: number): Float32Array {
  const INF = 1e12;
  const out = new Float32Array(W * H);
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const res = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const pass = (len: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      res[q] = dq * dq + f[v[k]];
    }
  };
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = target[y * W + x] ? 0 : INF;
    pass(H);
    for (let y = 0; y < H; y++) out[y * W + x] = res[y];
  }
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) f[x] = out[row + x];
    pass(W);
    for (let x = 0; x < W; x++) out[row + x] = res[x];
  }
  return out;
}

function invert(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
  return out;
}

// ---------------------------------------------------------------------------
// 5. 골격화

function thinZhangSuen(sk: Uint8Array, W: number): void {
  let list: number[] = [];
  for (let i = 0; i < sk.length; i++) if (sk[i]) list.push(i);
  const del: number[] = [];
  for (let iter = 0; iter < 200; iter++) {
    let changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        if (!sk[i]) continue;
        const p2 = sk[i - W];
        const p3 = sk[i - W + 1];
        const p4 = sk[i + 1];
        const p5 = sk[i + W + 1];
        const p6 = sk[i + W];
        const p7 = sk[i + W - 1];
        const p8 = sk[i - 1];
        const p9 = sk[i - W - 1];
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          (p2 < p3 ? 1 : 0) +
          (p3 < p4 ? 1 : 0) +
          (p4 < p5 ? 1 : 0) +
          (p5 < p6 ? 1 : 0) +
          (p6 < p7 ? 1 : 0) +
          (p7 < p8 ? 1 : 0) +
          (p8 < p9 ? 1 : 0) +
          (p9 < p2 ? 1 : 0);
        if (a !== 1) continue;
        if (step === 0) {
          if (p2 && p4 && p6) continue;
          if (p4 && p6 && p8) continue;
        } else {
          if (p2 && p4 && p8) continue;
          if (p2 && p6 && p8) continue;
        }
        del.push(i);
      }
      for (let k = 0; k < del.length; k++) sk[del[k]] = 0;
      if (del.length) changed = true;
    }
    if (!changed) break;
    const next: number[] = [];
    for (let k = 0; k < list.length; k++) if (sk[list[k]]) next.push(list[k]);
    list = next;
  }
  // 계단 모서리 픽셀을 지워 8-연결 1픽셀 폭으로 만든다.
  // 직교 이웃이 둘 있고 반대쪽 세 이웃이 비어 있으면 지워도 연결이 유지된다.
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    if (!sk[i]) continue;
    const n = sk[i - W];
    const e = sk[i + 1];
    const s = sk[i + W];
    const w = sk[i - 1];
    if (
      (n && e && !s && !w && !sk[i + W - 1]) ||
      (e && s && !n && !w && !sk[i - W - 1]) ||
      (s && w && !n && !e && !sk[i - W + 1]) ||
      (w && n && !s && !e && !sk[i + W + 1])
    ) {
      sk[i] = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// 6. 골격 그래프 → 획

interface Edge {
  px: number[];
  a: number;
  b: number;
  removed: boolean;
}

interface Chain {
  /** 골격 픽셀(굵기와 색 통계용). */
  px: number[];
  /** 처리 해상도 좌표. */
  pts: Pt[];
  closed: boolean;
}

function traceSkeleton(sk: Uint8Array, W: number, dist2: Float32Array): Chain[] {
  const off = [-W, 1, W, -1, -W + 1, W + 1, W - 1, -W - 1];
  const N = sk.length;
  const xy = (i: number): Pt => [(i % W) - 0.5, Math.floor(i / W) - 0.5];
  const pixels: number[] = [];
  for (let i = 0; i < N; i++) if (sk[i]) pixels.push(i);
  const nb = new Uint8Array(N);
  for (const i of pixels) {
    let c = 0;
    for (let k = 0; k < 8; k++) c += sk[i + off[k]];
    nb[i] = c;
  }
  const chains: Chain[] = [];

  // 노드: 끝점(이웃 1)과 분기 픽셀(이웃 3 이상) 묶음
  const nodeOf = new Int32Array(N).fill(-1);
  const isJunction: boolean[] = [];
  const nodePixels: number[][] = [];
  for (const i of pixels) {
    if (nb[i] === 0) {
      chains.push({ px: [i], pts: [xy(i)], closed: false });
      continue;
    }
    if (nb[i] === 2 || nodeOf[i] >= 0) continue;
    const id = isJunction.length;
    nodeOf[i] = id;
    if (nb[i] === 1) {
      isJunction.push(false);
      nodePixels.push([i]);
      continue;
    }
    isJunction.push(true);
    const members = [i];
    for (let head = 0; head < members.length; head++) {
      for (let k = 0; k < 8; k++) {
        const q = members[head] + off[k];
        if (sk[q] && nb[q] >= 3 && nodeOf[q] < 0) {
          nodeOf[q] = id;
          members.push(q);
        }
      }
    }
    nodePixels.push(members);
  }
  const nodeCount = isJunction.length;

  // 가지 추적
  const visited = new Uint8Array(N);
  const edges: Edge[] = [];
  const direct = new Set<number>();
  for (const p of pixels) {
    const np = nodeOf[p];
    if (np < 0) continue;
    for (let k = 0; k < 8; k++) {
      const q = p + off[k];
      if (!sk[q]) continue;
      const nq = nodeOf[q];
      if (nq >= 0) {
        // 서로 다른 노드가 바로 붙어 있는 경우. 같은 노드 쌍은 한 번만 잇는다.
        if (nq === np) continue;
        const key = Math.min(np, nq) * nodeCount + Math.max(np, nq);
        if (!direct.has(key)) {
          direct.add(key);
          edges.push({ px: [p, q], a: np, b: nq, removed: false });
        }
        continue;
      }
      if (visited[q]) continue;
      visited[q] = 1;
      const path = [p, q];
      let prev = p;
      let cur = q;
      let end = -1;
      for (;;) {
        let next = -1;
        for (let m = 0; m < 8; m++) {
          const r = cur + off[m];
          if (!sk[r] || r === prev) continue;
          if (nodeOf[r] >= 0 || !visited[r]) {
            next = r;
            break;
          }
        }
        if (next < 0) break;
        path.push(next);
        if (nodeOf[next] >= 0) {
          end = nodeOf[next];
          break;
        }
        visited[next] = 1;
        prev = cur;
        cur = next;
      }
      edges.push({ px: path, a: np, b: end, removed: false });
    }
  }
  // 노드 없는 고리
  for (const i of pixels) {
    if (nb[i] !== 2 || visited[i]) continue;
    visited[i] = 1;
    const path = [i];
    let cur = i;
    for (;;) {
      let next = -1;
      for (let m = 0; m < 8; m++) {
        const r = cur + off[m];
        if (sk[r] && !visited[r]) {
          next = r;
          break;
        }
      }
      if (next < 0) break;
      visited[next] = 1;
      path.push(next);
      cur = next;
    }
    chains.push({ px: path, pts: path.map(xy), closed: path.length > 3 && isAdjacent(cur, i, W) });
  }

  const radiusAt = (i: number): number => Math.sqrt(dist2[i]);
  const nodeRadius = (n: number): number => {
    let r = 0;
    for (const p of nodePixels[n]) r = Math.max(r, radiusAt(p));
    return r;
  };

  // 잔가지 제거와 가까운 분기점 합치기
  const group = new Int32Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) group[n] = n;
  const find = (a: number): number => {
    while (group[a] !== a) {
      group[a] = group[group[a]];
      a = group[a];
    }
    return a;
  };
  const degree = new Int32Array(nodeCount);
  const recount = (): void => {
    degree.fill(0);
    for (const e of edges) {
      if (e.removed) continue;
      if (e.a >= 0) degree[find(e.a)]++;
      if (e.b >= 0) degree[find(e.b)]++;
    }
  };
  for (let round = 0; round < 3; round++) {
    let changed = false;
    recount();
    for (const e of edges) {
      if (e.removed || e.a < 0 || e.b < 0) continue;
      const ga = find(e.a);
      const gb = find(e.b);
      const len = e.px.length;
      if (ga === gb) {
        // 같은 분기점으로 돌아오는 짧은 고리는 작은 구멍의 흔적이다.
        if (len < 2 * nodeRadius(e.a) + 6) {
          e.removed = true;
          changed = true;
        }
        continue;
      }
      const ja = isJunction[ga];
      const jb = isJunction[gb];
      if (ja && jb) {
        // 굵은 교차점은 골격에서 두 분기점으로 갈라진다. 짧게 이어진 둘은 한 점으로 본다.
        if (len <= Math.max(nodeRadius(e.a), nodeRadius(e.b)) + 1) {
          group[gb] = ga;
          for (const p of e.px) nodePixels[e.a].push(p);
          e.removed = true;
          changed = true;
        }
        continue;
      }
      // 한쪽이 끝점인 짧은 가지 = 잔가지
      const junction = ja ? e.a : jb ? e.b : -1;
      if (junction < 0 || degree[find(junction)] < 3) continue;
      // 진짜 가지는 몸통 바깥으로 뚜렷이 나온다. 경계의 요철이나 획 끝 모서리가 만든 가지는
      // 몸통 원 밖으로 조금만 나온다(사각 모서리는 반경의 약 0.4배).
      const tip = ja ? e.px[len - 1] : e.px[0];
      const root = ja ? e.px[0] : e.px[len - 1];
      const [tx, ty] = xy(tip);
      const [jx, jy] = xy(root);
      const r = radiusAt(root);
      if (Math.hypot(tx - jx, ty - jy) + radiusAt(tip) - r < 0.6 * r + 1.5) {
        e.removed = true;
        degree[find(junction)]--;
        changed = true;
      }
    }
    if (!changed) break;
  }
  recount();

  // 분기 그룹의 중심과 반경
  const gx = new Float64Array(nodeCount);
  const gy = new Float64Array(nodeCount);
  const gc = new Float64Array(nodeCount);
  const gr = new Float64Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) {
    const g = find(n);
    for (const p of nodePixels[n]) {
      const [x, y] = xy(p);
      gx[g] += x;
      gy[g] += y;
      gc[g]++;
      gr[g] = Math.max(gr[g], radiusAt(p));
    }
  }
  for (let g = 0; g < nodeCount; g++) {
    if (gc[g]) {
      gx[g] /= gc[g];
      gy[g] /= gc[g];
    }
  }
  const groupIsJunction = (g: number): boolean => g >= 0 && isJunction[g];

  // 그룹별로 만나는 가지 끝. 끝 표기: 가지 번호 * 2 + (0 = a쪽, 1 = b쪽)
  const ends: number[][] = Array.from({ length: nodeCount }, () => []);
  edges.forEach((e, ei) => {
    if (e.removed) return;
    if (e.a >= 0) ends[find(e.a)].push(ei * 2);
    if (e.b >= 0) ends[find(e.b)].push(ei * 2 + 1);
  });
  const partner = new Int32Array(edges.length * 2).fill(-1);
  const endGroup = new Int32Array(edges.length * 2).fill(-1);
  const directionOf = (end: number, r: number): Pt => {
    const e = edges[end >> 1];
    const len = e.px.length;
    const at = (k: number): Pt => xy((end & 1) === 0 ? e.px[k] : e.px[len - 1 - k]);
    // 분기점 근처는 골격이 휘므로 반경만큼 떨어진 구간의 방향을 본다.
    const from = Math.min(len - 1, Math.max(0, Math.round(r)));
    const to = Math.min(len - 1, from + Math.max(5, Math.round(2 * r + 3)));
    const p = at(to - from < 3 ? 0 : from);
    const q = at(to);
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const maxTurnCos = Math.cos((55 * Math.PI) / 180);
  for (let g = 0; g < nodeCount; g++) {
    const list = ends[g];
    for (const en of list) endGroup[en] = g;
    if (list.length === 2) {
      partner[list[0]] = list[1];
      partner[list[1]] = list[0];
      continue;
    }
    if (list.length < 3) continue;
    const dirs = list.map((en) => directionOf(en, gr[g]));
    const pairs: Array<[number, number, number]> = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const c = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1];
        if (c <= -maxTurnCos) pairs.push([c, i, j]);
      }
    }
    pairs.sort((p, q) => p[0] - q[0]);
    const used = new Uint8Array(list.length);
    for (const [, i, j] of pairs) {
      if (used[i] || used[j]) continue;
      used[i] = used[j] = 1;
      partner[list[i]] = list[j];
      partner[list[j]] = list[i];
    }
  }

  // 짝을 따라 가지를 이어 획을 만든다.
  const edgeUsed = new Uint8Array(edges.length);
  const walk = (startEnd: number): Chain => {
    const px: number[] = [];
    const pts: Pt[] = [];
    const push = (p: Pt): void => {
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    };
    let closed = false;
    let entry = startEnd;
    const g0 = endGroup[startEnd];
    if (groupIsJunction(g0)) push([gx[g0], gy[g0]]);
    for (;;) {
      const ei = entry >> 1;
      edgeUsed[ei] = 1;
      const e = edges[ei];
      const forward = (entry & 1) === 0;
      for (let k = 0; k < e.px.length; k++) {
        const p = forward ? e.px[k] : e.px[e.px.length - 1 - k];
        px.push(p);
        // 분기 픽셀은 그룹 중심으로 대신한다.
        const n = nodeOf[p];
        if (n >= 0 && groupIsJunction(find(n))) continue;
        push(xy(p));
      }
      const exit = entry ^ 1;
      const ge = endGroup[exit];
      if (groupIsJunction(ge)) push([gx[ge], gy[ge]]);
      const pe = partner[exit];
      if (pe < 0) break;
      if (edgeUsed[pe >> 1]) {
        closed = pe === startEnd;
        break;
      }
      entry = pe;
    }
    if (closed && pts.length > 1) {
      const a = pts[0];
      const z = pts[pts.length - 1];
      if (a[0] === z[0] && a[1] === z[1]) pts.pop();
    }
    return { px, pts, closed };
  };
  for (let ei = 0; ei < edges.length; ei++) {
    for (let side = 0; side < 2; side++) {
      const en = ei * 2 + side;
      if (!edges[ei].removed && !edgeUsed[ei] && partner[en] < 0) chains.push(walk(en));
    }
  }
  for (let ei = 0; ei < edges.length; ei++) {
    if (!edges[ei].removed && !edgeUsed[ei]) chains.push(walk(ei * 2));
  }
  return chains;
}

function isAdjacent(a: number, b: number, W: number): boolean {
  return Math.abs((a % W) - (b % W)) <= 1 && Math.abs(Math.floor(a / W) - Math.floor(b / W)) <= 1;
}

// ---------------------------------------------------------------------------
// 7. 평활과 단순화

function smoothPoints(pts: Pt[], closed: boolean, passes: number): Pt[] {
  const n = pts.length;
  if (n < 5) return pts;
  const weights = [1, 2, 3, 2, 1];
  let cur = pts;
  for (let pass = 0; pass < passes; pass++) {
    const next: Pt[] = new Array(n);
    for (let i = 0; i < n; i++) {
      // 열린 획은 끝 가까이에서 창을 줄여 끝점이 당겨지지 않게 한다.
      const reach = closed ? 2 : Math.min(2, i, n - 1 - i);
      let sx = 0;
      let sy = 0;
      let sw = 0;
      for (let k = -reach; k <= reach; k++) {
        const p = cur[(i + k + n) % n];
        const wt = weights[k + 2];
        sx += p[0] * wt;
        sy += p[1] * wt;
        sw += wt;
      }
      next[i] = [sx / sw, sy / sw];
    }
    cur = next;
  }
  return cur;
}

function simplify(pts: Pt[], tol: number): Pt[] {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const tol2 = tol * tol;
  while (stack.length) {
    const b = stack.pop() as number;
    const a = stack.pop() as number;
    const ax = pts[a][0];
    const ay = pts[a][1];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const l2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] - ax;
      const py = pts[i][1] - ay;
      const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(a, best, best, b);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 고리는 첫 점과 가장 먼 점에서 둘로 나눠 단순화한다. 마지막 점은 첫 점과 같다. */
function simplifyRing(pts: Pt[], tol: number): Pt[] {
  let far = 1;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const dd = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (dd > farD) {
      farD = dd;
      far = i;
    }
  }
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify(pts.slice(far).concat([pts[0]]), tol);
  return a.concat(b.slice(1));
}

function polylineLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

// ---------------------------------------------------------------------------
// 8. 색 분류

/**
 * 배경으로 나눈 채널별 투과율을 받아 색을 고른다. 흡광도(-ln 투과율)의 비율은 마커가 진하든
 * 흐리든 비슷하므로 흡광도의 채도와 색상각으로 판정하고, 애매하면 검정으로 둔다.
 */
function classifyInkColor(tr: number, tg: number, tb: number): InkColor {
  const absorb = (t: number): number => -Math.log(Math.min(1, Math.max(0.02, t)));
  const ar = absorb(tr);
  const ag = absorb(tg);
  const ab = absorb(tb);
  const max = Math.max(ar, ag, ab);
  const chroma = max - Math.min(ar, ag, ab);
  if (chroma < 0.06 || chroma / max < 0.38) return "black";
  let hue: number;
  if (max === ar) hue = 60 * (((ag - ab) / chroma + 6) % 6);
  else if (max === ag) hue = 60 * ((ab - ar) / chroma + 2);
  else hue = 60 * ((ar - ag) / chroma + 4);
  // 흡수한 색의 보색이 눈에 보이는 색이다.
  const visible = (hue + 180) % 360;
  if (visible >= 300 || visible < 40) return "red";
  if (visible >= 75 && visible < 170) return "green";
  if (visible >= 170 && visible < 285) return "blue";
  return "black";
}

// ---------------------------------------------------------------------------
// 공개 함수

export function extractInkStrokes(image: InkImageInput, options: InkStrokeOptions = {}): InkStrokeResult {
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

  // 처리 해상도 단위 파라미터
  const minArea = (positive(options.minComponentArea) ?? 8 / (s * s)) * s * s;
  const maxWidthP = (positive(options.maxStrokeWidth) ?? (Math.max(pw, ph) * 0.014) / s) * s;
  const minLenP = (positive(options.minStrokeLength) ?? 4 / s) * s;
  const tolP = (positive(options.simplifyTolerance) ?? 0.6 / s) * s;
  const maxStrokes = Math.floor(positive(options.maxStrokes) ?? DEFAULTS.maxStrokes);
  const maxPoints = Math.floor(positive(options.maxPoints) ?? DEFAULTS.maxPoints);
  const inkContrast = Math.min(0.9, positive(options.inkContrast) ?? DEFAULTS.inkContrast);

  const img = downsample(image.data, width, height, pw, ph);
  const bg = estimateBackground(img);
  const d = inkContrastMap(img, bg);
  const noise = contrastNoise(d);
  const high = Math.max(inkContrast, noise.median + 7 * noise.sigma);
  const low = Math.max(inkContrast * 0.55, noise.median + 3.5 * noise.sigma);

  // 2~3. 이진화(히스테리시스)와 잡음 제거. 1px 패딩된 격자를 쓴다.
  const W = pw + 2;
  const H = ph + 2;
  const N = W * H;
  let mask = new Uint8Array(N);
  let any = false;
  // 획 가장자리는 초점과 JPEG 때문에 번진다. 가까운 획 중심 대비의 절반을 경계로 잡아야
  // 굵기가 실제와 같고 획 사이 좁은 틈이 메워지지 않는다.
  const peak = localMax(d, pw, ph, Math.max(2, Math.round(Math.max(pw, ph) * 0.003)));
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const v = d[y * pw + x];
      if (v >= low && v >= peak[y * pw + x] * 0.5) {
        mask[(y + 1) * W + x + 1] = 1;
        any = true;
      }
    }
  }
  if (!any) return emptyResult(width, height, s);
  {
    const { labels, count, areas } = labelComponents(mask, W, H, true);
    const strong = new Uint8Array(count + 1);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        if (d[y * pw + x] >= high) strong[labels[(y + 1) * W + x + 1]] = 1;
      }
    }
    for (let i = 0; i < N; i++) if (mask[i] && (!strong[labels[i]] || areas[labels[i]] < minArea)) mask[i] = 0;
  }
  {
    const holeMax = Math.max(3, minArea * 0.8);
    const { labels, areas } = labelComponents(invert(mask), W, H, false);
    const outside = labels[0];
    for (let i = 0; i < N; i++) if (labels[i] && labels[i] !== outside && areas[labels[i]] <= holeMax) mask[i] = 1;
  }

  // 4. 펜보다 훨씬 굵은 부분을 깎아 낸다(거리 변환으로 하는 opening). 덩어리에 붙은 획은 남는다.
  let dist2 = sqDistanceTo(invert(mask), W, H);
  const R = maxWidthP / 2 + 0.5;
  const thick = new Uint8Array(N);
  let anyThick = false;
  for (let i = 0; i < N; i++) {
    if (dist2[i] > R * R) {
      thick[i] = 1;
      anyThick = true;
    }
  }
  if (anyThick) {
    const toThick = sqDistanceTo(thick, W, H);
    const reach = 1.25 * R + 1.5;
    for (let i = 0; i < N; i++) if (toThick[i] <= reach * reach) mask[i] = 0;
    // 깎은 자리에 맞닿은 작은 조각은 덩어리 모서리의 부스러기다.
    const { labels, count, areas } = labelComponents(mask, W, H, true);
    const limit = (reach + 2) * (reach + 2);
    const touching = new Uint8Array(count + 1);
    for (let i = 0; i < N; i++) if (labels[i] && toThick[i] <= limit) touching[labels[i]] = 1;
    const next = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const l = labels[i];
      if (l && areas[l] >= (touching[l] ? 2 * R * R : minArea)) next[i] = 1;
    }
    mask = next;
    dist2 = sqDistanceTo(invert(mask), W, H);
  }
  const comp = labelComponents(mask, W, H, true);
  if (comp.count === 0) return emptyResult(width, height, s);

  // 5~6. 골격과 획
  const sk = mask.slice();
  thinZhangSuen(sk, W);
  const chains = traceSkeleton(sk, W, dist2);

  // 8. 굵기와 색 통계. 아주 짧은 획은 연결 요소 전체 색을 따른다.
  const compSum = new Float64Array((comp.count + 1) * 4);
  const chainsPerComp = new Int32Array(comp.count + 1);
  const stats = chains.map((c) => {
    const sum = [0, 0, 0, 0];
    const radii = new Float32Array(c.px.length);
    let order = Infinity;
    c.px.forEach((p, k) => {
      const x = (p % W) - 1;
      const y = Math.floor(p / W) - 1;
      const o = (y * pw + x) * 3;
      const wgt = Math.max(0.05, d[y * pw + x]);
      sum[0] += (img.rgb[o] / Math.max(8, sampleGrid(bg.r, bg, x, y))) * wgt;
      sum[1] += (img.rgb[o + 1] / Math.max(8, sampleGrid(bg.g, bg, x, y))) * wgt;
      sum[2] += (img.rgb[o + 2] / Math.max(8, sampleGrid(bg.b, bg, x, y))) * wgt;
      sum[3] += wgt;
      radii[k] = Math.sqrt(dist2[p]);
      if (p < order) order = p;
    });
    const label = comp.labels[c.px[0]];
    for (let k = 0; k < 4; k++) compSum[label * 4 + k] += sum[k];
    chainsPerComp[label]++;
    radii.sort();
    return { sum, label, order, radius: radii[radii.length >> 1], n: c.px.length };
  });

  const candidates: Array<InkStroke & { length: number; order: number }> = [];
  const ix = 1 / sx;
  const iy = 1 / sy;
  const round2 = (v: number): number => Math.round(v * 100) / 100;
  chains.forEach((c, ci) => {
    const st = stats[ci];
    const closed = c.closed && c.pts.length >= 4;
    const pts = options.smooth === false ? c.pts : smoothPoints(c.pts, closed, 2);
    let simple = closed ? simplifyRing(pts, tolP) : simplify(pts, tolP);
    const length = polylineLength(simple);
    if (length < minLenP && chainsPerComp[st.label] > 1) return;
    if (simple.length === 1) simple = [simple[0], simple[0]];
    const sum = st.n < 14 ? compSum.subarray(st.label * 4, st.label * 4 + 4) : st.sum;
    candidates.push({
      points: simple.map(([x, y]): InkPoint => [round2(x * ix), round2(y * iy)]),
      color: classifyInkColor(sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]),
      width: round2(Math.max(1, 2 * st.radius - 1) / s),
      closed,
      length,
      order: st.order,
    });
  });

  // 9. 상한: 긴 획부터 담는다.
  candidates.sort((a, b) => b.length - a.length);
  const kept: typeof candidates = [];
  let points = 0;
  let truncated = false;
  for (const c of candidates) {
    if (kept.length >= maxStrokes || points + c.points.length > maxPoints) {
      truncated = true;
      break;
    }
    kept.push(c);
    points += c.points.length;
  }
  // 위에서 아래로 읽는 순서로 되돌린다.
  kept.sort((a, b) => a.order - b.order);
  return {
    width,
    height,
    strokes: kept.map(({ points: p, color, width: w, closed }) => ({ points: p, color, width: w, closed })),
    truncated,
    scale: s,
  };
}

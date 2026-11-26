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
 * 5. Guo-Hall 골격화 후 계단 픽셀을 지워 1픽셀 골격을 만든다. 작고 얇은 글씨는 연결 요소별로 대비를 2배 확대해
 *    이진화와 골격화를 다시 한다. 2~4px 획을 원래 격자에서 골격화하면 짧은 획과 속공간이 픽셀에 묻히기 때문이다.
 * 6. 골격 그래프에서 잔가지를 지우고 가까운 분기점을 합친 뒤, 분기점에서 방향이 가장 곧게
 *    이어지는 가지끼리 이어 붙여 획을 만든다. 잔가지는 분기점의 거리값이 아니라 이웃 가지의 굵기를 기준으로 가린다.
 * 7. 가볍게 평활한 뒤 Ramer-Douglas-Peucker로 점 수를 줄인다.
 * 8. 획 굵기는 획에 수직인 단면의 반값 폭으로, 색은 단면 전체에서 모은 채널별 어두워진 양의 비율로 정한다.
 *    지운 잔상, 종이 가장자리, 보드 테두리, 보드 밖 벽과 물건, 잡음 점처럼 글씨가 아닌 획을 버린다.
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
  /**
   * 이보다 짧은 획은 버린다(입력 px). 홀로 떨어진 점은 예외. 정하지 않으면 다른 획에 붙은 짧은 가지는
   * 획 반폭 길이까지 남기고, 나머지 짧은 조각은 처리 해상도 4px에서 거른다.
   */
  minStrokeLength?: number;
  /** 단순화 허용 오차(입력 px). 기본은 처리 해상도 0.6px. */
  simplifyTolerance?: number;
  /** 펜 획으로 인정하는 최대 굵기(입력 px). 더 굵은 덩어리는 잉크가 아닌 것으로 본다. 기본은 처리 해상도 긴 변의 1.4%(최소 18px). */
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

export interface Downsampled {
  w: number;
  h: number;
  rgb: Uint8Array;
  lum: Float32Array;
}

/** 면적 가중 평균으로 줄인다. 비율이 정수가 아니어도 획 굵기가 들쭉날쭉해지지 않는다. */
export function downsample(src: ArrayLike<number>, sw: number, sh: number, w: number, h: number): Downsampled {
  const rgb = new Uint8Array(w * h * 3);
  const lum = new Float32Array(w * h);
  const stepX = sw / w;
  const stepY = sh / h;
  const line = new Float64Array(w * 3);
  const acc = new Float64Array(w * 3);
  const put = (j: number): void => {
    const norm = 1 / (stepX * stepY);
    for (let i = 0; i < w; i++) {
      const r = acc[i * 3] * norm;
      const g = acc[i * 3 + 1] * norm;
      const b = acc[i * 3 + 2] * norm;
      const o = (j * w + i) * 3;
      rgb[o] = Math.min(255, r + 0.5);
      rgb[o + 1] = Math.min(255, g + 0.5);
      rgb[o + 2] = Math.min(255, b + 0.5);
      lum[j * w + i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    acc.fill(0);
  };
  let j = 0;
  for (let y = 0; y < sh; y++) {
    // 가로: 이 행을 w칸으로 누적
    line.fill(0);
    let i = 0;
    let edge = stepX;
    let o = y * sw * 4;
    for (let x = 0; x < sw; x++, o += 4) {
      const k = i * 3;
      if (x + 1 <= edge || i === w - 1) {
        line[k] += src[o];
        line[k + 1] += src[o + 1];
        line[k + 2] += src[o + 2];
        if (x + 1 === edge && i < w - 1) {
          i++;
          edge = (i + 1) * stepX;
        }
      } else {
        const part = edge - x;
        line[k] += src[o] * part;
        line[k + 1] += src[o + 1] * part;
        line[k + 2] += src[o + 2] * part;
        line[k + 3] += src[o] * (1 - part);
        line[k + 4] += src[o + 1] * (1 - part);
        line[k + 5] += src[o + 2] * (1 - part);
        i++;
        edge = (i + 1) * stepX;
      }
    }
    // 세로
    const bottom = (j + 1) * stepY;
    const here = j === h - 1 ? 1 : Math.min(1, bottom - y);
    for (let k = 0; k < line.length; k++) acc[k] += line[k] * here;
    if (y + 1 >= bottom && j < h - 1) {
      put(j);
      j++;
      const rest = 1 - here;
      if (rest > 0) for (let k = 0; k < line.length; k++) acc[k] += line[k] * rest;
    }
  }
  put(h - 1);
  return { w, h, rgb, lum };
}

// ---------------------------------------------------------------------------
// 2. 배경 추정

export interface Background {
  block: number;
  gw: number;
  gh: number;
  lum: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** 흐리기 전의 블록별 배경(순위 필터까지). 보드와 벽의 경계를 또렷하게 본다. */
  block3: { l: Float32Array; r: Float32Array; g: Float32Array; b: Float32Array };
}

export function estimateBackground(img: Downsampled): Background {
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
    block3: { l: rl, r: rr, g: rg, b: rb },
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
export function sampleGrid(grid: Float32Array, bg: Background, x: number, y: number): number {
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
export function inkContrastMap(img: Downsampled, bg: Background): { raw: Float32Array; smooth: Float32Array } {
  const { w, h, lum } = img;
  const raw = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const b = Math.max(8, sampleGrid(bg.lum, bg, x, y));
      raw[y * w + x] = (b - lum[y * w + x]) / b;
    }
  }
  const d = new Float32Array(raw);
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
  return { raw, smooth: d };
}

/** 반경 r 안의 최댓값(정사각 창). 가로와 세로로 나눠 van Herk 방식으로 계산해 창 크기와 상관없이 빠르다. */
export function localMax(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(src.length);
  const size = 2 * r + 1;
  const n = Math.max(w, h) + 2 * r;
  const line = new Float32Array(n);
  const fwd = new Float32Array(n);
  const bwd = new Float32Array(n);
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
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) line[r + x] = src[row + x];
    run(w);
    for (let x = 0; x < w; x++) out[row + x] = bwd[x] > fwd[x + size - 1] ? bwd[x] : fwd[x + size - 1];
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) line[r + y] = out[y * w + x];
    run(h);
    for (let y = 0; y < h; y++) out[y * w + x] = bwd[y] > fwd[y + size - 1] ? bwd[y] : fwd[y + size - 1];
  }
  return out;
}

/** 대비 지도의 중앙값과 잡음 크기(MAD 기반 표준편차)를 잰다. */
export function contrastNoise(d: Float32Array): { median: number; sigma: number } {
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

export interface Labels {
  labels: Int32Array;
  count: number;
  areas: Int32Array;
}

/** 연결 요소 라벨링(두 패스 union-find). 라벨은 1부터, 0은 바탕. */
export function labelComponents(mask: Uint8Array, W: number, H: number, conn8: boolean): Labels {
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
export function sqDistanceTo(target: Uint8Array, W: number, H: number): Float32Array {
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

/**
 * 잉크 픽셀에서 가장 가까운 바탕까지의 제곱 거리. 바탕은 0이다. 격자 둘레 1px은 바탕이어야 한다.
 * 한 행의 이어진 잉크 구간은 양옆 바탕 픽셀보다 먼 열의 영향을 받지 않으므로 구간 안에서만 계산한다.
 */
export function inkDistance2(mask: Uint8Array, W: number, H: number): Float32Array {
  const g = new Int32Array(W * H);
  for (let y = 1; y < H; y++) {
    for (let x = 0, i = y * W; x < W; x++, i++) if (mask[i]) g[i] = g[i - W] + 1;
  }
  for (let y = H - 2; y >= 0; y--) {
    for (let x = 0, i = y * W; x < W; x++, i++) if (g[i] > g[i + W] + 1) g[i] = g[i + W] + 1;
  }
  const out = new Float32Array(W * H);
  const f = new Float64Array(W + 2);
  const v = new Int32Array(W + 2);
  const z = new Float64Array(W + 3);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let x = 0;
    while (x < W) {
      if (!mask[row + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < W && mask[row + e]) e++;
      const a = Math.max(0, x - 1);
      const len = Math.min(W - 1, e) - a + 1;
      for (let q = 0; q < len; q++) f[q] = g[row + a + q] * g[row + a + q];
      let k = 0;
      v[0] = 0;
      z[0] = -Infinity;
      z[1] = Infinity;
      for (let q = 1; q < len; q++) {
        let t = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (t <= z[k]) {
          k--;
          t = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k++;
        v[k] = q;
        z[k] = t;
        z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < len; q++) {
        while (z[k + 1] < q) k++;
        const dq = q - v[k];
        out[row + a + q] = dq * dq + f[v[k]];
      }
      x = e;
    }
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

/**
 * Guo-Hall 골격화. Zhang-Suen은 두세 픽셀 굵기의 대각선 획과 획 끝을 통째로 깎아 먹어서
 * 작은 글자의 획이 사라지므로 쓰지 않는다.
 */
function thin(sk: Uint8Array, W: number): void {
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
        const c = ((p2 ^ 1) & (p3 | p4)) + ((p4 ^ 1) & (p5 | p6)) + ((p6 ^ 1) & (p7 | p8)) + ((p8 ^ 1) & (p9 | p2));
        if (c !== 1) continue;
        const n1 = (p9 | p2) + (p3 | p4) + (p5 | p6) + (p7 | p8);
        const n2 = (p2 | p3) + (p4 | p5) + (p6 | p7) + (p8 | p9);
        const n = n1 < n2 ? n1 : n2;
        if (n < 2 || n > 3) continue;
        const keep = step === 0 ? (p6 | p7 | (p9 ^ 1)) & p8 : (p2 | p3 | (p5 ^ 1)) & p4;
        if (!keep) del.push(i);
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
  const incident: number[][] = Array.from({ length: nodeCount }, () => []);
  const recount = (): void => {
    degree.fill(0);
    for (const list of incident) list.length = 0;
    edges.forEach((e, ei) => {
      if (e.removed) return;
      if (e.a >= 0) {
        degree[find(e.a)]++;
        incident[find(e.a)].push(ei);
      }
      if (e.b >= 0) {
        degree[find(e.b)]++;
        incident[find(e.b)].push(ei);
      }
    });
  };
  /**
   * 분기점에 붙은 다른 가지들의 몸통 반경(중앙값). 분기 픽셀의 거리값은 T자나 十자에서 획 반폭보다 커서,
   * 그것을 기준으로 잔가지를 판정하면 'ㅏ'의 짧은 가지처럼 진짜 획이 잔가지로 잘린다.
   */
  const stemRadius = (g: number, skip: Edge, r: number): number => {
    const radii: number[] = [];
    const from = Math.ceil(r);
    for (const fi of incident[g]) {
      const f = edges[fi];
      if (f === skip || f.removed) continue;
      const fromA = f.a >= 0 && find(f.a) === g;
      const n = f.px.length;
      for (let k = from; k < Math.min(n - 1, from + 4); k++) {
        const p = fromA ? f.px[k] : f.px[n - 1 - k];
        if (nodeOf[p] < 0) radii.push(radiusAt(p));
      }
    }
    if (radii.length < 3) return r;
    radii.sort((p, q) => p - q);
    return Math.min(r, radii[radii.length >> 1]);
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
        // 두 원이 겹칠 만큼 가까울 때만 합쳐야 ㅁ, ㅍ의 짧은 변이 살아남는다.
        const pa = xy(e.px[0]);
        const pb = xy(e.px[len - 1]);
        if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) <= nodeRadius(e.a) + nodeRadius(e.b) + 1 && len <= 2 * (nodeRadius(e.a) + nodeRadius(e.b)) + 2) {
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
      const r = stemRadius(find(junction), e, radiusAt(root));
      if (Math.hypot(tx - jx, ty - jy) + radiusAt(tip) - r < 0.5 * r + 0.7) {
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
// 잔글씨 확대 처리

/** 획 후보. 좌표는 모두 처리 해상도의 연속 좌표다. */
interface Piece {
  pts: Pt[];
  /** 골격 픽셀 중심(굵기와 색 통계용). */
  path: Pt[];
  closed: boolean;
  /** 골격 픽셀 간격(처리 px). 확대한 격자에서는 1보다 작다. */
  step: number;
  /** path의 각 자리에서 바탕까지 거리(처리 px). */
  radii: Float32Array;
  label: number;
}

interface FineInput {
  pw: number;
  ph: number;
  /** 경계 판정에 쓰는 대비(처리 해상도). */
  edge: Float32Array;
  peak: Float32Array;
  low: number;
  /** 1px 패딩된 연결 요소 라벨. */
  labels: Int32Array;
  W: number;
}

/** 확대 배율. 획 굵기 2~4px인 글씨가 4~8px이 되어 골격화가 짧은 획과 속공간을 지킨다. */
const FINE = 2;

/** 확대 격자에서 경계를 잡을 때, 흐림 전 값을 흐린 값보다 얼마나 앞세우는지. 1이면 흐림 전 값 그대로, 크면 좁은 속공간의 골이 깊어진다. */
const FINE_SHARP = 1.5;

/** Catmull-Rom 보간 가중치(t는 두 번째 표본에서 떨어진 거리). */
function cubicWeights(t: number): number[] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

/**
 * 처리 해상도 구역 [x0, x1) x [y0, y1)의 대비를 FINE배 확대해 이진화와 골격화를 다시 한다.
 * own[라벨]이 1인 연결 요소만 다루고, 라벨이 다른 두 요소 사이의 바탕은 그대로 둔다.
 */
function traceFine(input: FineInput, own: Uint8Array, x0: number, y0: number, x1: number, y1: number): Piece[] {
  const { pw, ph, edge, peak, low, labels, W } = input;
  const fw = (x1 - x0) * FINE;
  const fh = (y1 - y0) * FINE;
  const FW = fw + 2;
  const FH = fh + 2;
  const cols: Array<{ k: number[]; w: number[] }> = [];
  const taps = (i: number, origin: number, limit: number): { k: number[]; w: number[] } => {
    const u = origin + (i + 0.5) / FINE - 0.5;
    const b = Math.floor(u);
    return { k: [-1, 0, 1, 2].map((o) => Math.max(0, Math.min(limit - 1, b + o))), w: cubicWeights(u - b) };
  };
  for (let i = 0; i < fw; i++) cols.push(taps(i, x0, pw));
  // 가로 보간한 행은 필요한 것만 만든다.
  const rows = new Map<number, Float32Array>();
  const rowOf = (y: number): Float32Array => {
    let r = rows.get(y);
    if (!r) {
      r = new Float32Array(fw);
      const base = y * pw;
      for (let i = 0; i < fw; i++) {
        const { k, w } = cols[i];
        r[i] = edge[base + k[0]] * w[0] + edge[base + k[1]] * w[1] + edge[base + k[2]] * w[2] + edge[base + k[3]] * w[3];
      }
      rows.set(y, r);
      rows.delete(y - 6);
    }
    return r;
  };
  const mask = new Uint8Array(FW * FH);
  const owner = new Int32Array(FW * FH);
  const around = [0, -1, 1, -W, W, -W - 1, -W + 1, W - 1, W + 1];
  for (let j = 0; j < fh; j++) {
    const { k, w } = taps(j, y0, ph);
    const ra = rowOf(k[0]);
    const rb = rowOf(k[1]);
    const rc = rowOf(k[2]);
    const rd = rowOf(k[3]);
    const by = y0 + Math.floor(j / FINE);
    for (let i = 0; i < fw; i++) {
      const bx = x0 + Math.floor(i / FINE);
      const at = (by + 1) * W + bx + 1;
      // 잉크 픽셀이거나 바로 옆이 잉크인 자리만 본다. 서로 다른 요소가 맞닿는 자리는 바탕으로 둔다.
      let label = 0;
      if (labels[at]) label = labels[at];
      else {
        for (let o = 1; o < 9; o++) {
          const l = labels[at + around[o]];
          if (!l) continue;
          if (label && l !== label) {
            label = 0;
            break;
          }
          label = l;
        }
      }
      if (!label || !own[label]) continue;
      const v = ra[i] * w[0] + rb[i] * w[1] + rc[i] * w[2] + rd[i] * w[3];
      if (v >= low && v >= peak[by * pw + bx] * 0.5) {
        const f = (j + 1) * FW + i + 1;
        mask[f] = 1;
        owner[f] = label;
      }
    }
  }
  // 부스러기를 지우고 작은 구멍(반사광, 잡음)을 메운다.
  {
    const { labels: parts, areas } = labelComponents(mask, FW, FH, true);
    const minimum = 2 * FINE * FINE;
    for (let i = 0; i < mask.length; i++) if (mask[i] && areas[parts[i]] < minimum) mask[i] = 0;
    // 구멍은 작으므로(최대 FINE x FINE 픽셀) 잉크 옆 바탕에서 조금만 번져 보고, 크면 바로 멈춘다.
    const state = new Uint8Array(mask.length); // 1 = 큰 바탕으로 확인한 픽셀
    const steps = [1, -1, FW, -FW];
    const found: number[] = [];
    for (let i = FW; i < mask.length - FW; i++) {
      if (mask[i] || state[i] || !(mask[i - 1] || mask[i - FW])) continue;
      found.length = 0;
      found.push(i);
      state[i] = 2;
      let small = true;
      for (let head = 0; head < found.length && small; head++) {
        for (const o of steps) {
          const q = found[head] + o;
          if (mask[q] || state[q] === 2) continue;
          if (state[q] === 1 || found.length >= FINE * FINE) {
            small = false;
            break;
          }
          state[q] = 2;
          found.push(q);
        }
      }
      for (const q of found) {
        state[q] = small ? 2 : 1;
        if (small) {
          mask[q] = 1;
          owner[q] = owner[q] || owner[q - 1] || owner[q + 1] || owner[q - FW] || owner[q + FW];
        }
      }
    }
  }
  const dist2 = inkDistance2(mask, FW, FH);
  const sk = mask.slice();
  thin(sk, FW);
  const toBase = (x: number, y: number): Pt => [x0 + x / FINE, y0 + y / FINE];
  const pieces: Piece[] = [];
  for (const c of traceSkeleton(sk, FW, dist2)) {
    const radii = new Float32Array(c.px.length);
    let label = 0;
    const path = c.px.map((p, k): Pt => {
      radii[k] = Math.sqrt(dist2[p]) / FINE;
      label = label || owner[p];
      return toBase((p % FW) - 0.5, Math.floor(p / FW) - 0.5);
    });
    pieces.push({ pts: c.pts.map(([x, y]) => toBase(x, y)), path, closed: c.closed, step: 1 / FINE, radii, label });
  }
  return pieces;
}

/**
 * 얇은 글씨로 보이는 연결 요소를 고른다. 굵기는 넓이를 둘레 픽셀 수로 나눠 어림하고,
 * 요소가 굵기에 견주어 작을수록(글자가 촘촘할수록) 더 굵은 것까지 고른다.
 */
function thinComponents(
  labels: Int32Array,
  count: number,
  areas: Int32Array,
  W: number,
  H: number,
): { own: Uint8Array; box: Int32Array; any: boolean } {
  const own = new Uint8Array(count + 1);
  const box = new Int32Array((count + 1) * 4);
  for (let l = 0; l <= count; l++) box.set([W, H, 0, 0], l * 4);
  const rim = new Int32Array(count + 1);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const l = labels[i];
      if (!l) continue;
      const b = l * 4;
      if (x < box[b]) box[b] = x;
      if (y < box[b + 1]) box[b + 1] = y;
      if (x > box[b + 2]) box[b + 2] = x;
      if (y > box[b + 3]) box[b + 3] = y;
      if (!labels[i - 1] || !labels[i + 1] || !labels[i - W] || !labels[i + W]) rim[l]++;
    }
  }
  let any = false;
  for (let l = 1; l <= count; l++) {
    const w = (2 * areas[l]) / Math.max(1, rim[l]);
    const b = l * 4;
    const small = Math.min(box[b + 2] - box[b], box[b + 3] - box[b + 1]) + 1;
    if (w <= 3.6 || (w <= 6 && small <= 12 * w)) {
      own[l] = 1;
      any = true;
    }
  }
  return { own, box, any };
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

/**
 * 획 굵기: 골격에 수직인 방향으로 대비가 중심값의 절반이 되는 두 지점 사이 거리(처리 px)를 재고 중앙값을 낸다.
 * 축소하면서 가장자리가 부드러워져도 반값 폭은 거의 그대로라, 얇은 획도 굵은 획도 이진 마스크보다 정확하다.
 */
function strokeWidth(path: Pt[], step: number, raw: Float32Array, pw: number, ph: number, radius: number): number | null {
  const sample = (x: number, y: number): number => {
    const ix = Math.floor(x - 0.5);
    const iy = Math.floor(y - 0.5);
    if (ix < 0 || iy < 0 || ix >= pw - 1 || iy >= ph - 1) return 0;
    const tx = x - 0.5 - ix;
    const ty = y - 0.5 - iy;
    const k = iy * pw + ix;
    return (raw[k] * (1 - tx) + raw[k + 1] * tx) * (1 - ty) + (raw[k + pw] * (1 - tx) + raw[k + pw + 1] * tx) * ty;
  };
  const n = path.length;
  const limit = Math.max(4, radius * 2 + 3);
  const span = Math.round(Math.max(2, Math.min(5, Math.round(radius))) / step);
  const widths: number[] = [];
  const stride = Math.max(1, Math.floor(n / 16));
  for (let k = span; k < n - span; k += stride) {
    const [x, y] = path[k];
    const a = path[k - span];
    const b = path[k + span];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1) continue;
    const nx = -dy / l;
    const ny = dx / l;
    // 골격이 반 픽셀쯤 어긋나도 되도록 중심 둘레의 최댓값을 봉우리로 삼는다.
    let top = 0;
    let shift = 0;
    for (let o = -1; o <= 1; o += 0.5) {
      const v = sample(x + nx * o, y + ny * o);
      if (v > top) {
        top = v;
        shift = o;
      }
    }
    const half = top * 0.5;
    let total = 0;
    for (const dir of [-1, 1]) {
      let prev = top;
      let t = 0;
      let found = -1;
      for (; t <= limit; t += 0.25) {
        const v = sample(x + nx * (shift + dir * t), y + ny * (shift + dir * t));
        if (v < half) {
          found = t - 0.25 + (0.25 * (prev - half)) / Math.max(1e-6, prev - v);
          break;
        }
        prev = v;
      }
      if (found < 0) {
        total = -1;
        break;
      }
      total += Math.max(0, found);
    }
    // 교차점이나 붙은 획에서는 반값 지점이 없거나 비정상적으로 멀다.
    if (total > 0 && total < radius * 3 + 4) widths.push(total);
  }
  if (widths.length < 2) return null;
  widths.sort((p, q) => p - q);
  // 흐림 폭이 f인 화면에서 폭 w인 선의 반값 폭 F는 F^4 ≈ w^4 + f^4로 어림된다. 얇은 선만 줄어든다.
  const full = widths[widths.length >> 1];
  // 확대 조각의 중심선은 픽셀 중심에서 벗어나 있어 보간으로 봉우리가 조금 더 낮게 읽히므로 흐림을 크게 잡는다.
  const blur = step < 1 ? 1.85 : 1.58;
  return Math.max(0.8, Math.pow(Math.max(0, full ** 4 - blur ** 4), 0.25));
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
function classifyInkColor(tr: number, tg: number, tb: number): { color: InkColor; purity: number } {
  const absorb = (t: number): number => -Math.log(Math.min(1, Math.max(0.02, t)));
  const ar = absorb(tr);
  const ag = absorb(tg);
  const ab = absorb(tb);
  const max = Math.max(ar, ag, ab);
  const chroma = max - Math.min(ar, ag, ab);
  const purity = max > 0 ? chroma / max : 0;
  if (chroma < 0.06 || purity < 0.38) return { color: "black", purity };
  let hue: number;
  if (max === ar) hue = 60 * (((ag - ab) / chroma + 6) % 6);
  else if (max === ag) hue = 60 * ((ab - ar) / chroma + 2);
  else hue = 60 * ((ar - ag) / chroma + 4);
  // 흡수한 색의 보색이 눈에 보이는 색이다.
  const visible = (hue + 180) % 360;
  let color: InkColor = "black";
  if (visible >= 300 || visible < 40) color = "red";
  else if (visible >= 75 && visible < 170) color = "green";
  else if (visible >= 170 && visible < 285) color = "blue";
  return { color, purity };
}

/** 획 단면을 따라 모은 채널별 어두워진 양. [빨강, 초록, 파랑, 밝기] */
type InkSum = [number, number, number, number];

/**
 * 휴대폰 사진은 색차를 절반 해상도로 저장하므로 2~3px 선의 색은 둘레로 번져 중심 픽셀이 검게 보인다.
 * 단면 전체의 어두워진 양은 번져도 채널별로 보존되므로, 그 비율을 밝기 깊이(번지지 않음)에 곱해 펜의 투과율을 되살린다.
 */
function inkColorOf(sum: InkSum, depth: number): { color: InkColor; purity: number } {
  if (sum[3] <= 1e-6) return { color: "black", purity: 0 };
  const t = (c: number): number => 1 - (sum[c] / sum[3]) * depth;
  return classifyInkColor(t(0), t(1), t(2));
}

type Measured = InkStroke & {
  length: number;
  order: number;
  /** 골격 위 대비의 중앙값. */
  contrast: number;
  /** 연결 요소에 이 획 하나뿐인지. */
  alone: boolean;
  /** 연결 요소 번호. */
  label: number;
};

/**
 * 뭉친 자리에서 나온 짧은 획은 단면이 이웃 획까지 이어져 굵기가 부풀고, 그리면 글자 속공간을 메운다.
 * 짧은 획의 굵기는 가까운 획들의 굵기(길이로 가중한 중앙값)의 1.3배를 넘지 않게 한다. 홀로 떨어진 점은 그대로 둔다.
 */
function capShortWidths(strokes: Measured[], reach: number): void {
  const cells = new Map<number, Measured[]>();
  const center = (c: Measured): Pt => c.points[c.points.length >> 1];
  const keyOf = (x: number, y: number): number => Math.floor(y / reach) * 100003 + Math.floor(x / reach);
  for (const c of strokes) {
    const [x, y] = center(c);
    const list = cells.get(keyOf(x, y));
    if (list) list.push(c);
    else cells.set(keyOf(x, y), [c]);
  }
  const caps = strokes.map((c) => {
    if (c.alone || c.length >= 4 * c.width) return Infinity;
    const [x, y] = center(c);
    const near: Measured[] = [];
    let total = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const o of cells.get(keyOf(x + dx * reach, y + dy * reach)) ?? []) {
          if (o === c || o.length < 3 * o.width) continue;
          near.push(o);
          total += o.length;
        }
      }
    }
    if (near.length < 3) return Infinity;
    near.sort((p, q) => p.width - q.width);
    let acc = 0;
    for (const o of near) {
      acc += o.length;
      if (acc >= total / 2) return 1.3 * o.width;
    }
    return Infinity;
  });
  strokes.forEach((c, i) => {
    if (c.width > caps[i]) c.width = caps[i];
  });
}

/** 대표 대비: 길이로 가중한 중앙값. */
function referenceContrast(strokes: Measured[]): number {
  const order = [...strokes].sort((a, b) => a.contrast - b.contrast);
  const total = order.reduce((sum, c) => sum + c.length + c.width, 0);
  let acc = 0;
  for (const c of order) {
    acc += c.length + c.width;
    if (acc >= total / 2) return c.contrast;
  }
  return 0;
}

/**
 * 보드 밖의 벽이나 가구를 버린다. 배경 격자에서 밝기와 색이 급하게 바뀌는 곳을 경계로 보드를 나누고,
 * 글씨가 가장 많은 구역과 다른 구역 가운데 사진 변에 닿고, 보드보다 어둡고 색이 뚜렷이 다르며, 글씨가 거의 없는 곳의
 * 획을 버린다. 그림자처럼 색이 거의 같거나 글씨가 적지 않은 구역은 남긴다. 글씨의 양은 글자 크기의 짧은 획으로 센다.
 * 벽 틈이나 보드 테두리 같은 긴 선은 벽 쪽 구역을 글씨 구역처럼 보이게 하기 때문이다.
 */
function dropOffBoard(strokes: Measured[], bg: Background, scaleX: number, scaleY: number, letter: number): Measured[] {
  const { gw, gh, block } = bg;
  const { l, r, g, b } = bg.block3;
  const n = gw * gh;
  const ratioRB = (i: number): number => r[i] / Math.max(1, b[i]);
  const ratioRG = (i: number): number => r[i] / Math.max(1, g[i]);
  const region = new Int32Array(n).fill(-1);
  let count = 0;
  const queue: number[] = [];
  for (let start = 0; start < n; start++) {
    if (region[start] >= 0) continue;
    const id = count++;
    region[start] = id;
    queue.length = 0;
    queue.push(start);
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head];
      const x = i % gw;
      const y = (i / gw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        const j = yy * gw + xx;
        if (region[j] >= 0) continue;
        if (Math.abs(l[i] - l[j]) > 0.07 * Math.max(l[i], l[j], 8)) continue;
        if (Math.abs(ratioRB(i) - ratioRB(j)) > 0.06 || Math.abs(ratioRG(i) - ratioRG(j)) > 0.05) continue;
        region[j] = id;
        queue.push(j);
      }
    }
  }
  const where = (c: Measured): number => {
    // 획 점들이 가장 많이 놓인 구역
    const votes = new Map<number, number>();
    let best = -1;
    let most = 0;
    for (const [x, y] of c.points) {
      const gx = Math.max(0, Math.min(gw - 1, Math.floor((x * scaleX) / block)));
      const gy = Math.max(0, Math.min(gh - 1, Math.floor((y * scaleY) / block)));
      const id = region[gy * gw + gx];
      const v = (votes.get(id) ?? 0) + 1;
      votes.set(id, v);
      if (v > most) {
        most = v;
        best = id;
      }
    }
    return most * 2 >= c.points.length ? best : -1;
  };
  const regionOfStroke = strokes.map(where);
  const inkIn = new Float64Array(count);
  let total = 0;
  strokes.forEach((c, i) => {
    if (c.length > letter) return;
    const amount = c.length + c.width;
    total += amount;
    if (regionOfStroke[i] >= 0) inkIn[regionOfStroke[i]] += amount;
  });
  if (total === 0) return strokes;
  let main = 0;
  for (let id = 1; id < count; id++) if (inkIn[id] > inkIn[main]) main = id;
  const size = new Int32Array(count);
  const sumL = new Float64Array(count);
  const sumRB = new Float64Array(count);
  const touches = new Uint8Array(count);
  for (let i = 0; i < n; i++) {
    const id = region[i];
    size[id]++;
    sumL[id] += l[i];
    sumRB[id] += ratioRB(i);
    const x = i % gw;
    const y = (i / gw) | 0;
    if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) touches[id] = 1;
  }
  const mainL = sumL[main] / size[main];
  const mainRB = sumRB[main] / size[main];
  const off = new Uint8Array(count);
  let any = false;
  for (let id = 0; id < count; id++) {
    if (id === main || size[id] < 3 || !touches[id]) continue;
    if (sumL[id] / size[id] > 0.85 * mainL || Math.abs(sumRB[id] / size[id] - mainRB) < 0.15) continue;
    if (inkIn[id] > 0.08 * total) continue;
    off[id] = 1;
    any = true;
  }
  if (!any) return strokes;
  return strokes.filter((_, i) => regionOfStroke[i] < 0 || !off[regionOfStroke[i]]);
}

/**
 * 보드에 놓인 물건(펜, 천 통)의 윤곽과 무늬를 버린다. 글씨는 양옆이 같은 바탕으로 돌아오지만 물건의 어두운 띠는
 * 한쪽이 바탕으로 돌아오지 않는다. 글씨보다 뚜렷이 굵으면서 대표 대비보다 옅고 양옆이 돌아오지 않는 획이 요소의
 * 큰 몫을 차지할 때만, 그 요소와 바로 곁의 굵고 옅은 획을 버린다.
 */
function dropObjects(strokes: Measured[], medianWidth: number, raw: Float32Array, pw: number, ph: number, scale: number): Measured[] {
  const reference = referenceContrast(strokes);
  const sample = (x: number, y: number): number => {
    const ix = Math.floor(x - 0.5);
    const iy = Math.floor(y - 0.5);
    if (ix < 0 || iy < 0 || ix >= pw - 1 || iy >= ph - 1) return 0;
    const tx = x - 0.5 - ix;
    const ty = y - 0.5 - iy;
    const k = iy * pw + ix;
    return (raw[k] * (1 - tx) + raw[k + 1] * tx) * (1 - ty) + (raw[k + pw] * (1 - tx) + raw[k + pw + 1] * tx) * ty;
  };
  const suspicious = (c: Measured): boolean => c.width >= 1.8 * medianWidth && c.contrast < 0.75 * reference;
  const sideRatio = (c: Measured): number => {
    const half = (c.width * scale) / 2;
    const ratios: number[] = [];
    for (let i = 1; i < c.points.length; i++) {
      const ax = c.points[i - 1][0] * scale;
      const ay = c.points[i - 1][1] * scale;
      const bx = c.points[i][0] * scale;
      const by = c.points[i][1] * scale;
      const l = Math.hypot(bx - ax, by - ay);
      if (l < 1) continue;
      const nx = -(by - ay) / l;
      const ny = (bx - ax) / l;
      for (let t = 1; t < l; t += 2) {
        const x = ax + ((bx - ax) * t) / l;
        const y = ay + ((by - ay) * t) / l;
        const center = Math.max(sample(x, y), sample(x + nx, y + ny), sample(x - nx, y - ny));
        let left = 1;
        let right = 1;
        for (let o = half + 1; o <= half + 5; o += 0.5) {
          left = Math.min(left, sample(x + nx * o, y + ny * o));
          right = Math.min(right, sample(x - nx * o, y - ny * o));
        }
        ratios.push(Math.max(left, right) / Math.max(0.02, center));
      }
    }
    if (ratios.length === 0) return 0;
    ratios.sort((a, b) => a - b);
    return ratios[ratios.length >> 1];
  };
  const totals = new Map<number, { all: number; core: number; x0: number; y0: number; x1: number; y1: number }>();
  for (const c of strokes) {
    const t = totals.get(c.label) ?? { all: 0, core: 0, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const isCore =
      c.width >= 2.2 * medianWidth && c.length >= 6 * medianWidth && suspicious(c) && sideRatio(c) >= 0.45;
    t.all += c.length;
    if (isCore) {
      t.core += c.length;
      for (const [x, y] of c.points) {
        t.x0 = Math.min(t.x0, x);
        t.y0 = Math.min(t.y0, y);
        t.x1 = Math.max(t.x1, x);
        t.y1 = Math.max(t.y1, y);
      }
    }
    totals.set(c.label, t);
  }
  const objects = [...totals.entries()].filter(([, t]) => t.core > 0 && t.core >= 0.3 * t.all);
  if (objects.length === 0) return strokes;
  const gone = new Set(objects.map(([label]) => label));
  const reach = 15 / scale;
  return strokes.filter((c) => {
    if (gone.has(c.label)) return false;
    if (!suspicious(c)) return true;
    return !objects.some(([, t]) =>
      c.points.some(([x, y]) => x >= t.x0 - reach && x <= t.x1 + reach && y >= t.y0 - reach && y <= t.y1 + reach),
    );
  });
}

/**
 * 지운 잔상, 종이 가장자리 그림자, 잡음 점을 버린다. 반사광 아래의 글씨나 마른 마커는 대비가 낮아도 글씨이므로
 * 대비만으로는 버리지 않는다.
 * - 바탕보다 13%도 어둡지 않은 획은 지운 잔상으로 본다.
 * - 대표 대비(길이로 가중한 중앙값)의 35%보다 옅으면서 글씨보다 1.5배 이상 굵고 짧은 변의 10%보다 긴 선은
 *   종이나 그림자의 가장자리로 본다.
 * - 홀로 떨어져 있고 글씨 굵기의 절반보다 가늘며 길이도 굵기의 1.5배 안인 점은, 대표 대비의 절반보다 옅으면 잡음으로 본다.
 *   마침표와 소수점은 글씨 굵기와 비슷하거나 진해서 남는다. 굵기와 상관없이 대표 대비의 35%보다 옅은 외딴 점(잔상 위의 얼룩)도 버린다.
 */
function dropFaint(strokes: Measured[], width: number, height: number, medianWidth: number): Measured[] {
  const reference = referenceContrast(strokes);
  const long = 0.1 * Math.min(width, height);
  return strokes.filter((c) => {
    if (c.contrast < 0.13) return false;
    if (c.contrast < 0.35 * reference && c.width >= 1.5 * medianWidth && c.length >= long) return false;
    if (c.alone && c.length < 1.5 * medianWidth && c.contrast < 0.35 * reference) return false;
    return !(c.alone && c.width < 0.5 * medianWidth && c.length < 1.5 * medianWidth && c.contrast < 0.5 * reference);
  });
}

/**
 * 보드가 사진 안쪽에 찍히면 얇은 테두리가 펜 획처럼 남는다. 글씨보다 뚜렷이 굵은 긴 선들이 나머지 획을
 * 거의 모두 감싸고 사진의 35% 이상을 두르면 보드 테두리로 보고, 테두리와 그 바깥(벽)의 획을 버린다.
 * 조건을 하나라도 만족하지 못하면 아무것도 버리지 않는다.
 */
function dropBoardFrame(strokes: Measured[], width: number, height: number, medianWidth: number): Measured[] {
  const bars = strokes.filter((c) => c.width >= 1.5 * medianWidth && c.length >= 0.3 * Math.min(width, height));
  if (bars.length === 0) return strokes;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of bars) {
    for (const [x, y] of c.points) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw * bh < 0.35 * width * height) return strokes;
  // 테두리 선은 경계 상자의 변을 따라가야 하고(원근 기울기 여유 10%), 둘레의 절반 이상을 덮어야 한다.
  // 안쪽에 그린 굵은 동그라미 같은 선은 이 조건에서 빠진다.
  let cover = 0;
  const frame = new Set<Measured>();
  for (const c of bars) {
    let along = 0;
    let total = 0;
    for (let i = 1; i < c.points.length; i++) {
      const [ax, ay] = c.points[i - 1];
      const [bx, by] = c.points[i];
      const l = Math.hypot(bx - ax, by - ay);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      total += l;
      if (Math.min((mx - x0) / bw, (x1 - mx) / bw, (my - y0) / bh, (y1 - my) / bh) <= 0.1) along += l;
    }
    if (along >= 0.9 * total) {
      frame.add(c);
      cover += total;
    }
  }
  if (cover < bw + bh) return strokes;
  const inside = (c: Measured): boolean => c.points.every(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  let inLength = 0;
  let outLength = 0;
  for (const c of strokes) {
    if (frame.has(c)) continue;
    if (inside(c)) inLength += c.length;
    else outLength += c.length;
  }
  if (inLength === 0 || outLength > 0.1 * (inLength + outLength)) return strokes;
  return strokes.filter((c) => !frame.has(c) && inside(c));
}

/**
 * 사진 네 변을 따라가는 긴 선은 글씨가 아니라 보드 테두리나 사진 가장자리 그림자다.
 * 길이의 80% 이상이 변에서 4% 안에 있고 짧은 변의 20%보다 길면 테두리로 본다.
 * 단, 글씨와 굵기가 같고 변에서 1.5%보다 떨어져 있으면 글씨로 둔다. 변에 완전히 붙은 짧은 조각도 버린다.
 */
function isFrameStroke(c: Measured, width: number, height: number, medianWidth: number): boolean {
  const band = 0.04 * Math.min(width, height);
  let inside = 0;
  let total = 0;
  let edgeSum = 0;
  // 사진 변에 완전히 붙어 있는 조각은 잘린 테두리나 벽의 부스러기다.
  const rim = 0.015 * Math.min(width, height);
  if (c.points.every(([x, y]) => Math.min(x, y, width - x, height - y) <= rim)) return true;
  const wide = 0.03 * Math.min(width, height);
  if (
    c.width >= 1.8 * medianWidth &&
    c.points.every(([x, y]) => Math.min(x, y, width - x, height - y) <= wide)
  ) {
    return true;
  }
  for (let i = 1; i < c.points.length; i++) {
    const [ax, ay] = c.points[i - 1];
    const [bx, by] = c.points[i];
    const l = Math.hypot(bx - ax, by - ay);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const edge = Math.min(mx, my, width - mx, height - my);
    total += l;
    edgeSum += edge * l;
    if (edge <= band) inside += l;
  }
  if (total < 0.2 * Math.min(width, height) || inside < 0.8 * total) return false;
  return edgeSum / total <= 0.015 * Math.min(width, height) || c.width >= 1.4 * medianWidth;
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
  const maxWidthP = (positive(options.maxStrokeWidth) ?? Math.max(18, Math.max(pw, ph) * 0.014) / s) * s;
  const minLenFixed = positive(options.minStrokeLength) !== undefined;
  const minLenP = (positive(options.minStrokeLength) ?? 4 / s) * s;
  const tolP = (positive(options.simplifyTolerance) ?? 0.6 / s) * s;
  const maxStrokes = Math.floor(positive(options.maxStrokes) ?? DEFAULTS.maxStrokes);
  const maxPoints = Math.floor(positive(options.maxPoints) ?? DEFAULTS.maxPoints);
  const inkContrast = Math.min(0.9, positive(options.inkContrast) ?? DEFAULTS.inkContrast);

  const img = downsample(image.data, width, height, pw, ph);
  const bg = estimateBackground(img);
  const maps = inkContrastMap(img, bg);
  const d = maps.smooth;
  const rawNoise = contrastNoise(maps.raw);
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
  // 잡음이 적으면 흐리지 않은 값으로 경계를 잡아 얇은 획이 부풀지 않게 하고, 잡음이 많으면 흐린 값을 쓴다.
  const edgeRaw = Math.max(0, Math.min(1, (0.04 - rawNoise.sigma) / 0.025));
  const peak = localMax(d, pw, ph, Math.max(2, Math.round(Math.max(pw, ph) * 0.003)));
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const v = d[y * pw + x];
      if (v >= low && v + (maps.raw[y * pw + x] - v) * edgeRaw >= peak[y * pw + x] * 0.5) {
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
  let dist2 = inkDistance2(mask, W, H);
  // 반값 경계 마스크는 굵은 덩어리 가장자리를 깎으므로, 뚜렷하게 어두운 픽셀(대비 0.3 이상)도 함께 본다.
  const bold = new Uint8Array(N);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) if (d[y * pw + x] >= 0.3) bold[(y + 1) * W + x + 1] = 1;
  }
  const boldDist2 = inkDistance2(bold, W, H);
  const R = maxWidthP / 2 + 0.5;
  const thick = new Uint8Array(N);
  let anyThick = false;
  for (let i = 0; i < N; i++) {
    if (dist2[i] > R * R || boldDist2[i] > R * R) {
      thick[i] = 1;
      anyThick = true;
    }
  }
  if (anyThick) {
    const toThick = sqDistanceTo(thick, W, H);
    const reach = 1.25 * R + 1.5;
    for (let i = 0; i < N; i++) if (toThick[i] <= reach * reach) mask[i] = 0;
    // 깎은 자리에 맞닿은 작거나 옅은 조각은 덩어리 모서리나 그늘의 부스러기다.
    const { labels, count, areas } = labelComponents(mask, W, H, true);
    const limit = (reach + 2) * (reach + 2);
    const touching = new Uint8Array(count + 1);
    const depth = new Float64Array(count + 1);
    for (let i = 0; i < N; i++) {
      if (!labels[i]) continue;
      if (toThick[i] <= limit) touching[labels[i]] = 1;
      depth[labels[i]] += d[(Math.floor(i / W) - 1) * pw + (i % W) - 1];
    }
    const next = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const l = labels[i];
      if (l && (touching[l] ? areas[l] >= 2 * R * R && depth[l] >= 0.25 * areas[l] : areas[l] >= minArea)) next[i] = 1;
    }
    mask = next;
    dist2 = inkDistance2(mask, W, H);
  }
  const comp = labelComponents(mask, W, H, true);
  if (comp.count === 0) return emptyResult(width, height, s);

  // 5~6. 골격과 획. 얇은 글씨는 확대해서 다시 처리하고, 나머지는 처리 해상도에서 그대로 골격을 낸다.
  const fine = thinComponents(comp.labels, comp.count, comp.areas, W, H);
  const pieces: Piece[] = [];
  {
    const sk = mask.slice();
    if (fine.any) for (let i = 0; i < N; i++) if (sk[i] && fine.own[comp.labels[i]]) sk[i] = 0;
    thin(sk, W);
    for (const c of traceSkeleton(sk, W, dist2)) {
      const radii = new Float32Array(c.px.length);
      const path = c.px.map((p, k): Pt => {
        radii[k] = Math.sqrt(dist2[p]);
        return [(p % W) - 0.5, Math.floor(p / W) - 0.5];
      });
      pieces.push({ pts: c.pts, path, closed: c.closed, step: 1, radii, label: comp.labels[c.px[0]] });
    }
  }
  if (fine.any) {
    const edge = new Float32Array(pw * ph);
    for (let i = 0; i < edge.length; i++) edge[i] = d[i] + (maps.raw[i] - d[i]) * edgeRaw * FINE_SHARP;
    const input: FineInput = { pw, ph, edge, peak, low, labels: comp.labels, W };
    // 메모리를 아끼려고 요소를 중심 위치에 따라 구역으로 묶어 처리한다.
    const cell = 256;
    const groups = new Map<number, number[]>();
    for (let l = 1; l <= comp.count; l++) {
      if (!fine.own[l]) continue;
      const cx = Math.floor((fine.box[l * 4] + fine.box[l * 4 + 2]) / 2 / cell);
      const cy = Math.floor((fine.box[l * 4 + 1] + fine.box[l * 4 + 3]) / 2 / cell);
      const key = cy * 4096 + cx;
      const list = groups.get(key);
      if (list) list.push(l);
      else groups.set(key, [l]);
    }
    const own = new Uint8Array(comp.count + 1);
    for (const list of groups.values()) {
      let x0 = pw;
      let y0 = ph;
      let x1 = 0;
      let y1 = 0;
      for (const l of list) {
        own[l] = 1;
        // 라벨 격자는 1px 패딩되어 있고, 둘레 1px을 더 본다.
        x0 = Math.min(x0, Math.max(0, fine.box[l * 4] - 2));
        y0 = Math.min(y0, Math.max(0, fine.box[l * 4 + 1] - 2));
        x1 = Math.max(x1, Math.min(pw, fine.box[l * 4 + 2] + 1));
        y1 = Math.max(y1, Math.min(ph, fine.box[l * 4 + 3] + 1));
      }
      for (const piece of traceFine(input, own, x0, y0, x1, y1)) pieces.push(piece);
      for (const l of list) own[l] = 0;
    }
  }

  // 8. 굵기와 색 통계
  const chainsPerComp = new Int32Array(comp.count + 1);
  const members: number[][] = Array.from({ length: comp.count + 1 }, () => []);
  const stats = pieces.map((c, ci) => {
    const sum: InkSum = [0, 0, 0, 0];
    const depths = new Float32Array(c.path.length);
    let order = Infinity;
    let peakDepth = 0;
    const radii = c.radii.slice().sort();
    const radius = radii[radii.length >> 1];
    c.path.forEach(([cx, cy], k) => {
      const x = Math.max(0, Math.min(pw - 1, Math.floor(cx)));
      const y = Math.max(0, Math.min(ph - 1, Math.floor(cy)));
      depths[k] = d[y * pw + x];
      if (y * pw + x < order) order = y * pw + x;
    });
    // 색은 획을 따라 고르게 뽑은 자리의 단면에서 모은다.
    const reach = Math.ceil(radius + 1.5);
    const span = Math.max(1, Math.round(2 / c.step));
    const stride = Math.max(1, Math.round(1 / c.step), Math.floor(c.path.length / 32));
    let picked = 0;
    for (let k = stride >> 1; k < c.path.length; k += stride) {
      const [px, py] = c.path[k];
      const [ax, ay] = c.path[Math.max(0, k - span)];
      const [bx, by] = c.path[Math.min(c.path.length - 1, k + span)];
      const l = Math.hypot(bx - ax, by - ay);
      const nx = l > 0 ? -(by - ay) / l : 1;
      const ny = l > 0 ? (bx - ax) / l : 0;
      const br = Math.max(8, sampleGrid(bg.r, bg, px - 0.5, py - 0.5));
      const bgG = Math.max(8, sampleGrid(bg.g, bg, px - 0.5, py - 0.5));
      const bb = Math.max(8, sampleGrid(bg.b, bg, px - 0.5, py - 0.5));
      let deepest = 0;
      for (let o = -reach; o <= reach; o++) {
        const x = Math.floor(px + nx * o);
        const y = Math.floor(py + ny * o);
        if (x < 0 || y < 0 || x >= pw || y >= ph) continue;
        const at = (y * pw + x) * 3;
        const r = 1 - img.rgb[at] / br;
        const g = 1 - img.rgb[at + 1] / bgG;
        const b = 1 - img.rgb[at + 2] / bb;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        sum[0] += r;
        sum[1] += g;
        sum[2] += b;
        sum[3] += lum;
        if (Math.abs(o) <= 1 && lum > deepest) deepest = lum;
      }
      peakDepth += deepest;
      picked++;
    }
    chainsPerComp[c.label]++;
    members[c.label].push(ci);
    depths.sort();
    return {
      sum,
      depth: picked ? peakDepth / picked : 0,
      label: c.label,
      order,
      contrast: depths[depths.length >> 1],
      radius,
      n: c.path.length * c.step,
    };
  });
  // 얇은 선은 흐림 때문에 밝기 깊이도 옅어진다. 같은 사진의 진한 획 깊이를 하한의 기준으로 쓴다.
  const deep = stats.map((st) => st.depth).sort((p, q) => p - q);
  const deepInk = deep.length ? 0.75 * deep[Math.floor(deep.length * 0.9)] : 0;
  const colorOf = (ci: number): InkColor => {
    const st = stats[ci];
    const own = inkColorOf(st.sum, Math.min(0.95, Math.max(st.depth, deepInk)));
    if (st.n >= 14) return own.color;
    // 짧은 획은 표본이 적다. 색이 뚜렷하거나 뚜렷한 검정이면 그대로 두고, 애매하면 같은 요소의 가까운 획과 함께 판정한다.
    if (own.purity >= 0.5 || own.purity < 0.15) return own.color;
    const [x, y] = pieces[ci].path[pieces[ci].path.length >> 1];
    const sum: InkSum = [0, 0, 0, 0];
    let depth = 0;
    let weight = 0;
    for (const o of members[st.label]) {
      const [ox, oy] = pieces[o].path[pieces[o].path.length >> 1];
      if (o !== ci && Math.hypot(ox - x, oy - y) > 24) continue;
      for (let k = 0; k < 4; k++) sum[k] += stats[o].sum[k];
      depth += stats[o].depth * stats[o].n;
      weight += stats[o].n;
    }
    return inkColorOf(sum, Math.min(0.95, Math.max(depth / Math.max(1e-6, weight), deepInk))).color;
  };

  const candidates: Measured[] = [];
  const ix = 1 / sx;
  const iy = 1 / sy;
  const round2 = (v: number): number => Math.round(v * 100) / 100;
  pieces.forEach((c, ci) => {
    const st = stats[ci];
    const closed = c.closed && c.pts.length >= 4;
    const pts = options.smooth === false ? c.pts : smoothPoints(c.pts, closed, 2);
    let simple = closed ? simplifyRing(pts, tolP) : simplify(pts, tolP);
    const length = polylineLength(simple);
    // 다른 획에 붙은 짧은 가지는 잔가지 판정을 통과했으면 획 반폭 정도 길이만 돼도 남긴다('ㅏ', 'ㅓ'의 가지).
    const minLen = minLenFixed ? minLenP : Math.min(minLenP, Math.max(1.5, st.radius));
    if (length < minLen && chainsPerComp[st.label] > 1) return;
    if (simple.length === 1) simple = [simple[0], simple[0]];
    candidates.push({
      points: simple.map(([x, y]): InkPoint => [round2(x * ix), round2(y * iy)]),
      color: colorOf(ci),
      width: round2(Math.max(1, strokeWidth(c.path, c.step, maps.raw, pw, ph, st.radius) ?? 2 * st.radius - 0.5 * c.step) / s),
      closed,
      length: length / s,
      contrast: st.contrast,
      alone: chainsPerComp[st.label] <= 1,
      label: st.label,
      order: st.order,
    });
  });

  capShortWidths(candidates, 40 / s);

  // 글씨가 아닌 획 제외
  {
    const sizes = candidates.map((c) => c.width).sort((a, b) => a - b);
    const medianWidth = sizes.length ? sizes[sizes.length >> 1] : 1;
    const ink = dropFaint(candidates, width, height, medianWidth);
    const board = dropObjects(dropOffBoard(ink, bg, sx, sy, 0.15 * Math.min(width, height)), medianWidth, maps.raw, pw, ph, s);
    const inner = board.filter((c) => !isFrameStroke(c, width, height, medianWidth));
    const kept = dropBoardFrame(inner, width, height, medianWidth);
    candidates.length = 0;
    candidates.push(...kept);
  }

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

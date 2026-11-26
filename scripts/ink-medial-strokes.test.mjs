// lib/ink-medial-strokes.ts: 글씨 윤곽을 가운데 선 + 점마다 지름 획으로 바꾸고, 반지름이 선형으로 바뀌는 캡슐들로
// 다시 그린 모양을 원래 윤곽과 비교한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MEDIAL_DEFAULTS, medialStrokesFromShape, medialStrokesFromShapes } from '../lib/ink-medial-strokes.ts';

const U = 11 / 6; // 페이지 단위 / pt
const PX = 4; // 합성 글자: 1pt = 4px
const FIT = { scale: U / PX, offsetX: 0, offsetY: 0 };
const MIN = 0.35 * U, MAX = 6 * U;

// ---------------------------------------------------------------------------
// 합성 글자 윤곽

const ellipse = (cx, cy, rx, ry, n, rev = false) => {
  const out = Array.from({ length: n }, (_, i) => { const a = (2 * Math.PI * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
  return rev ? out.reverse() : out;
};
const rect = (x, y, w, h, rev = false) => { const r = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; return rev ? r.reverse() : r; };

/** 중심선과 굵기로 둥근 끝 윤곽을 만든다. */
function strokeOutline(center, widths) {
  const n = center.length, L = [], R = [];
  for (let i = 0; i < n; i += 1) {
    const a = center[Math.max(0, i - 1)], b = center[Math.min(n - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / l, ny = (b[0] - a[0]) / l, h = widths[i] / 2;
    L.push([center[i][0] + nx * h, center[i][1] + ny * h]);
    R.push([center[i][0] - nx * h, center[i][1] - ny * h]);
  }
  const cap = (c, from, h, m = 10) => {
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    return Array.from({ length: m - 1 }, (_, k) => { const a = a0 - (Math.PI * (k + 1)) / m; return [c[0] + h * Math.cos(a), c[1] + h * Math.sin(a)]; });
  };
  return [...L, ...cap(center[n - 1], L[n - 1], widths[n - 1] / 2), ...R.reverse(), ...cap(center[0], R[R.length - 1], widths[0] / 2)];
}

/** 글자 높이 h(px) 기준 합성 덩어리들. */
function glyphs(h) {
  const w = 0.085 * h, o = 10, P = ([x, y]) => [o + x, o + y], shapes = [];
  const add = (name, rings, holes = 0) => shapes.push({ name, holes, color: 'black', rings: rings.map(r => r.map(P)), strokeWidth: w });
  add('ㅇ', [ellipse(0.4 * h, 0.4 * h, 0.36 * h, 0.38 * h, 72), ellipse(0.4 * h, 0.4 * h, 0.36 * h - w, 0.38 * h - w, 72, true)], 1);
  add('ㅁ', [rect(1.0 * h, 0.05 * h, 0.7 * h, 0.7 * h), rect(1.0 * h + w, 0.05 * h + w, 0.7 * h - 2 * w, 0.7 * h - 2 * w, true)], 1);
  add('ㄴ', [[[2.0 * h, 0.05 * h], [2.0 * h + w, 0.05 * h], [2.0 * h + w, 0.7 * h - w], [2.7 * h, 0.7 * h - w], [2.7 * h, 0.7 * h], [2.0 * h, 0.7 * h]]]);
  {
    const x = 3.0 * h, y = 0.05 * h, s = 0.38 * h, t = 0.7 * h;
    // 겹받침 ㄺ: ㄹ과 ㄱ이 붙은 한 덩어리
    add('ㄺ', [[
      [x, y], [x + 2 * s, y], [x + 2 * s, y + t], [x + 2 * s - w, y + t], [x + 2 * s - w, y + w], [x + s, y + w], [x + s, y + t / 2], [x + w, y + t / 2],
      [x + w, y + t - w], [x + s, y + t - w], [x + s, y + t], [x, y + t], [x, y + t / 2 - w], [x + s - w, y + t / 2 - w], [x + s - w, y + w], [x, y + w],
    ]]);
  }
  add('작은점', [ellipse(4.1 * h, 0.4 * h, 0.4, 0.4, 12)]);
  add('점', [ellipse(4.3 * h, 0.4 * h, 0.6 * w, 0.6 * w, 24)]);
  {
    const n = 200, len = 4.4 * h, c = Array.from({ length: n }, (_, i) => [0.1 * h + (len * i) / (n - 1), 1.0 * h + 0.03 * h * Math.sin(i / 9)]);
    add('긴가로획', [strokeOutline(c, c.map((_, i) => w * (1 + 0.15 * Math.sin(i / 5))))]);
  }
  {
    const n = 60, c = Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return [4.8 * h - 0.4 * h * t * t, 0.05 * h + 0.7 * h * t]; });
    add('삐침', [strokeOutline(c, c.map((_, i) => w * (1.25 - 0.6 * (i / (n - 1)))))]);
  }
  {
    const n = 80, c = Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return [5.0 * h + 0.9 * h * t, 1.3 * h + 0.15 * h * Math.sin(3 * t)]; });
    add('굵기변화', [strokeOutline(c, c.map((_, i) => w * (0.5 + 1.5 * Math.sin((Math.PI * i) / (n - 1)))))]);
  }
  {
    const x = 5.1 * h, y = 0.05 * h;
    add('ㅗ', [[[x + 0.35 * h, y], [x + 0.35 * h + w, y], [x + 0.35 * h + w, y + 0.6 * h], [x + 0.8 * h, y + 0.6 * h], [x + 0.8 * h, y + 0.6 * h + w], [x, y + 0.6 * h + w], [x, y + 0.6 * h], [x + 0.35 * h, y + 0.6 * h]]]);
  }
  return shapes;
}

// ---------------------------------------------------------------------------
// 다시 그리기와 비교(사진 px × k 격자)

function rasterRings(rings, x0, y0, k, W, H) {
  const mask = new Uint8Array(W * H), rows = Array.from({ length: H }, () => []);
  for (const r of rings) for (let i = 0; i < r.length; i += 1) {
    const a = r[i], b = r[(i + 1) % r.length], ay = (a[1] - y0) * k, by = (b[1] - y0) * k, ax = (a[0] - x0) * k, bx = (b[0] - x0) * k;
    if (ay === by) continue;
    for (let j = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5)); j <= Math.min(H - 1, Math.ceil(Math.max(ay, by) - 0.5) - 1); j += 1) rows[j].push(ax + ((j + 0.5 - ay) * (bx - ax)) / (by - ay));
  }
  rows.forEach((xs, j) => {
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.ceil(xs[q] - 0.5)); i <= Math.min(W - 1, Math.ceil(xs[q + 1] - 0.5) - 1); i += 1) mask[j * W + i] ^= 1;
  });
  return mask;
}

/** 반지름이 선형으로 바뀌는 캡슐(선분 위 원들을 촘촘히). */
function drawStroke(mask, W, H, pts, rads) {
  const disc = (cx, cy, r) => {
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(H - 1, Math.ceil(cy + r + 1)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(W - 1, Math.ceil(cx + r + 1)); x += 1) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) mask[y * W + x] = 1;
    }
  };
  if (pts.length === 1) return disc(pts[0][0], pts[0][1], rads[0]);
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.3));
    for (let s = 0; s <= n; s += 1) { const t = s / n; disc(x0 + t * (x1 - x0), y0 + t * (y1 - y0), rads[i - 1] + t * (rads[i] - rads[i - 1])); }
  }
}

function holes(m, W, H) {
  const seen = new Uint8Array(W * H);
  let n = 0;
  for (let s = 0; s < W * H; s += 1) {
    if (seen[s] || m[s]) continue;
    const st = [s];
    seen[s] = 1;
    let edge = false;
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) edge = true;
      for (const [q, ok] of [[p - 1, x > 0], [p + 1, x < W - 1], [p - W, y > 0], [p + W, y < H - 1]]) if (ok && !seen[q] && !m[q]) { seen[q] = 1; st.push(q); }
    }
    if (!edge) n += 1;
  }
  return n;
}

function compare(shape, strokes, fit, k = 3) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of shape.rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = 3 * shape.strokeWidth + 3;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const W = Math.ceil((x1 - x0) * k), H = Math.ceil((y1 - y0) * k);
  const truth = rasterRings(shape.rings, x0, y0, k, W, H), got = new Uint8Array(W * H);
  for (const s of strokes) {
    drawStroke(got, W, H, s.points.map(([x, y]) => [((x - fit.offsetX) / fit.scale - x0) * k, ((y - fit.offsetY) / fit.scale - y0) * k]), s.widths.map(w => (w / 2 / fit.scale) * k));
  }
  let I = 0, Un = 0;
  for (let p = 0; p < W * H; p += 1) { I += truth[p] & got[p]; Un += truth[p] | got[p]; }
  return { iou: Un ? I / Un : 1, holesTruth: holes(truth, W, H), holesGot: holes(got, W, H) };
}

const run = pt => {
  const shapes = glyphs(pt * PX);
  const strokes = medialStrokesFromShapes(shapes, { fit: FIT, minWidth: MIN, maxWidth: MAX });
  return { shapes, strokes, mine: i => strokes.filter(s => s.shape === i) };
};

// ---------------------------------------------------------------------------

for (const pt of [24, 12, 7]) {
  test(`${pt}pt 합성 글자: 다시 그린 모양이 원래 윤곽과 겹치고 구멍을 지킨다`, () => {
    const { shapes, mine } = run(pt);
    const ious = [];
    shapes.forEach((shape, i) => {
      const c = compare(shape, mine(i), FIT);
      assert.equal(c.holesGot, c.holesTruth, `${shape.name} 구멍 ${c.holesGot} / ${c.holesTruth}`);
      if (shape.name !== '작은점') {
        assert.ok(c.iou >= 0.82, `${shape.name} IoU ${c.iou.toFixed(3)}`);
        ious.push(c.iou);
      }
    });
    const mean = ious.reduce((a, b) => a + b, 0) / ious.length;
    assert.ok(mean >= 0.88, `평균 IoU ${mean.toFixed(3)}`);
  });
}

test('덩어리당 획 수: 고리는 닫힌 획 하나, 곧은 획은 하나, 갈림길은 몇 개', () => {
  const { shapes, mine } = run(24);
  const count = name => mine(shapes.findIndex(s => s.name === name));
  for (const name of ['ㅇ', 'ㅁ']) {
    const s = count(name);
    assert.equal(s.length, 1, `${name} 획 수 ${s.length}`);
    assert.equal(s[0].closed, true, `${name} 닫힘`);
    assert.deepEqual(s[0].points[0], s[0].points[s[0].points.length - 1]);
  }
  for (const name of ['ㄴ', '긴가로획', '삐침', '굵기변화']) {
    const s = count(name);
    assert.equal(s.length, 1, `${name} 획 수 ${s.length}`);
    assert.equal(s[0].closed, false);
  }
  assert.ok(count('ㅗ').length <= 2, `ㅗ 획 수 ${count('ㅗ').length}`);
  assert.ok(count('ㄺ').length <= 3, `ㄺ 획 수 ${count('ㄺ').length}`);
});

test('점: 작은 덩어리는 점 하나짜리 획으로 남고 사라지는 덩어리가 없다', () => {
  const { shapes, strokes, mine } = run(7);
  for (const name of ['작은점', '점']) {
    const s = mine(shapes.findIndex(x => x.name === name));
    assert.equal(s.length, 1, name);
    assert.equal(s[0].points.length, 1, name);
    assert.ok(s[0].widths[0] >= MIN, name);
  }
  assert.equal(new Set(strokes.map(s => s.shape)).size, shapes.length);
});

test('굵기: 점마다 지름이 있고 하한과 상한 안이며, 굵기가 변하는 획에서 지름이 따라 변한다', () => {
  const { shapes, strokes, mine } = run(24);
  for (const s of strokes) {
    assert.equal(s.points.length, s.widths.length);
    for (const w of s.widths) assert.ok(Number.isFinite(w) && w >= MIN - 1e-9 && w <= MAX + 1e-9, `지름 ${w}`);
    for (const p of s.points) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
  }
  const [vary] = mine(shapes.findIndex(x => x.name === '굵기변화'));
  const inner = vary.widths.slice(1, -1);
  assert.ok(Math.max(...inner) / Math.min(...inner) > 2, `굵기 비 ${(Math.max(...inner) / Math.min(...inner)).toFixed(2)}`);
  // 상한, 하한이 걸리면 그 값으로 자른다
  const tight = medialStrokesFromShapes(shapes, { fit: FIT, minWidth: 2, maxWidth: 3 });
  for (const s of tight) for (const w of s.widths) assert.ok(w >= 2 - 1e-9 && w <= 3 + 1e-9);
});

test('곧은 획의 지름은 각도와 상관없이 실제 굵기에 가깝다', () => {
  for (const w of [3, 8]) {
    for (const deg of [0, 20, 45, 70]) {
      const a = (deg * Math.PI) / 180, L = 60, ux = Math.cos(a), uy = Math.sin(a), nx = (-uy * w) / 2, ny = (ux * w) / 2;
      const c0 = [100, 100], c1 = [100 + L * ux, 100 + L * uy];
      const ring = [[c0[0] + nx, c0[1] + ny], [c1[0] + nx, c1[1] + ny], [c1[0] - nx, c1[1] - ny], [c0[0] - nx, c0[1] - ny]];
      const strokes = medialStrokesFromShape({ color: 'black', rings: [ring], strokeWidth: w }, { coordinateStep: 0 });
      assert.equal(strokes.length, 1, `${w}px ${deg}도 획 수`);
      // 획을 따라 1/4, 1/2, 3/4 지점의 지름(점 사이는 선형). 끝은 둥근 끝이라 보지 않는다.
      const { points, widths } = strokes[0];
      const along = ([x, y]) => (x - c0[0]) * ux + (y - c0[1]) * uy;
      for (const t of [L / 4, L / 2, (3 * L) / 4]) {
        let d = NaN;
        for (let i = 1; i < points.length; i += 1) {
          const ta = along(points[i - 1]), tb = along(points[i]);
          if ((t - ta) * (t - tb) <= 0 && ta !== tb) { d = widths[i - 1] + ((t - ta) / (tb - ta)) * (widths[i] - widths[i - 1]); break; }
        }
        assert.ok(Math.abs(d / w - 1) < 0.06, `${w}px ${deg}도 ${t}px 지름 ${d.toFixed(2)}`);
      }
    }
  }
});

test('좌표 변환: fit을 주면 점은 옮기고 늘리며 지름은 배율만큼 커진다', () => {
  const shape = glyphs(48)[0];
  const raw = medialStrokesFromShape(shape, { coordinateStep: 0 });
  const fit = { scale: 0.5, offsetX: 30, offsetY: -7 };
  const moved = medialStrokesFromShape(shape, { fit, coordinateStep: 0 });
  assert.equal(moved.length, raw.length);
  moved.forEach((s, i) => {
    assert.equal(s.points.length, raw[i].points.length);
    s.points.forEach((p, j) => {
      assert.ok(Math.abs(p[0] - (30 + 0.5 * raw[i].points[j][0])) < 1e-9);
      assert.ok(Math.abs(p[1] - (-7 + 0.5 * raw[i].points[j][1])) < 1e-9);
      assert.ok(Math.abs(s.widths[j] - 0.5 * raw[i].widths[j]) < 1e-9);
    });
  });
  // 기본 좌표 간격으로 반올림한다
  const step = MEDIAL_DEFAULTS.coordinateStep;
  for (const s of medialStrokesFromShape(shape, { fit })) for (const [x, y] of s.points) {
    assert.ok(Math.abs(x / step - Math.round(x / step)) < 1e-9 && Math.abs(y / step - Math.round(y / step)) < 1e-9);
  }
});

test('빈 입력과 깨진 값', () => {
  assert.deepEqual(medialStrokesFromShapes([]), []);
  assert.deepEqual(medialStrokesFromShapes([{ color: 'black', rings: [] }]), []);
  assert.deepEqual(medialStrokesFromShapes([{ color: 'black', rings: [[[NaN, 1], [2, Infinity]]] }]), []);
  // 넓이가 없는 고리(점 하나, 선분)는 점 획 하나
  const one = medialStrokesFromShapes([{ color: 'red', rings: [[[5, 5]]] }, { color: 'blue', rings: [[[0, 0], [10, 0]]] }]);
  assert.equal(one.length, 2);
  assert.deepEqual(one.map(s => [s.color, s.shape, s.points.length]), [['red', 0, 1], ['blue', 1, 1]]);
  for (const s of one) assert.ok(s.widths[0] > 0);
});

test('점 수 상한을 넘는 획은 1점 겹쳐 나눈다', () => {
  const shape = glyphs(96).find(s => s.name === '긴가로획');
  const all = medialStrokesFromShape(shape, { coordinateStep: 0 });
  const total = all[0].points.length;
  assert.ok(total > 10);
  const parts = medialStrokesFromShape(shape, { coordinateStep: 0, maxPointsPerStroke: 8 });
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.points.length <= 8 && p.points.length === p.widths.length);
  for (let i = 1; i < parts.length; i += 1) assert.deepEqual(parts[i][`points`][0], parts[i - 1].points[parts[i - 1].points.length - 1]);
  assert.equal(parts.reduce((a, p) => a + p.points.length, 0) - (parts.length - 1), total);
});

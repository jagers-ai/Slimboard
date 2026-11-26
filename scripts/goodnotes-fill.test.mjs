// lib/goodnotes-fill.ts: 글씨 윤곽을 굿노트 볼펜 획으로 채우고, 굿노트 파일로 썼다가 되읽어 다시 그린 모양을 원래 윤곽과 비교한다.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appleLz4Decode, buildGoodnotesDocument, decodeTpl, decodeUniformPen, getField, listTemplatePages, pageObjects, readZip,
  renderPenSubpath, zipEntryData,
} from '../lib/goodnotes-file.ts';
import { FILL_DEFAULTS, fillShapeWithPen, fillShapesWithPen } from '../lib/goodnotes-fill.ts';

const U = 11 / 6; // 페이지 단위 / pt
const PX = 4; // 합성 글자: 1pt = 4px
const PAGE = { width: 1091, height: 1543 };

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

/** 글자 높이 h(px)의 합성 덩어리들. holes는 구멍 수. */
function glyphShapes(h, ox = 40, oy = 40) {
  const w = 0.085 * h, P = ([x, y]) => [ox + x, oy + y], shapes = [];
  const add = (name, rings, holes = 0) => shapes.push({ name, holes, color: 'black', rings: rings.map(r => r.map(P)), strokeWidth: w });
  add('ㅇ', [ellipse(0.4 * h, 0.4 * h, 0.36 * h, 0.38 * h, 72), ellipse(0.4 * h, 0.4 * h, 0.36 * h - w, 0.38 * h - w, 72, true)], 1);
  add('ㅁ', [rect(1.0 * h, 0.05 * h, 0.7 * h, 0.7 * h), rect(1.0 * h + w, 0.05 * h + w, 0.7 * h - 2 * w, 0.7 * h - 2 * w, true)], 1);
  add('받침ㄴ', [[[2.0 * h, 0.05 * h], [2.0 * h + w, 0.05 * h], [2.0 * h + w, 0.7 * h - w], [2.7 * h, 0.7 * h - w], [2.7 * h, 0.7 * h], [2.0 * h, 0.7 * h]]]);
  {
    // 겹받침 ㄺ: ㄹ과 ㄱ
    const x = 3.0 * h, y = 0.05 * h, s = 0.38 * h, t = 0.7 * h, gx = x + s + 0.06 * h;
    add('겹받침ㄹ', [[
      [x, y], [x + s, y], [x + s, y + t / 2], [x + w, y + t / 2], [x + w, y + t - w], [x + s, y + t - w], [x + s, y + t], [x, y + t], [x, y + t / 2 - w],
      [x + s - w, y + t / 2 - w], [x + s - w, y + w], [x, y + w],
    ]]);
    add('겹받침ㄱ', [[[gx, y], [gx + s, y], [gx + s, y + t], [gx + s - w, y + t], [gx + s - w, y + w], [gx, y + w]]]);
  }
  add('아주작은점', [ellipse(4.1 * h, 0.4 * h, 0.4, 0.4, 12)]);
  add('점', [ellipse(4.3 * h, 0.4 * h, 0.6 * w, 0.6 * w, 24)]);
  {
    // 긴 가로획: 물결 모양, 굵기 ±15%
    const n = 200, len = 4.4 * h, c = Array.from({ length: n }, (_, i) => [0.1 * h + (len * i) / (n - 1), 1.0 * h + 0.03 * h * Math.sin(i / 9)]);
    add('긴가로획', [strokeOutline(c, c.map((_, i) => w * (1 + 0.15 * Math.sin(i / 5))))]);
  }
  {
    // 끝으로 갈수록 가늘어지는 삐침
    const n = 60, c = Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return [4.8 * h - 0.4 * h * t * t, 0.05 * h + 0.7 * h * t]; });
    add('삐침', [strokeOutline(c, c.map((_, i) => w * (1.25 - 0.6 * (i / (n - 1)))))]);
  }
  {
    const x = 5.1 * h, y = 0.05 * h;
    add('ㅗ', [[[x + 0.35 * h, y], [x + 0.35 * h + w, y], [x + 0.35 * h + w, y + 0.6 * h], [x + 0.8 * h, y + 0.6 * h], [x + 0.8 * h, y + 0.6 * h + w], [x, y + 0.6 * h + w], [x, y + 0.6 * h], [x + 0.35 * h, y + 0.6 * h]]]);
  }
  return shapes;
}

// ---------------------------------------------------------------------------
// 격자 그리기와 비교

/** 짝수-홀수 규칙(칸 중심). 좌표 → 칸: (x - x0) * k */
function rasterRings(rings, x0, y0, k, W, H) {
  const mask = new Uint8Array(W * H), rows = Array.from({ length: H }, () => []);
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 1) {
      const a = r[i], b = r[(i + 1) % r.length], ay = (a[1] - y0) * k, by = (b[1] - y0) * k, ax = (a[0] - x0) * k, bx = (b[0] - x0) * k;
      if (ay === by) continue;
      for (let j = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5)); j <= Math.min(H - 1, Math.ceil(Math.max(ay, by) - 0.5) - 1); j += 1) rows[j].push(ax + ((j + 0.5 - ay) * (bx - ax)) / (by - ay));
    }
  }
  rows.forEach((xs, j) => {
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) for (let i = Math.max(0, Math.ceil(xs[q] - 0.5)); i <= Math.min(W - 1, Math.ceil(xs[q + 1] - 0.5) - 1); i += 1) mask[j * W + i] ^= 1;
  });
  return mask;
}

/** 둥근 펜(반지름 r칸)으로 폴리라인을 칠한다. */
function fillCapsules(mask, W, H, pts, r) {
  const seg = (x0, y0, x1, y1) => {
    const xa = Math.max(0, Math.floor(Math.min(x0, x1) - r - 1)), xb = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + r + 1));
    const ya = Math.max(0, Math.floor(Math.min(y0, y1) - r - 1)), yb = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + r + 1));
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    for (let y = ya; y <= yb; y += 1) for (let x = xa; x <= xb; x += 1) {
      const px = x + 0.5 - x0, py = y + 0.5 - y0, t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
      if ((px - t * dx) ** 2 + (py - t * dy) ** 2 <= r * r) mask[y * W + x] = 1;
    }
  };
  if (pts.length === 1) seg(pts[0][0], pts[0][1], pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 1) seg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
}

/** 바깥과 이어지지 않은 빈 칸 덩어리 수(4방향). */
function countHoles(m, W, H) {
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

/** 굿노트 파일로 쓰고 되읽는다: 획마다 { width, pts(페이지 단위) } */
async function roundTrip(strokes) {
  const bytes = await buildGoodnotesDocument({
    title: 'fill', idSeed: 'fill-test', createdAt: new Date(0),
    pages: [{ width: PAGE.width, height: PAGE.height, strokes: strokes.map(s => ({ points: s.points, width: s.width, color: [0, 0, 0] })) }],
  });
  const data = new Map();
  for (const e of readZip(bytes)) data.set(e.name, await zipEntryData(e));
  const [page] = listTemplatePages({ notesIndex: data.get('index.notes.pb'), events: data.get('index.events.pb'), names: [...data.keys()] });
  const back = pageObjects(data.get(`notes/${page.noteId}`)).map(o => {
    const pen = decodeUniformPen(decodeTpl(appleLz4Decode(getField(o.body, 2).data).data));
    return { width: pen.width, pts: pen.subpaths.flatMap(s => renderPenSubpath(s, 1)) };
  });
  return { bytes, back };
}

/** 원래 윤곽과 되읽은 획을 같은 격자에 그려 IoU와 구멍 수를 잰다. drawnPerStored: 저장값 1이 그려지는 지름. */
function compare(shape, back, fit, drawnPerStored = 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of shape.rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const pad = 3 * shape.strokeWidth + 2, k = 12 / shape.strokeWidth;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const W = Math.ceil((x1 - x0) * k), H = Math.ceil((y1 - y0) * k), truth = rasterRings(shape.rings, x0, y0, k, W, H), got = new Uint8Array(W * H);
  for (const s of back) {
    const pts = s.pts.map(([x, y]) => [((x - fit.offsetX) / fit.scale - x0) * k, ((y - fit.offsetY) / fit.scale - y0) * k]);
    fillCapsules(got, W, H, pts, ((s.width * drawnPerStored) / 2 / fit.scale) * k);
  }
  let i = 0, u = 0;
  for (let p = 0; p < W * H; p += 1) { i += truth[p] & got[p]; u += truth[p] | got[p]; }
  return { iou: u ? i / u : 1, holesTruth: countHoles(truth, W, H), holesGot: countHoles(got, W, H) };
}

async function measure(pt, drawnPerStored = 1) {
  const shapes = glyphShapes(pt * PX), fit = { scale: U / PX, offsetX: 10, offsetY: 10 };
  const strokes = fillShapesWithPen(shapes, { fit, minPenWidth: 0, maxPenWidth: 6 * U });
  const { back } = await roundTrip(strokes);
  assert.equal(back.length, strokes.length);
  const per = shapes.map((shape, index) => {
    const mine = back.filter((_, j) => strokes[j].shape === index);
    return { name: shape.name, strokes: mine.length, holes: shape.holes, ...compare(shape, mine, fit, drawnPerStored) };
  });
  // 0.4px 점은 격자에 거의 잡히지 않아 평균에서 뺀다(획이 남는지만 본다).
  const scored = per.filter(p => p.name !== '아주작은점');
  return { per, mean: scored.reduce((a, p) => a + p.iou, 0) / scored.length, min: Math.min(...scored.map(p => p.iou)) };
}

// ---------------------------------------------------------------------------

// 목표(평균 IoU): 24pt 0.95, 12pt 0.93, 7pt 0.90. 2026-11-26 측정값: 0.970, 0.967, 0.975(가장 낮은 글자 0.939~0.952).
for (const [pt, target] of [[24, 0.95], [12, 0.93], [7, 0.9]]) {
  test(`${pt}pt 합성 글자: 되읽어 그린 모양이 원래 윤곽과 맞고 구멍이 남는다`, async () => {
    const { per, mean, min } = await measure(pt);
    const detail = per.map(p => `${p.name} ${p.iou.toFixed(3)} 구멍 ${p.holesTruth}->${p.holesGot}`).join(', ');
    assert.ok(mean >= target, `평균 IoU ${mean.toFixed(4)} < ${target}: ${detail}`);
    assert.ok(min >= 0.9, `가장 낮은 IoU ${min.toFixed(4)}: ${detail}`);
    for (const p of per) {
      assert.ok(p.strokes >= 1, `${p.name}: 획이 없다`);
      assert.equal(p.holesTruth, p.holes, `${p.name}: 원래 구멍 수`);
      assert.equal(p.holesGot, p.holesTruth, `${p.name}: 구멍 ${p.holesTruth}->${p.holesGot}`);
    }
    // 이어진 덩어리 하나 = 볼펜 획 하나
    for (const p of per) assert.equal(p.strokes, 1, `${p.name}: 획 ${p.strokes}개`);
  });
}

test('굵기가 약 8% 가늘게 그려져도 고리 사이에 흰 줄(새 구멍)이 생기지 않는다', async () => {
  const { per, mean } = await measure(12, 11 / 12);
  for (const p of per) assert.equal(p.holesGot, p.holesTruth, `${p.name}: 구멍 ${p.holesTruth}->${p.holesGot}`);
  assert.ok(mean >= 0.9, `평균 IoU ${mean.toFixed(4)}`);
});

test('굵기가 들쭉날쭉한 고리(가는 목)도 끊기지 않아 구멍이 남는다', async () => {
  // 가는 곳은 펜보다 가늘어 등고선이 끊기고 골격 경로가 이어 줘야 한다. 고리 둘레의 항목을 트리로 이으면
  // 한 곳은 다리가 빠지므로 항목끼리 겹쳐 덮여야 구멍이 바깥과 이어지지 않는다.
  const ring = (w, amp, lobes, phase, n = 180) => {
    const out = [], inn = [];
    for (let i = 0; i < n; i += 1) {
      const a = (2 * Math.PI * i) / n, ww = w * (1 + amp * Math.sin(lobes * a + phase));
      out.push([80 + (30 + ww / 2) * Math.cos(a), 80 + (30 + ww / 2) * Math.sin(a)]);
      inn.push([80 + (30 - ww / 2) * Math.cos(a), 80 + (30 - ww / 2) * Math.sin(a)]);
    }
    return [out, inn.reverse()];
  };
  const fit = { scale: U / PX, offsetX: 10, offsetY: 10 }, bad = [];
  for (const amp of [0.2, 0.4]) for (const lobes of [1, 2, 5]) for (const phase of [0, 1.9]) for (const w of [3, 4.5]) {
    const shape = { color: 'black', rings: ring(w, amp, lobes, phase), strokeWidth: w };
    const strokes = fillShapesWithPen([shape], { fit });
    assert.equal(strokes.length, 1);
    const { back } = await roundTrip(strokes);
    const c = compare(shape, back, fit);
    // 굵기가 ±40% 바뀌면 고른 펜 하나로는 모양이 덜 맞는다(2026-11-26 측정 최저 0.846). 여기서는 구멍이 주목적이다.
    if (c.holesGot !== 1 || c.iou < 0.84) bad.push(`굵기 ${w} 변화 ${amp} 마디 ${lobes} 위상 ${phase}: 구멍 ${c.holesGot}, IoU ${c.iou.toFixed(3)}`);
  }
  assert.deepEqual(bad, []);
});

test('빈 입력과 잘못된 점', () => {
  assert.deepEqual(fillShapesWithPen([]), []);
  assert.deepEqual(fillShapesWithPen([{ color: 'black', rings: [] }]), []);
  assert.deepEqual(fillShapesWithPen([{ color: 'black', rings: [[]] }]), []);
  assert.deepEqual(fillShapesWithPen([{ color: 'black', rings: [[[NaN, 1], [Infinity, 2]]] }]), []);
  // 넓이가 없는 덩어리(점 하나, 선분 하나)도 점 획 하나는 남긴다
  for (const rings of [[[[5, 5]]], [[[5, 5], [5, 5], [5, 5]]], [[[0, 0], [10, 0]]], [[[0, 0], [10, 0], [20, 0]]]]) {
    const out = fillShapesWithPen([{ color: 'red', rings }], { minPenWidth: 1 });
    assert.equal(out.length, 1, JSON.stringify(rings));
    assert.equal(out[0].color, 'red');
    assert.ok(out[0].points.length >= 1);
    assert.ok(out[0].width >= 1);
    assert.ok(out[0].points.flat().every(Number.isFinite));
  }
  // 잘못된 점은 건너뛰고 나머지로 채운다
  const sq = rect(0, 0, 20, 20).flatMap((p, i) => (i === 2 ? [[NaN, NaN], p] : [p]));
  const out = fillShapesWithPen([{ color: 'blue', rings: [sq], strokeWidth: 20 }]);
  assert.equal(out.length, 1);
  assert.ok(out[0].points.flat().every(Number.isFinite));
});

test('아주 작은 점과 짧은 덩어리도 획이 사라지지 않는다', () => {
  const shapes = [0.05, 0.2, 0.5, 1, 2].map((r, i) => ({ color: 'black', rings: [ellipse(10 + 10 * i, 10, r, r, 8)], strokeWidth: 2 * r }));
  const out = fillShapesWithPen(shapes, { minPenWidth: 0.5 });
  assert.deepEqual([...new Set(out.map(s => s.shape))].sort(), [0, 1, 2, 3, 4]);
  for (const s of out) assert.ok(s.width >= 0.5 && s.points.length >= 1);
});

test('점 수 상한을 넘으면 한 점씩 겹쳐 나눈다', () => {
  const shape = glyphShapes(96).find(s => s.name === '긴가로획');
  const [whole] = fillShapeWithPen(shape, { coordinateStep: 0 });
  assert.ok(whole.points.length > 40, `점 ${whole.points.length}개`);
  const parts = fillShapeWithPen(shape, { coordinateStep: 0, maxPointsPerStroke: 20 });
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(p.points.length <= 20 && p.points.length >= 2);
  for (let i = 1; i < parts.length; i += 1) assert.deepEqual(parts[i].points[0], parts[i - 1].points.at(-1));
  assert.deepEqual(parts.flatMap((p, i) => (i ? p.points.slice(1) : p.points)), whole.points);
  assert.equal(FILL_DEFAULTS.maxPointsPerStroke, 2000);
  for (const s of fillShapesWithPen(glyphShapes(400))) assert.ok(s.points.length <= 2000);
});

test('좌표 변환: 점과 굵기가 같은 배율로 바뀐다', () => {
  const shapes = glyphShapes(48);
  const fit = { scale: 0.37, offsetX: 12.5, offsetY: 30 };
  const plain = fillShapesWithPen(shapes, { coordinateStep: 0 });
  const moved = fillShapesWithPen(shapes, { coordinateStep: 0, fit });
  assert.equal(moved.length, plain.length);
  plain.forEach((s, i) => {
    const m = moved[i];
    assert.equal(m.shape, s.shape);
    assert.ok(Math.abs(m.width - s.width * fit.scale) < 1e-6 * s.width);
    assert.equal(m.points.length, s.points.length);
    s.points.forEach(([x, y], j) => {
      assert.ok(Math.abs(m.points[j][0] - (fit.offsetX + x * fit.scale)) < 1e-6);
      assert.ok(Math.abs(m.points[j][1] - (fit.offsetY + y * fit.scale)) < 1e-6);
    });
  });
  // 기본 좌표 반올림(1/32)
  for (const s of fillShapesWithPen(shapes, { fit })) for (const [x, y] of s.points) { assert.equal(x * 32, Math.round(x * 32)); assert.equal(y * 32, Math.round(y * 32)); }
});

test('굵기: 하한과 상한, 그려지는 굵기 보정', () => {
  const shapes = glyphShapes(48);
  const free = fillShapesWithPen(shapes, { coordinateStep: 0 });
  const widths = free.map(s => s.width);
  const lo = Math.min(...widths), hi = Math.max(...widths);
  assert.ok(lo > 0 && hi > lo);
  const mid = (lo + hi) / 2;
  for (const s of fillShapesWithPen(shapes, { minPenWidth: mid })) assert.ok(s.width >= mid - 1e-9);
  for (const s of fillShapesWithPen(shapes, { maxPenWidth: mid })) assert.ok(s.width <= mid + 1e-9);
  for (const s of fillShapesWithPen(shapes, { minPenWidth: 3, maxPenWidth: 3 })) assert.equal(s.width, 3);
  // 저장값 1이 11/12로 그려진다고 두면 같은 굵기가 그려지도록 저장값을 12/11배 한다
  const thin = fillShapesWithPen(shapes, { coordinateStep: 0, penDrawnPerStored: 11 / 12 });
  thin.forEach((s, i) => assert.ok(Math.abs(s.width - free[i].width * (12 / 11)) < 1e-9));
  // 굵기는 덩어리의 대표 굵기를 따라간다(획 굵기의 대략 0.6~1.1배)
  free.forEach(s => {
    const w = shapes[s.shape].strokeWidth;
    if (shapes[s.shape].name.includes('점')) return;
    assert.ok(s.width > 0.6 * w && s.width < 1.1 * w, `${shapes[s.shape].name}: 펜 ${s.width.toFixed(2)}, 획 ${w.toFixed(2)}`);
  });
});

test('색과 덩어리 번호를 그대로 넘기고, 떨어진 조각은 따로 획을 낸다', () => {
  const two = { color: 'green', rings: [rect(0, 0, 10, 4), rect(30, 0, 10, 4)], strokeWidth: 4 };
  const out = fillShapesWithPen([{ color: 'red', rings: [rect(0, 20, 10, 4)], strokeWidth: 4 }, two]);
  assert.deepEqual(out.map(s => [s.color, s.shape]), [['red', 0], ['green', 1], ['green', 1]]);
  // 두 조각 사이(배경)를 지나는 선이 없다
  for (const s of out.filter(o => o.shape === 1)) {
    const xs = s.points.map(p => p[0]);
    assert.ok(Math.max(...xs) < 15 || Math.min(...xs) > 25);
  }
});

test('1000 덩어리를 A4 한 쪽에 넣어도 파일이 2MB 이하다', async () => {
  const shapes = [];
  for (let row = 0; row < 25; row += 1) for (let col = 0; col < 4; col += 1) for (const s of glyphShapes(40, 30 + col * 250, 30 + row * 80)) shapes.push(s);
  assert.equal(shapes.length, 1000);
  const fit = { scale: 1000 / 1500, offsetX: 20, offsetY: 20 };
  const strokes = fillShapesWithPen(shapes, { fit, minPenWidth: 0.35 * U, maxPenWidth: 6 * U });
  assert.ok(new Set(strokes.map(s => s.shape)).size === 1000);
  const { bytes } = await roundTrip(strokes);
  assert.ok(bytes.length <= 2 * 1024 * 1024, `${bytes.length} bytes`);
});

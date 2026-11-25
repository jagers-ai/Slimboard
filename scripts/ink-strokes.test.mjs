import assert from 'node:assert/strict';
import test from 'node:test';
import { extractInkStrokes } from '../lib/ink-strokes.ts';

// 합성 화이트보드 사진을 그린다. 조명 기울기와 잡음을 넣고, 획은 마커처럼 배경 위에 곱해서 칠한다.
const MARKER = {
  black: [0.16, 0.16, 0.18],
  blue: [0.16, 0.3, 0.78],
  red: [0.88, 0.17, 0.2],
  green: [0.16, 0.58, 0.32],
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Board {
  constructor(width, height, { light = 'left', noise = 3, seed = 1 } = {}) {
    this.width = width;
    this.height = height;
    this.noise = noise;
    this.seed = seed;
    this.rgb = new Float64Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / width;
        const v = y / height;
        const shade = light === 'left' ? 1 - 0.45 * (1 - u) - 0.05 * v : light === 'corner' ? 1 - 0.4 * u * v - 0.1 * v : 1;
        const i = (y * width + x) * 3;
        this.rgb[i] = 238 * shade;
        this.rgb[i + 1] = 239 * shade;
        this.rgb[i + 2] = 236 * shade;
      }
    }
  }

  // (x, y)까지의 거리를 주는 함수로 잉크를 칠한다. 색 이름이나 투과율 배열을 받는다.
  ink(distance, half, color) {
    const t = Array.isArray(color) ? color : MARKER[color];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const a = Math.min(1, Math.max(0, half + 0.5 - distance(x + 0.5, y + 0.5)));
        if (a <= 0) continue;
        const i = (y * this.width + x) * 3;
        for (let c = 0; c < 3; c++) this.rgb[i + c] *= 1 - a * (1 - t[c]);
      }
    }
    return this;
  }

  line(x0, y0, x1, y1, width, color = 'black') {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    return this.ink((x, y) => {
      const t = l2 ? Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
      return Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
    }, width / 2, color);
  }

  ring(cx, cy, r, width, color = 'black') {
    return this.ink((x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r), width / 2, color);
  }

  disc(cx, cy, r, color) {
    return this.ink((x, y) => Math.hypot(x - cx, y - cy), r, color);
  }

  image() {
    const rand = rng(this.seed);
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    const gauss = () => {
      const u = Math.max(1e-9, rand());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
    };
    for (let i = 0; i < this.width * this.height; i++) {
      const shared = gauss() * this.noise;
      for (let c = 0; c < 3; c++) data[i * 4 + c] = this.rgb[i * 3 + c] + shared + gauss() * this.noise * 0.5;
      data[i * 4 + 3] = 255;
    }
    return { width: this.width, height: this.height, data };
  }
}

const length = (points) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
const total = (strokes) => strokes.reduce((sum, s) => sum + length(s.points), 0);
// 점 (x, y)에서 획까지의 가장 가까운 거리
function distance(strokes, x, y) {
  let best = Infinity;
  for (const s of strokes) {
    for (let i = 1; i < s.points.length; i++) {
      const [ax, ay] = s.points[i - 1];
      const [bx, by] = s.points[i];
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = l2 ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)));
    }
  }
  return best;
}

test('빈 보드는 조명이 기울고 잡음이 있어도 획이 없다', () => {
  for (const light of ['left', 'corner', 'flat']) {
    const result = extractInkStrokes(new Board(1200, 900, { light, noise: 5, seed: 7 }).image());
    assert.deepEqual(result.strokes, [], light);
    assert.equal(result.truncated, false);
    assert.equal(result.width, 1200);
    assert.equal(result.height, 900);
  }
});

test('직선의 위치와 끝점을 1.5px 안으로 찾는다', () => {
  const result = extractInkStrokes(new Board(1200, 900, { noise: 3 })
    .line(200, 200, 900, 200, 6).line(200, 400, 900, 600, 6).line(300, 700, 300, 850, 6).image());
  assert.equal(result.strokes.length, 3);
  for (const [x, y] of [[550, 200], [550, 500], [300, 775], [201, 200], [899, 200], [300, 701]]) {
    assert.ok(distance(result.strokes, x, y) < 1.5, `(${x}, ${y})`);
  }
  assert.ok(Math.abs(total(result.strokes) - (700 + Math.hypot(700, 200) + 150)) < 12);
  for (const s of result.strokes) {
    assert.equal(s.color, 'black');
    for (const [x, y] of s.points) assert.ok(x >= 0 && y >= 0 && x <= 1200 && y <= 900);
  }
});

test('원은 닫힌 획이 되고 반지름 오차가 1.5px 안이다', () => {
  const result = extractInkStrokes(new Board(1000, 800).ring(500, 400, 120, 6).image());
  assert.equal(result.strokes.length, 1);
  const [ring] = result.strokes;
  assert.equal(ring.closed, true);
  assert.deepEqual(ring.points[0], ring.points.at(-1));
  for (const [x, y] of ring.points) assert.ok(Math.abs(Math.hypot(x - 500, y - 400) - 120) < 1.5);
  assert.ok(Math.abs(length(ring.points) - 2 * Math.PI * 120) < 12);
});

test('글자 모양: ㅏ의 가지, 겹친 열십자와 엇갈린 빗금을 잃지 않는다', () => {
  const board = new Board(1000, 700, { noise: 4 })
    .line(150, 150, 150, 400, 7).line(150, 270, 195, 270, 7) // ㅏ
    .line(400, 150, 400, 400, 7).line(300, 275, 500, 275, 7) // +
    .line(650, 150, 850, 400, 7).line(850, 150, 650, 400, 7); // x
  const { strokes } = extractInkStrokes(board.image());
  for (const [x, y] of [[150, 160], [150, 390], [192, 270], [400, 160], [305, 275], [495, 275], [655, 155], [845, 395], [845, 155], [655, 395]]) {
    assert.ok(distance(strokes, x, y) < 3, `(${x}, ${y})`);
  }
  // 교차점에서 곧게 이어져 십자와 빗금은 각각 두 획이다.
  const near = (x0, x1) => strokes.filter((s) => s.points.some(([x]) => x > x0 && x < x1));
  assert.equal(near(280, 520).length, 2);
  assert.equal(near(630, 870).length, 2);
});

test('획에서 조금만 나온 짧은 가지도 남긴다', () => {
  // 굵기 7px 세로획에서 14px 나온 ㅏ 가지
  const { strokes } = extractInkStrokes(new Board(600, 500, { noise: 2 }).line(200, 100, 200, 350, 7).line(200, 220, 217, 220, 7).image());
  assert.ok(distance(strokes, 215, 220) < 2);
  assert.equal(strokes.length, 2);
});

test('획 가장자리의 작은 요철은 가지가 되지 않는다', () => {
  const board = new Board(1000, 500, { noise: 2 }).line(150, 250, 850, 250, 16);
  for (let x = 180; x < 840; x += 45) board.disc(x, x % 2 ? 242 : 258, 3.2, 'black');
  const { strokes } = extractInkStrokes(board.image());
  assert.equal(strokes.length, 1);
});

test('굵은 획도 끝까지 이어진다', () => {
  const { strokes } = extractInkStrokes(new Board(1000, 500, { noise: 2 }).line(200, 250, 800, 250, 16).image());
  const xs = strokes.flatMap((s) => s.points.map(([x]) => x));
  // 둥근 펜 끝이 굵기의 절반만큼 더 나간다.
  assert.ok(Math.min(...xs) > 196 && Math.min(...xs) < 204, `시작 ${Math.min(...xs)}`);
  assert.ok(Math.max(...xs) > 796 && Math.max(...xs) < 804, `끝 ${Math.max(...xs)}`);
});

test('사진 변을 따라가는 얇은 보드 테두리는 획이 아니다', () => {
  const board = new Board(1600, 1200, { noise: 2 }).line(0, 10, 1600, 14, 12).line(1588, 0, 1592, 1200, 12);
  for (let i = 0; i < 5; i++) board.line(300, 300 + i * 90, 900, 300 + i * 90, 6);
  const { strokes } = extractInkStrokes(board.image());
  assert.equal(strokes.length, 5);
});

test('마커 색 네 가지를 구별한다', () => {
  const board = new Board(1200, 900, { noise: 3 });
  const colors = ['black', 'blue', 'red', 'green'];
  colors.forEach((color, i) => board.line(200, 150 + i * 180, 900, 150 + i * 180, 7, color));
  const { strokes } = extractInkStrokes(board.image());
  assert.equal(strokes.length, 4);
  colors.forEach((color, i) => {
    const found = strokes.find((s) => Math.abs(s.points[0][1] - (150 + i * 180)) < 6);
    assert.equal(found?.color, color);
  });
});

test('흐리고 탁한 색도 구별하고 회색 글씨는 검정으로 둔다', () => {
  const faded = (t, k) => t.map((v) => 1 - (1 - v) * k);
  const board = new Board(1200, 700, { noise: 3 })
    .line(200, 150, 900, 150, 7, faded(MARKER.blue, 0.45))
    .line(200, 300, 900, 300, 7, faded(MARKER.red, 0.45))
    .line(200, 450, 900, 450, 7, faded(MARKER.black, 0.45));
  const { strokes } = extractInkStrokes(board.image());
  const at = (y) => strokes.find((s) => Math.abs(s.points[0][1] - y) < 6)?.color;
  assert.equal(at(150), 'blue');
  assert.equal(at(300), 'red');
  assert.equal(at(450), 'black');
});

test('획 굵기를 추정한다', () => {
  const widths = [3, 5, 8, 12, 15];
  const board = new Board(1400, 1000, { noise: 2 });
  widths.forEach((w, i) => board.line(150, 120 + i * 180, 1200, 120 + i * 180, w));
  const { strokes } = extractInkStrokes(board.image());
  assert.equal(strokes.length, widths.length);
  widths.forEach((w, i) => {
    const found = strokes.find((s) => Math.abs(s.points[0][1] - (120 + i * 180)) < 8);
    assert.ok(found && Math.abs(found.width - w) < Math.max(0.8, w * 0.15), `굵기 ${w} → ${found?.width}`);
  });
});

test('큰 덩어리(테두리, 자석)는 빼고 옆 글씨는 남긴다', () => {
  const board = new Board(1600, 1200, { noise: 3 })
    .line(0, 12, 1600, 12, 46) // 위 테두리
    .disc(1300, 300, 60, 'black') // 자석
    .disc(1300, 700, 70, 'red')
    .line(200, 500, 700, 500, 6)
    .line(200, 650, 700, 700, 6);
  const { strokes } = extractInkStrokes(board.image());
  assert.equal(strokes.length, 2);
  for (const s of strokes) {
    for (const [x, y] of s.points) assert.ok(x < 750 && y > 450 && y < 750);
  }
});

test('부드러운 그림자 위의 글씨는 남고 그림자는 획이 아니다', () => {
  const board = new Board(1200, 900, { noise: 2 });
  const shadow = (x, y) => 1 - 0.35 / (1 + Math.exp((Math.hypot(x - 800, y - 500) - 260) / 60));
  for (let y = 0; y < 900; y++) {
    for (let x = 0; x < 1200; x++) {
      const i = (y * 1200 + x) * 3;
      for (let c = 0; c < 3; c++) board.rgb[i + c] *= shadow(x, y);
    }
  }
  board.line(700, 480, 900, 520, 7);
  const { strokes } = extractInkStrokes(board.image());
  assert.equal(strokes.length, 1);
  assert.ok(distance(strokes, 800, 500) < 1.5);
});

test('글씨 굵기만 한 점(마침표)은 남고 훨씬 가늘고 옅은 점은 버린다', () => {
  const board = new Board(1000, 700, { noise: 2 }).line(150, 300, 500, 300, 8).line(150, 450, 500, 450, 8)
    .disc(560, 300, 4, 'black') // 마침표
    .disc(700, 300, 4, [0.6, 0.6, 0.6]) // 덜 진한 소수점
    .disc(800, 300, 1.7, [0.62, 0.62, 0.62]); // 잡음 점
  const { strokes } = extractInkStrokes(board.image());
  const at = (x) => strokes.some((s) => s.points.some((p) => Math.hypot(p[0] - x, p[1] - 300) < 5));
  assert.ok(at(560), '마침표');
  assert.ok(at(700), '소수점');
  assert.ok(!at(800), '잡음 점');
});

test('종이 가장자리 그림자처럼 옅고 굵은 긴 선과 지운 잔상은 획이 아니다', () => {
  const board = new Board(1600, 1200, { noise: 2 });
  for (let i = 0; i < 6; i++) board.line(150, 150 + i * 90, 600, 150 + i * 90, 6);
  board.line(900, 250, 1400, 250, 13, [0.8, 0.8, 0.8]).line(1400, 250, 1400, 800, 13, [0.8, 0.8, 0.8]);
  board.line(200, 900, 500, 940, 8, [0.91, 0.91, 0.91]).disc(350, 920, 3, [0.84, 0.84, 0.84]); // 잔상과 그 위의 진한 점
  const { strokes } = extractInkStrokes(board.image());
  assert.equal(strokes.length, 6);
  for (const s of strokes) assert.ok(s.points.every(([x]) => x < 650));
});

test('지운 잔상은 진한 얼룩이 섞여 있어도 빈 보드로 본다', () => {
  const board = new Board(1200, 900, { light: 'flat', noise: 1.5 })
    .line(200, 300, 700, 340, 14, [0.9, 0.9, 0.9]).line(300, 500, 320, 700, 14, [0.9, 0.9, 0.9])
    .disc(450, 320, 4, [0.94, 0.94, 0.94]).disc(310, 600, 4, [0.94, 0.94, 0.94]);
  assert.deepEqual(extractInkStrokes(board.image()).strokes, []);
});

test('반사광과 흐림 때문에 옅어진 글씨는 남긴다', () => {
  const board = new Board(1600, 1200, { noise: 2 });
  for (let i = 0; i < 6; i++) board.line(150, 150 + i * 90, 600, 150 + i * 90, 6);
  for (let i = 0; i < 4; i++) board.line(900, 200 + i * 90, 1300, 200 + i * 90, 6, [0.78, 0.78, 0.78]);
  const { strokes } = extractInkStrokes(board.image());
  assert.equal(strokes.filter((s) => s.points.every(([x]) => x > 850)).length, 4);
});

test('사진 안쪽의 보드 테두리와 그 바깥의 획은 빼고, 글씨를 감싼 네모는 남긴다', () => {
  const framed = new Board(1600, 1200, { noise: 2 });
  for (let i = 0; i < 6; i++) framed.line(350, 300 + i * 90, 900, 300 + i * 90, 6);
  for (const [x0, y0, x1, y1] of [[180, 140, 1400, 160], [1400, 160, 1390, 1060], [1390, 1060, 170, 1050], [170, 1050, 180, 140]]) framed.line(x0, y0, x1, y1, 16);
  framed.line(60, 500, 100, 520, 6);
  const result = extractInkStrokes(framed.image());
  assert.equal(result.strokes.length, 6);

  const boxed = new Board(1600, 1200, { noise: 2 });
  for (let i = 0; i < 6; i++) boxed.line(350, 300 + i * 90, 900, 300 + i * 90, 6);
  for (const [x0, y0, x1, y1] of [[180, 140, 1400, 160], [1400, 160, 1390, 1060], [1390, 1060, 170, 1050], [170, 1050, 180, 140]]) boxed.line(x0, y0, x1, y1, 6);
  const kept = extractInkStrokes(boxed.image());
  assert.ok(distance(kept.strokes, 800, 150) < 3, '펜으로 그린 네모');
});

test('좌표는 축소 여부와 상관없이 입력 이미지 좌표다', () => {
  const draw = (board) => board.line(400, 300, 2000, 1500, 14);
  const big = extractInkStrokes(draw(new Board(2400, 1800, { noise: 2 })).image());
  const small = extractInkStrokes(draw(new Board(2400, 1800, { noise: 2 })).image(), { maxSide: 1200 });
  assert.ok(big.scale < 1 && small.scale < big.scale);
  for (const { strokes, width, height } of [big, small]) {
    assert.deepEqual([width, height], [2400, 1800]);
    assert.equal(strokes.length, 1);
    assert.ok(distance(strokes, 1200, 900) < 3);
    assert.ok(distance(strokes, 410, 308) < 4 && distance(strokes, 1990, 1492) < 4);
    assert.ok(Math.abs(strokes[0].width - 14) < 2);
  }
});

test('상한을 넘으면 짧은 획부터 버리고 알린다', () => {
  const board = new Board(1600, 1200, { noise: 2 });
  for (let i = 0; i < 6; i++) board.line(100, 80 + i * 60, 800, 80 + i * 60, 5);
  for (let i = 0; i < 40; i++) board.line(150 + (i % 20) * 60, 700 + Math.floor(i / 20) * 200, 175 + (i % 20) * 60, 715 + Math.floor(i / 20) * 200, 5);
  const image = board.image();
  const all = extractInkStrokes(image);
  assert.equal(all.truncated, false);
  assert.ok(all.strokes.length > 20);
  const byCount = extractInkStrokes(image, { maxStrokes: 6 });
  assert.equal(byCount.strokes.length, 6);
  assert.equal(byCount.truncated, true);
  assert.ok(byCount.strokes.every((s) => length(s.points) > 300));
  const byPoints = extractInkStrokes(image, { maxPoints: 30 });
  assert.ok(byPoints.strokes.reduce((n, s) => n + s.points.length, 0) <= 30);
  assert.equal(byPoints.truncated, true);
});

test('옵션으로 짧은 획을 거르고 입력 크기를 벗어나지 않는다', () => {
  const board = new Board(1000, 800).line(200, 200, 900, 200, 6).line(200, 400, 230, 400, 6);
  const image = board.image();
  assert.equal(extractInkStrokes(image).strokes.length, 2);
  assert.equal(extractInkStrokes(image, { maxStrokeWidth: 2 }).strokes.length, 0);
});

test('잘못된 입력은 예외 대신 빈 결과를 낸다', () => {
  for (const bad of [
    undefined, null, {},
    { width: 0, height: 10, data: new Uint8ClampedArray(0) },
    { width: 10, height: 10, data: new Uint8ClampedArray(10) },
    { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    { width: 1.5, height: 10, data: new Uint8ClampedArray(60) },
  ]) {
    const result = extractInkStrokes(bad);
    assert.deepEqual(result.strokes, []);
    assert.equal(result.truncated, false);
  }
});

test('같은 입력은 같은 결과를 낸다', () => {
  const image = new Board(800, 600).line(100, 100, 600, 300, 6, 'blue').ring(500, 400, 60, 6, 'red').image();
  assert.deepEqual(extractInkStrokes(image), extractInkStrokes(image));
});

test('긴 변 1600px 사진을 몇 초 안에 처리한다', () => {
  const board = new Board(1600, 1200, { noise: 3 });
  for (let i = 0; i < 60; i++) board.line(60 + (i % 10) * 150, 80 + Math.floor(i / 10) * 170, 150 + (i % 10) * 150, 180 + Math.floor(i / 10) * 170, 5);
  const image = board.image();
  const start = performance.now();
  const { strokes } = extractInkStrokes(image);
  assert.ok(performance.now() - start < 8000);
  assert.ok(strokes.length >= 60);
});

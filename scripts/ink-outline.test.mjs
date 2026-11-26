import assert from 'node:assert/strict';
import test from 'node:test';
import { extractInkOutlines } from '../lib/ink-outline.ts';

// 합성 화이트보드 사진. 조명 기울기와 잡음을 넣고, 잉크는 마커처럼 배경 위에 곱해서 칠한다.
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
        const shade = light === 'left' ? 1 - 0.4 * (1 - u) - 0.05 * v : light === 'corner' ? 1 - 0.35 * u * v - 0.1 * v : 1;
        const i = (y * width + x) * 3;
        this.rgb[i] = 238 * shade;
        this.rgb[i + 1] = 239 * shade;
        this.rgb[i + 2] = 236 * shade;
      }
    }
  }

  // 상자 [x0, x1]×[y0, y1] 안에서 (x, y)까지의 거리를 주는 함수로 잉크를 칠한다.
  ink(box, distance, half, color) {
    const t = Array.isArray(color) ? color : MARKER[color];
    const x0 = Math.max(0, Math.floor(box[0] - half - 2));
    const y0 = Math.max(0, Math.floor(box[1] - half - 2));
    const x1 = Math.min(this.width - 1, Math.ceil(box[2] + half + 2));
    const y1 = Math.min(this.height - 1, Math.ceil(box[3] + half + 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
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
    const box = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
    return this.ink(box, (x, y) => {
      const t = l2 ? Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / l2)) : 0;
      return Math.hypot(x - x0 - t * dx, y - y0 - t * dy);
    }, width / 2, color);
  }

  ring(cx, cy, r, width, color = 'black') {
    return this.ink([cx - r, cy - r, cx + r, cy + r], (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - r), width / 2, color);
  }

  square(x0, y0, size, width, color = 'black') {
    const x1 = x0 + size;
    const y1 = y0 + size;
    return this.line(x0, y0, x1, y0, width, color).line(x1, y0, x1, y1, width, color)
      .line(x1, y1, x0, y1, width, color).line(x0, y1, x0, y0, width, color);
  }

  disc(cx, cy, r, color = 'black') {
    return this.ink([cx, cy, cx, cy], (x, y) => Math.hypot(x - cx, y - cy), r, color);
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

// 짝수-홀수 규칙으로 (x, y)가 모양 안에 있는지 본다.
function inside(shape, x, y) {
  let k = 0;
  for (const ring of shape.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[j];
      if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) k++;
    }
  }
  return k % 2 === 1;
}

const shapeAt = (result, x, y) => result.shapes.find((s) => inside(s, x, y));

function bbox(shape) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of shape.rings) {
    for (const [x, y] of ring) {
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x);
      b[3] = Math.max(b[3], y);
    }
  }
  return b;
}

const signedArea = (ring) => ring.reduce((s, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return s + (x * ny - nx * y) / 2;
}, 0);

test('빈 보드는 조명이 기울고 잡음이 있어도 조각이 없다', () => {
  for (const light of ['left', 'corner', 'flat']) {
    const result = extractInkOutlines(new Board(1200, 900, { light, noise: 5, seed: 7 }).image());
    assert.deepEqual(result.shapes, [], light);
    assert.equal(result.truncated, false);
    assert.equal(result.width, 1200);
    assert.equal(result.height, 900);
  }
});

test('ㅇ과 ㅁ의 구멍을 짝수-홀수 고리로 남긴다', () => {
  const board = new Board(900, 600)
    .ring(150, 200, 40, 6)
    .square(300, 160, 80, 6)
    .ring(550, 200, 9, 3.5)
    .square(650, 190, 22, 3.5)
    .line(100, 450, 800, 450, 6);
  const result = extractInkOutlines(board.image());
  for (const [cx, cy, ox, oy] of [[150, 200, 190, 200], [340, 200, 300, 200], [550, 200, 559, 200], [661, 201, 650, 201]]) {
    const shape = shapeAt(result, ox, oy);
    assert.ok(shape, `획 (${ox}, ${oy})`);
    assert.ok(shape.rings.length >= 2, `고리 수 (${cx}, ${cy})`);
    assert.equal(inside(shape, cx, cy), false, `구멍 (${cx}, ${cy})`);
    const areas = shape.rings.map(signedArea);
    assert.ok(areas.some((a) => a > 0) && areas.some((a) => a < 0), '바깥 고리와 구멍은 방향이 반대다');
  }
  // 구멍 없는 직선은 고리 하나
  assert.equal(shapeAt(result, 450, 450).rings.length, 1);
});

test('짧은 획과 점을 버리지 않는다', () => {
  const board = new Board(900, 600)
    .line(100, 300, 800, 300, 5)
    .line(200, 150, 207, 150, 4)
    .disc(400, 150, 2.6)
    .line(600, 140, 603, 160, 4)
    .disc(300, 450, 3);
  const result = extractInkOutlines(board.image());
  for (const [x, y] of [[450, 300], [203, 150], [400, 150], [601.5, 150], [300, 450]]) {
    assert.ok(shapeAt(result, x, y), `(${x}, ${y})`);
  }
  assert.equal(result.shapes.length, 5);
});

test('마커 색을 구분하고 기본 출력은 검정, 파랑, 빨강 셋이다', () => {
  const board = new Board(1000, 700);
  const colors = ['black', 'blue', 'red', 'green'];
  colors.forEach((c, k) => {
    board.line(150, 120 + k * 140, 850, 120 + k * 140, 6, c);
    board.ring(500, 180 + k * 140, 20, 5, c);
  });
  const image = board.image();
  const result = extractInkOutlines(image);
  colors.slice(0, 3).forEach((c, k) => {
    assert.equal(shapeAt(result, 200, 120 + k * 140)?.color, c, c);
    assert.equal(shapeAt(result, 480, 180 + k * 140)?.color, c, `${c} 원`);
  });
  assert.ok(shapeAt(result, 200, 120 + 3 * 140), '초록 획도 모양은 남는다');
  assert.equal(result.shapes.some((s) => s.color === 'green'), false, '기본 출력에 초록이 없다');

  const withGreen = extractInkOutlines(image, { green: true });
  colors.forEach((c, k) => {
    assert.equal(shapeAt(withGreen, 200, 120 + k * 140)?.color, c, `green 옵션 ${c}`);
    assert.equal(shapeAt(withGreen, 480, 180 + k * 140)?.color, c, `green 옵션 ${c} 원`);
  });
});

// 짧은 획 몇 개로 글자 하나를 흉내 낸다. (x, y)는 글자 왼쪽 위, h는 글자 높이.
function glyph(board, x, y, h, width, color, k) {
  const v = (k * 7) % 5;
  board.line(x, y + h * 0.1, x + h * 0.15, y + h * 0.9, width, color);
  board.line(x + h * 0.15, y + h * (0.3 + v * 0.05), x + h * 0.6, y + h * 0.35, width, color);
  board.ring(x + h * 0.45, y + h * 0.7, h * 0.18, width, color);
  return board;
}

test('아주 진한 파랑 마커는 중심이 포화되어도 파랑이다', () => {
  // 빨강, 초록 채널은 바닥에 붙고 파랑 채널만 조금 남는다.
  const deep = [0.004, 0.01, 0.12];
  const board = new Board(900, 600)
    .line(100, 150, 800, 150, 8, deep)
    .ring(250, 380, 40, 7, deep)
    .line(450, 300, 600, 480, 7, deep);
  for (let k = 0; k < 6; k++) glyph(board, 650 + (k % 3) * 60, 300 + Math.floor(k / 3) * 90, 50, 5, deep, k);
  const result = extractInkOutlines(board.image());
  assert.ok(result.shapes.length > 0);
  for (const s of result.shapes) assert.equal(s.color, 'blue', `모양 ${bbox(s).map(Math.round)}`);
});

test('가늘고 흐린 파랑 글씨는 파랑이다', () => {
  const faint = [0.62, 0.66, 0.78];
  const board = new Board(900, 600);
  for (let k = 0; k < 12; k++) glyph(board, 80 + k * 62, 120, 40, 2.6, faint, k);
  for (let k = 0; k < 12; k++) glyph(board, 80 + k * 62, 320, 30, 2.2, faint, k + 3);
  const result = extractInkOutlines(board.image());
  assert.ok(result.shapes.length >= 20, `모양 수 ${result.shapes.length}`);
  for (const s of result.shapes) assert.equal(s.color, 'blue', `모양 ${bbox(s).map(Math.round)}`);
});

test('한 획 안에서 마커가 말라 회색처럼 찍힌 구간이 있어도 색이 중간에 바뀌지 않는다', () => {
  const dry = [0.5, 0.52, 0.56];
  const board = new Board(900, 600)
    .line(100, 200, 380, 200, 6, 'blue')
    .line(380, 200, 520, 200, 6, dry)
    .line(520, 200, 800, 200, 6, 'blue')
    .line(100, 420, 800, 420, 6, [0.02, 0.04, 0.2]);
  const result = extractInkOutlines(board.image());
  for (const x of [150, 300, 450, 600, 750]) assert.equal(shapeAt(result, x, 200)?.color, 'blue', `윗줄 ${x}`);
  for (const x of [150, 450, 750]) assert.equal(shapeAt(result, x, 420)?.color, 'blue', `아랫줄 ${x}`);
  assert.equal(result.shapes.filter((s) => s.color === 'black').length, 0);
});

test('파랑 단어 옆 검정 단어는 각자 제 색을 지킨다', () => {
  const board = new Board(1000, 600);
  for (let k = 0; k < 5; k++) glyph(board, 80 + k * 55, 200, 45, 4, 'blue', k);
  for (let k = 0; k < 5; k++) glyph(board, 400 + k * 55, 200, 45, 4, 'black', k + 1);
  for (let k = 0; k < 4; k++) glyph(board, 720 + k * 55, 200, 45, 4, 'blue', k + 2);
  for (let k = 0; k < 6; k++) glyph(board, 80 + k * 55, 400, 45, 4, 'black', k);
  for (let k = 0; k < 6; k++) glyph(board, 450 + k * 55, 400, 45, 4, 'blue', k + 4);
  const result = extractInkOutlines(board.image());
  for (const s of result.shapes) {
    const [x0, y0] = bbox(s);
    const want = y0 < 300 ? (x0 >= 390 && x0 < 690 ? 'black' : 'blue') : x0 < 430 ? 'black' : 'blue';
    assert.equal(s.color, want, `모양 ${bbox(s).map(Math.round)}`);
  }
});

test('검정 글자 위를 지나는 빨간 동그라미는 색 경계에서 나뉜다', () => {
  const board = new Board(900, 600)
    .ring(400, 300, 30, 5, 'black')
    .line(385, 290, 415, 290, 4, 'black')
    .line(415, 290, 385, 315, 4, 'black')
    .ring(445, 300, 60, 5, 'red');
  const result = extractInkOutlines(board.image());
  assert.equal(shapeAt(result, 370, 300)?.color, 'black', '검정 원 왼쪽');
  assert.equal(shapeAt(result, 415, 274)?.color, 'black', '검정 원 오른쪽 위');
  assert.equal(shapeAt(result, 430, 300)?.color, 'black', '검정 원 오른쪽');
  assert.equal(shapeAt(result, 400, 290)?.color, 'black', '검정 글자 속');
  assert.equal(shapeAt(result, 505, 300)?.color, 'red', '빨간 원 오른쪽');
  assert.equal(shapeAt(result, 445, 240)?.color, 'red', '빨간 원 위');
  assert.equal(shapeAt(result, 445, 360)?.color, 'red', '빨간 원 아래');
});

test('옅지만 또렷한 글씨는 남기고 지운 자국처럼 아주 옅은 흔적은 버린다', () => {
  const board = new Board(900, 600)
    .line(100, 150, 800, 150, 6)
    .line(100, 300, 800, 300, 4, [0.68, 0.68, 0.7])
    .ring(450, 420, 25, 4, [0.7, 0.7, 0.72])
    .line(100, 520, 800, 520, 12, [0.9, 0.9, 0.9]);
  const result = extractInkOutlines(board.image());
  assert.ok(shapeAt(result, 450, 150));
  assert.ok(shapeAt(result, 450, 300), '옅은 직선');
  assert.ok(shapeAt(result, 425, 420), '옅은 원');
  assert.equal(shapeAt(result, 450, 520), undefined, '지운 자국');
});

test('자석 같은 큰 덩어리는 빼고 글씨만 남긴다', () => {
  const board = new Board(1200, 900)
    .disc(250, 250, 45, [0.12, 0.12, 0.14])
    .disc(950, 650, 50, [0.2, 0.25, 0.7])
    .line(450, 450, 800, 450, 6)
    .ring(600, 300, 30, 6);
  const result = extractInkOutlines(board.image());
  assert.equal(shapeAt(result, 250, 250), undefined, '검은 자석');
  assert.equal(shapeAt(result, 950, 650), undefined, '파란 자석');
  assert.ok(shapeAt(result, 600, 450));
  assert.ok(shapeAt(result, 570, 300));
  assert.equal(result.shapes.length, 2);
});

test('좌표는 축소해서 처리해도 입력 픽셀의 연속 좌표다', () => {
  const board = new Board(2400, 1600, { light: 'flat' })
    .line(400, 400, 2000, 400, 12)
    .line(1200, 700, 1200, 1300, 12);
  const result = extractInkOutlines(board.image(), { maxSide: 1200 });
  assert.equal(result.width, 2400);
  assert.equal(result.height, 1600);
  assert.ok(Math.abs(result.scale - 0.5) < 1e-9);
  const h = shapeAt(result, 1200, 400);
  const v = shapeAt(result, 1200, 1000);
  assert.ok(h && v);
  const [hx0, hy0, hx1, hy1] = bbox(h);
  for (const [got, want] of [[hx0, 394], [hy0, 394], [hx1, 2006], [hy1, 406]]) assert.ok(Math.abs(got - want) < 2, `${got} ~ ${want}`);
  const [vx0, vy0, vx1, vy1] = bbox(v);
  for (const [got, want] of [[vx0, 1194], [vy0, 694], [vx1, 1206], [vy1, 1306]]) assert.ok(Math.abs(got - want) < 2, `${got} ~ ${want}`);
  assert.ok(Math.abs(h.strokeWidth - 12) < 2, `굵기 ${h.strokeWidth}`);
  assert.ok(Math.abs(h.area - 1600 * 12) / (1600 * 12) < 0.05, `넓이 ${h.area}`);
  assert.equal(inside(h, 1200, 415), false);
});

test('1배 처리에서도 픽셀 중심 좌표를 지킨다', () => {
  const result = extractInkOutlines(new Board(600, 400, { light: 'flat' }).line(100, 200, 500, 200, 8).image());
  assert.equal(result.shapes.length, 1);
  const [x0, y0, x1, y1] = bbox(result.shapes[0]);
  for (const [got, want] of [[x0, 96], [y0, 196], [x1, 504], [y1, 204]]) assert.ok(Math.abs(got - want) < 1.2, `${got} ~ ${want}`);
});

test('모양 수와 점 수 상한을 넘으면 작은 것부터 버린다', () => {
  const board = new Board(1200, 800);
  for (let k = 0; k < 40; k++) board.disc(100 + (k % 10) * 110, 150 + Math.floor(k / 10) * 160, 3 + (k % 7));
  board.line(100, 720, 1100, 720, 6);
  const image = board.image();
  const full = extractInkOutlines(image);
  assert.equal(full.truncated, false);
  assert.equal(full.shapes.length, 41);
  const areas = full.shapes.map((s) => s.area).sort((a, b) => b - a);

  const few = extractInkOutlines(image, { maxShapes: 5 });
  assert.equal(few.truncated, true);
  assert.equal(few.shapes.length, 5);
  assert.ok(Math.min(...few.shapes.map((s) => s.area)) >= areas[4] - 1e-6);
  assert.ok(shapeAt(few, 600, 720), '가장 큰 직선은 남는다');

  const points = (r) => r.shapes.reduce((s, sh) => s + sh.rings.reduce((a, q) => a + q.length, 0), 0);
  const limit = Math.floor(points(full) / 2);
  const capped = extractInkOutlines(image, { maxPoints: limit });
  assert.equal(capped.truncated, true);
  assert.ok(points(capped) <= limit);
  assert.ok(capped.shapes.length > 0 && capped.shapes.length < full.shapes.length);
});

test('잘못된 입력은 빈 결과를 돌려준다', () => {
  for (const image of [null, {}, { width: 0, height: 10, data: new Uint8Array(0) }, { width: 10, height: 10, data: new Uint8Array(10) }]) {
    const result = extractInkOutlines(image);
    assert.deepEqual(result.shapes, []);
    assert.equal(result.truncated, false);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  A4_PT, GOODNOTES_UNITS_PER_PT, KIND_STROKE, appleLz4Decode, decodeTpl, decodeUniformPen, listTemplatePages,
  pageObjects, readZip, readZipFiles, buildSolidJpeg, renderPenSubpath, strokeInfo,
} from '../lib/goodnotes-file.ts';
import { INK_PDF_COLORS } from '../lib/ink-pdf.ts';
import {
  GOODNOTES_EXPORT_EXTENSION, GOODNOTES_EXPORT_MARGIN, GOODNOTES_EXPORT_MAX_PEN_PT, GOODNOTES_EXPORT_MIN_PEN_PT,
  GOODNOTES_EXPORT_SETUP, GOODNOTES_EXPORT_TYPE, buildGoodnotesExport, goodnotesFileName, inkPage, inkPageLayout,
  inkPenWidth, inkPreviewColor, inkPreviewFrame, outlineToInk, photoPage,
} from '../lib/goodnotes-export-format.ts';
import { readInk } from '../lib/goodnotes-ink.ts';

const B = { profile: 'codec', unitsPerPt: GOODNOTES_UNITS_PER_PT };
const A = { profile: 'natural-ink', unitsPerPt: 1 };
const C = { profile: 'natural-ink', unitsPerPt: GOODNOTES_UNITS_PER_PT };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const colors = ['black', 'blue', 'red', 'green'];

// 사진 픽셀로 만든 획을 그 설정의 페이지 단위로 옮긴다(outlineToInk가 내는 모양). 굵기는 일부러 범위 밖도 섞는다.
function sampleInk(width, height, count = 500, setup = GOODNOTES_EXPORT_SETUP) {
  const { fit } = inkPageLayout({ width, height }, setup);
  const toPage = ([x, y]) => [fit.offsetX + x * fit.scale, fit.offsetY + y * fit.scale];
  const strokes = [];
  for (let i = 0; i < count; i += 1) {
    const x = (i * 37) % (width - 60) + 20;
    const y = (i * 53) % (height - 60) + 20;
    const points = i % 50 === 0 ? [[x, y], [x, y]] : Array.from({ length: 12 }, (_, k) => [x + k * 3, y + Math.sin(k + i) * 6]);
    strokes.push({ points: points.map(toPage), color: colors[i % 4], width: (0.2 + (i % 9)) * setup.unitsPerPt });
  }
  return { width, height, setup, strokes };
}

// 합성 화이트보드(scripts/ink-outline.test.mjs와 같은 방식): 조명 기울기와 잡음, 마커를 곱해서 칠한다.
const MARKER = { black: [0.16, 0.16, 0.18], blue: [0.16, 0.3, 0.78], red: [0.88, 0.17, 0.2], green: [0.16, 0.58, 0.32] };
function board(width, height, lines) {
  const rgb = new Float64Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const shade = 1 - 0.3 * (1 - x / width), i = (y * width + x) * 3;
    rgb[i] = 238 * shade; rgb[i + 1] = 239 * shade; rgb[i + 2] = 236 * shade;
  }
  for (const [x0, y0, x1, y1, w, color] of lines) {
    const t = MARKER[color], dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy, half = w / 2;
    for (let y = Math.floor(Math.min(y0, y1) - w); y <= Math.ceil(Math.max(y0, y1) + w); y++) {
      for (let x = Math.floor(Math.min(x0, x1) - w); x <= Math.ceil(Math.max(x0, x1) + w); x++) {
        const s = l2 ? Math.min(1, Math.max(0, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / l2)) : 0;
        const a = Math.min(1, Math.max(0, half + 0.5 - Math.hypot(x + 0.5 - x0 - s * dx, y + 0.5 - y0 - s * dy)));
        if (a > 0) for (let c = 0; c < 3; c++) rgb[(y * width + x) * 3 + c] *= 1 - a * (1 - t[c]);
      }
    }
  }
  let seed = 9;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const n = (rand() - 0.5) * 6;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = rgb[i * 3 + c] + n;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

test('기본 설정은 시험 파일 B(codec, 6/11 단위)이고 형식은 .goodnotes, application/zip', () => {
  assert.deepEqual(GOODNOTES_EXPORT_SETUP, B);
  assert.equal(GOODNOTES_EXPORT_EXTENSION, '.goodnotes');
  assert.equal(GOODNOTES_EXPORT_TYPE, 'application/zip');
});

test('가로 사진은 A4 가로, 세로와 정사각형 사진은 A4 세로', () => {
  for (const setup of [A, B]) {
    const u = setup.unitsPerPt;
    const land = inkPageLayout({ width: 1600, height: 1200 }, setup).page;
    close(land.width, A4_PT.height * u);
    close(land.height, A4_PT.width * u);
    const port = inkPageLayout({ width: 1200, height: 1600 }, setup).page;
    close(port.width, A4_PT.width * u);
    close(port.height, A4_PT.height * u);
    const square = inkPageLayout({ width: 1000, height: 1000 }, setup).page;
    assert.ok(square.width < square.height);
  }
});

test('여백은 페이지 폭의 4%, 정렬은 왼쪽 위, 사진 비율 유지', () => {
  for (const [w, h] of [[1600, 1200], [1200, 1600], [1600, 400], [300, 1600]]) {
    const { page, fit, margin } = inkPageLayout({ width: w, height: h }, B);
    close(margin, page.width * GOODNOTES_EXPORT_MARGIN);
    assert.equal(fit.offsetX, margin);
    assert.equal(fit.offsetY, margin);
    // 한 배율로 x와 y를 함께 바꾸니 비율이 유지된다. 한쪽 변은 여백까지 꽉 찬다.
    const right = fit.offsetX + w * fit.scale;
    const bottom = fit.offsetY + h * fit.scale;
    assert.ok(right <= page.width - margin + 1e-6 && bottom <= page.height - margin + 1e-6);
    assert.ok(Math.abs(right - (page.width - margin)) < 1e-6 || Math.abs(bottom - (page.height - margin)) < 1e-6);
  }
});

test('윤곽은 A4 가로 페이지 단위의 볼펜 획이 되고 사진 영역 안에 그려진다', () => {
  // 1600×1200 사진의 가로 막대(사진 픽셀 100~1500 × 590~610)
  const outline = { width: 1600, height: 1200, shapes: [
    { color: 'blue', rings: [[[100, 590], [1500, 590], [1500, 610], [100, 610]]], area: 28000, strokeWidth: 20 },
  ] };
  const ink = outlineToInk(outline, B);
  assert.equal(ink.width, 1600);
  assert.equal(ink.height, 1200);
  assert.deepEqual(ink.setup, B);
  assert.ok(ink.strokes.length >= 1);
  const pageW = A4_PT.height * GOODNOTES_UNITS_PER_PT; // 1543.47
  const pageH = A4_PT.width * GOODNOTES_UNITS_PER_PT; // 1091.34
  const margin = pageW * 0.04; // 61.74
  // 4:3 사진은 A4 가로(약 1.41:1)보다 덜 길쭉해서 높이에 맞춰진다.
  const scale = (pageH - 2 * margin) / 1200; // 0.8066
  const { page, fit } = inkPage(ink);
  close(fit.scale, scale);
  close(page.width, pageW, 1e-6);
  close(page.height, pageH, 1e-6);
  const all = ink.strokes.flatMap(stroke => stroke.points);
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const pad = GOODNOTES_EXPORT_MAX_PEN_PT * GOODNOTES_UNITS_PER_PT;
  assert.ok(Math.min(...xs) >= margin + 100 * scale - pad && Math.max(...xs) <= margin + 1500 * scale + pad, '가로 범위');
  assert.ok(Math.min(...ys) >= margin + 590 * scale - pad && Math.max(...ys) <= margin + 610 * scale + pad, '세로 범위');
  // 막대 양 끝 가까이까지 칠한다.
  assert.ok(Math.min(...xs) < margin + 110 * scale && Math.max(...xs) > margin + 1490 * scale);
  for (const stroke of ink.strokes) assert.equal(stroke.color, 'blue');
  // 1쪽에는 획을 그대로 넣고 색은 4색 RGB로 바꾼다.
  assert.equal(page.strokes.length, ink.strokes.length);
  assert.deepEqual(page.strokes[0].points, ink.strokes[0].points);
  assert.deepEqual(page.strokes[0].color, INK_PDF_COLORS.blue);
});

test('굵기는 0.8~6pt로 자르고, 윤곽에서 만든 획도 그 범위 안이다', () => {
  for (const setup of [A, B]) {
    const u = setup.unitsPerPt;
    close(inkPenWidth(0.1, setup), GOODNOTES_EXPORT_MIN_PEN_PT * u);
    close(inkPenWidth(1000, setup), GOODNOTES_EXPORT_MAX_PEN_PT * u);
    close(inkPenWidth(3 * u, setup), 3 * u);
    close(inkPenWidth(Number.NaN, setup), GOODNOTES_EXPORT_MIN_PEN_PT * u);
    // 아주 가는 선(1px)과 아주 굵은 덩어리(80px)
    const outline = { width: 1600, height: 1200, shapes: [
      { color: 'black', rings: [[[100, 100], [900, 100], [900, 101], [100, 101]]], area: 800, strokeWidth: 1 },
      { color: 'red', rings: [[[100, 300], [1300, 300], [1300, 380], [100, 380]]], area: 96000, strokeWidth: 80 },
    ] };
    const widths = outlineToInk(outline, setup).strokes.map(stroke => stroke.width / u);
    assert.ok(widths.length >= 2);
    for (const pt of widths) assert.ok(pt >= GOODNOTES_EXPORT_MIN_PEN_PT - 1e-9 && pt <= GOODNOTES_EXPORT_MAX_PEN_PT + 1e-9, `${pt}pt`);
  }
});

test('미리보기는 1쪽의 사진 영역을 종이로 쓰고 파일과 같은 펜 색을 쓴다', () => {
  for (const [w, h] of [[1600, 1200], [1200, 1600], [300, 1600]]) {
    const ink = { width: w, height: h, setup: B, strokes: [] };
    const { fit } = inkPageLayout(ink, B);
    const frame = inkPreviewFrame(ink);
    close(frame.x, fit.offsetX);
    close(frame.y, fit.offsetY);
    close(frame.width / frame.height, w / h);
    close(frame.width, w * fit.scale);
  }
  assert.equal(inkPreviewColor('red'), 'rgb(204 26 31)');
  assert.equal(inkPreviewColor('unknown'), inkPreviewColor('black'));
});

test('2쪽은 사진 PDF의 2쪽이고 크기는 사진 비율을 따른다', () => {
  const ink = { width: 1600, height: 1200, strokes: [] };
  const jpeg = buildSolidJpeg(1600, 1200, 200);
  const page = photoPage(ink, jpeg, '제목');
  assert.equal(page.backgroundPdfPage, 2);
  assert.equal(page.strokes.length, 0);
  close(page.width, 842 * GOODNOTES_UNITS_PER_PT);
  close(page.height, 631.5 * GOODNOTES_UNITS_PER_PT);
  const pdf = Buffer.from(page.backgroundPdf).toString('latin1');
  assert.ok(pdf.startsWith('%PDF'));
  assert.match(pdf, /\/Count 2/);
  assert.doesNotMatch(pdf, /\/Subtype \/Ink/, '사진 PDF에는 획이 없다');
  assert.equal(photoPage(ink, new Uint8Array([1, 2, 3]), '제목'), null, 'JPEG가 아니면 사진 쪽 없음');
});

test('파일 이름과 확장자', () => {
  assert.equal(goodnotesFileName('수학 판서'), '수학 판서.goodnotes');
  assert.equal(goodnotesFileName('  '), '슬림보드 노트.goodnotes');
  assert.equal(goodnotesFileName('a/b:c*\n줄'), 'abc 줄.goodnotes');
  assert.equal(goodnotesFileName('가'.repeat(80)), `${'가'.repeat(60)}.goodnotes`);
});

async function readBack(bytes) {
  const entries = readZip(bytes);
  const files = await readZipFiles(bytes);
  const pages = listTemplatePages({ notesIndex: files.get('index.notes.pb'), events: files.get('index.events.pb'), names: entries.map(e => e.name) });
  return { files, pages, notes: pages.map(p => files.get(`notes/${p.noteId}`) ?? new Uint8Array()) };
}

for (const [name, setup] of [['A', A], ['B', B], ['C', C]]) {
  test(`만든 .goodnotes를 다시 열면 2쪽, 획 수, 굵기가 맞다(${name})`, async () => {
    const ink = sampleInk(1600, 1200, 500, setup);
    const jpeg = buildSolidJpeg(1600, 1200, 230);
    const started = performance.now();
    const bytes = await buildGoodnotesExport({ ink, title: '  ', jpeg, idSeed: 'test' });
    const ms = performance.now() - started;
    console.log(`${name}: ${ink.strokes.length}획, ${bytes.length} bytes, ${ms.toFixed(0)}ms`);
    const { files, pages, notes } = await readBack(bytes);
    assert.equal(pages.length, 2);
    const u = setup.unitsPerPt;
    close(pages[0].size.width, A4_PT.height * u, 1e-3);
    close(pages[0].size.height, A4_PT.width * u, 1e-3);
    // 배경 규칙: 사진 쪽은 설정과 상관없이 사진 PDF 크기(pt) × 11/6.
    close(pages[1].size.width, 842 * GOODNOTES_UNITS_PER_PT, 1e-3);
    close(pages[1].size.height, 631.5 * GOODNOTES_UNITS_PER_PT, 1e-3);
    const strokes = pageObjects(notes[0]).filter(o => o.kind === KIND_STROKE);
    assert.equal(strokes.length, 500);
    assert.equal(pageObjects(notes[1]).length, 0);
    const min = Math.fround(GOODNOTES_EXPORT_MIN_PEN_PT * u);
    const max = Math.fround(GOODNOTES_EXPORT_MAX_PEN_PT * u);
    for (const obj of strokes) {
      const pen = decodeUniformPen(decodeTpl(appleLz4Decode(obj.body.find(f => f.number === 2).data).data));
      assert.ok(pen.width >= min - 1e-6 && pen.width <= max + 1e-6);
    }
    const blue = strokeInfo(strokes[1]).color;
    INK_PDF_COLORS.blue.forEach((c, k) => close(blue[k], Math.fround(c)));
    const title = Buffer.from(files.get('index.events.pb')).toString('utf8');
    assert.ok(title.includes('슬림보드 노트'), '빈 제목은 슬림보드 노트');
    const pdfs = [...files.keys()].filter(n => n.startsWith('attachments/')).map(n => Buffer.from(files.get(n)).toString('latin1'));
    assert.ok(pdfs.some(p => /\/Count 2/.test(p) && /\/Subtype \/Image/.test(p)), '사진 PDF가 첨부로 들어 있다');
    // 1쪽 흰 배경 PDF도 배경 규칙(페이지 단위 × 6/11 = pt)을 따른다.
    const solid = pdfs.find(p => !/\/Subtype \/Image/.test(p));
    const box = solid.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/).slice(1).map(Number);
    close(box[0], pages[0].size.width / GOODNOTES_UNITS_PER_PT, 0.01);
    close(box[1], pages[0].size.height / GOODNOTES_UNITS_PER_PT, 0.01);
  });
}

test('사진이 JPEG가 아니면 획 쪽 하나만 만든다', async () => {
  const bytes = await buildGoodnotesExport({ ink: sampleInk(1200, 1600, 3), title: '노트', jpeg: new Uint8Array([0]), idSeed: 't' });
  const { pages } = await readBack(bytes);
  assert.equal(pages.length, 1);
  close(pages[0].size.width, A4_PT.width * GOODNOTES_UNITS_PER_PT, 1e-3);
});

test('합성 사진의 글씨가 윤곽, 볼펜 획, 파일, 되읽기를 거쳐도 사라지지 않는다', async () => {
  const lines = [
    // [x0, y0, x1, y1, 굵기, 색]: 큰 글씨, 작은 글씨(굵기 3px), 점 같은 짧은 획, 4색
    [100, 120, 700, 140, 8, 'black'], [120, 220, 120, 420, 6, 'blue'], [300, 260, 520, 420, 5, 'red'],
    [600, 260, 800, 300, 5, 'green'], [560, 480, 590, 480, 3, 'black'], [620, 470, 640, 500, 3, 'black'],
    [680, 470, 700, 470, 3, 'blue'], [740, 490, 744, 491, 3.5, 'red'], [200, 500, 260, 540, 3, 'black'],
  ];
  const pixels = board(900, 600, lines);
  const ink = readInk(pixels);
  assert.equal(ink.width, 900);
  assert.equal(ink.height, 600);
  assert.ok(ink.strokes.length >= lines.length, `획 ${ink.strokes.length}개`);
  const bytes = await buildGoodnotesExport({ ink, title: '합성', jpeg: buildSolidJpeg(900, 600, 230), idSeed: 'synth' });
  const { pages, notes } = await readBack(bytes);
  assert.equal(pages.length, 2);
  const objects = pageObjects(notes[0]).filter(o => o.kind === KIND_STROKE);
  assert.equal(objects.length, ink.strokes.length, '쓴 획이 모두 되읽힌다');
  // 되읽은 펜 획을 사진 픽셀로 되돌려 선마다 중심선의 점이 펜에 덮이는지 본다.
  const { fit } = inkPageLayout(ink, ink.setup);
  const back = objects.map(o => {
    const pen = decodeUniformPen(decodeTpl(appleLz4Decode(o.body.find(f => f.number === 2).data).data));
    const pts = pen.subpaths.flatMap(sp => renderPenSubpath(sp, 2)).map(([x, y]) => [(x - fit.offsetX) / fit.scale, (y - fit.offsetY) / fit.scale]);
    return { r: pen.width / 2 / fit.scale, pts, color: strokeInfo(o).color };
  });
  const covered = (x, y) => back.find(({ r, pts }) => pts.some((p, i) => {
    const q = pts[Math.max(0, i - 1)];
    const dx = p[0] - q[0], dy = p[1] - q[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - q[0]) * dx + (y - q[1]) * dy) / l2)) : 0;
    return Math.hypot(x - q[0] - t * dx, y - q[1] - t * dy) <= r + 0.75;
  }));
  for (const [x0, y0, x1, y1, , color] of lines) {
    let hit = 0;
    const samples = 9;
    for (let k = 0; k < samples; k += 1) {
      const t = k / (samples - 1);
      const stroke = covered(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (!stroke) continue;
      hit += 1;
      INK_PDF_COLORS[color].forEach((c, i) => close(stroke.color[i], Math.fround(c), 1e-6));
    }
    assert.ok(hit >= samples - 1, `(${x0}, ${y0})→(${x1}, ${y1}) ${color}: ${hit}/${samples}`);
  }
  // 빈 보드는 획이 없다(화면은 글씨 없음으로 안내한다).
  assert.equal(readInk(board(600, 400, [])).strokes.length, 0);
});

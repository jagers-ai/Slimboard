import assert from 'node:assert/strict';
import test from 'node:test';
import {
  A4_PT, GOODNOTES_UNITS_PER_PT, KIND_STROKE, appleLz4Decode, decodeTpl, decodeUniformPen, listTemplatePages,
  pageObjects, readZip, readZipFiles, buildSolidJpeg, strokeInfo,
} from '../lib/goodnotes-file.ts';
import { INK_PDF_COLORS } from '../lib/ink-pdf.ts';
import {
  GOODNOTES_EXPORT_EXTENSION, GOODNOTES_EXPORT_MARGIN, GOODNOTES_EXPORT_MAX_PEN_PT, GOODNOTES_EXPORT_MIN_PEN_PT,
  GOODNOTES_EXPORT_SETUP, GOODNOTES_EXPORT_TYPE, buildGoodnotesExport, goodnotesFileName, inkPage, inkPageLayout,
  inkPenWidth, inkPreviewPen, photoPage,
} from '../lib/goodnotes-export-format.ts';

const B = { profile: 'codec', unitsPerPt: GOODNOTES_UNITS_PER_PT };
const A = { profile: 'natural-ink', unitsPerPt: 1 };
const C = { profile: 'natural-ink', unitsPerPt: GOODNOTES_UNITS_PER_PT };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const colors = ['black', 'blue', 'red', 'green'];

function sampleInk(width, height, count = 500) {
  const strokes = [];
  for (let i = 0; i < count; i += 1) {
    const x = (i * 37) % (width - 60) + 20;
    const y = (i * 53) % (height - 60) + 20;
    const points = i % 50 === 0 ? [[x, y], [x, y]] : Array.from({ length: 12 }, (_, k) => [x + k * 3, y + Math.sin(k + i) * 6]);
    strokes.push({ points, color: colors[i % 4], width: 1 + (i % 9), closed: false });
  }
  return { width, height, strokes };
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

test('1600×1200 사진의 점은 A4 가로 페이지 단위로 옮겨진다', () => {
  const ink = { width: 1600, height: 1200, strokes: [{ points: [[0, 0], [800, 600], [1600, 1200]], color: 'blue', width: 4 }] };
  const { page, fit } = inkPage(ink, B);
  const pageW = A4_PT.height * GOODNOTES_UNITS_PER_PT; // 1543.47
  const pageH = A4_PT.width * GOODNOTES_UNITS_PER_PT; // 1091.34
  const margin = pageW * 0.04; // 61.74
  // 4:3 사진은 A4 가로(약 1.41:1)보다 덜 길쭉해서 높이에 맞춰진다.
  const scale = (pageH - 2 * margin) / 1200; // 0.8066
  close(fit.scale, scale);
  const [p0, p1, p2] = page.strokes[0].points;
  close(p0[0], margin); close(p0[1], margin);
  close(p1[0], margin + 800 * scale); close(p1[1], margin + 600 * scale);
  close(p2[0], margin + 1600 * scale); close(p2[1], pageH - margin);
  assert.ok(p2[0] < pageW - margin, '오른쪽은 남는다');
  assert.deepEqual(page.strokes[0].color, INK_PDF_COLORS.blue);
  close(page.strokes[0].width, 4 * scale);
});

test('굵기는 사진 픽셀에서 환산하고 0.8~6pt로 자른다', () => {
  for (const setup of [A, B]) {
    const { fit } = inkPageLayout({ width: 1600, height: 1200 }, setup);
    close(inkPenWidth(0.1, fit, setup), GOODNOTES_EXPORT_MIN_PEN_PT * setup.unitsPerPt);
    close(inkPenWidth(1000, fit, setup), GOODNOTES_EXPORT_MAX_PEN_PT * setup.unitsPerPt);
    close(inkPenWidth(5, fit, setup), 5 * fit.scale);
    close(inkPenWidth(Number.NaN, fit, setup), GOODNOTES_EXPORT_MIN_PEN_PT * setup.unitsPerPt);
  }
  // 단위가 달라도 종이 위 굵기(pt)는 같다.
  const pt = setup => inkPenWidth(3, inkPageLayout({ width: 1600, height: 1200 }, setup).fit, setup) / setup.unitsPerPt;
  close(pt(A), pt(B));
  // 미리보기 굵기는 파일 굵기를 사진 픽셀로 되돌린 값이다.
  const ink = sampleInk(1600, 1200, 1);
  const { fit } = inkPageLayout(ink, GOODNOTES_EXPORT_SETUP);
  close(inkPreviewPen(ink, { ...ink.strokes[0], width: 0.1 }).width, GOODNOTES_EXPORT_MIN_PEN_PT * GOODNOTES_UNITS_PER_PT / fit.scale);
  assert.equal(inkPreviewPen(ink, { ...ink.strokes[0], color: 'red' }).color, 'rgb(204 26 31)');
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
    const ink = sampleInk(1600, 1200, 500);
    const jpeg = buildSolidJpeg(1600, 1200, 230);
    const started = performance.now();
    const bytes = await buildGoodnotesExport({ ink, title: '  ', jpeg, setup, idSeed: 'test' });
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

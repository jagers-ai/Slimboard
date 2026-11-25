import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInkPdf, readJpegInfo, INK_PDF_COLORS } from '../lib/ink-pdf.ts';

const latin1 = bytes => new TextDecoder('latin1').decode(bytes);
const at = new Date(Date.UTC(2026, 10, 25, 1, 2, 3));

function parse(bytes) {
  const text = latin1(bytes);
  const m = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  assert.ok(m, 'trailer ends with startxref and %%EOF');
  const xrefAt = Number(m[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 5), 'xref\n');
  const head = /^xref\n0 (\d+)\n/.exec(text.slice(xrefAt));
  const size = Number(head[1]);
  const entries = text.slice(xrefAt + head[0].length, xrefAt + head[0].length + size * 20);
  const objects = new Map();
  for (let n = 0; n < size; n += 1) {
    const e = entries.slice(n * 20, n * 20 + 20);
    assert.match(e, /^\d{10} \d{5} [fn] \n$/);
    if (n === 0) { assert.equal(e, '0000000000 65535 f \n'); continue; }
    const offset = Number(e.slice(0, 10));
    assert.equal(text.slice(offset, offset + `${n} 0 obj\n`.length), `${n} 0 obj\n`, `object ${n} at ${offset}`);
    objects.set(n, text.slice(offset, text.indexOf('endobj', offset)));
  }
  const trailer = /trailer\n<< \/Size (\d+) /.exec(text);
  assert.equal(Number(trailer[1]), size);
  return { text, objects, size };
}

const annots = text => [...text.matchAll(/<< \/Type \/Annot \/Subtype \/Ink [^\n]*/g)].map(x => x[0]);
const inkList = annot => /\/InkList \[\[([^\]]*)\]\]/.exec(annot)[1].split(' ').map(Number);
const rect = s => /\/Rect \[([^\]]*)\]/.exec(s)[1].split(' ').map(Number);

// 구조만 읽는 최소 JPEG 헤더(SOI, 선택 APP1 EXIF, SOF0, EOI).
function fakeJpeg(width, height, orientation) {
  const bytes = [0xff, 0xd8];
  if (orientation) {
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    bytes.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
  }
  bytes.push(0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  bytes.push(0xff, 0xd9);
  return new Uint8Array(bytes);
}

test('xref offsets point at every object and startxref points at xref', () => {
  const pdf = buildInkPdf({ width: 1200, height: 900, title: '수업', createdAt: at, photo: { jpeg: fakeJpeg(1200, 900) },
    strokes: [{ points: [[0, 0], [100, 100], [200, 50]], color: 'black', width: 3 }, { points: [[5, 5]], color: 'red', width: 2 }] });
  const { text, size } = parse(pdf);
  assert.ok(text.startsWith('%PDF-1.7\n%'));
  assert.deepEqual([...pdf.slice(10, 14)], [0xe2, 0xe3, 0xcf, 0xd3]);
  assert.equal(size, 12);
});

test('one Ink annotation with appearance stream per stroke', () => {
  const strokes = Array.from({ length: 7 }, (_, i) => ({ points: [[i * 10, 0], [i * 10 + 5, 40]], color: 'blue', width: 2 }));
  const { text, objects } = parse(buildInkPdf({ width: 400, height: 300, strokes, createdAt: at }));
  const list = annots(text);
  assert.equal(list.length, 7);
  assert.equal(new Set(list.map(a => /\/NM \(([^)]*)\)/.exec(a)[1])).size, 7);
  assert.match(objects.get(4), /\/Annots \[5 0 R 7 0 R 9 0 R 11 0 R 13 0 R 15 0 R 17 0 R\]/);
  for (const a of list) {
    assert.match(a, /\/Type \/Annot \/Subtype \/Ink \/P 4 0 R /);
    assert.match(a, /\/F 4 /);
    assert.match(a, /\/M \(D:20261125010203Z\)/);
    assert.match(a, /\/BS << \/Type \/Border \/W [\d.]+ \/S \/S >>/);
    const ap = Number(/\/AP << \/N (\d+) 0 R >>/.exec(a)[1]);
    const form = objects.get(ap);
    assert.match(form, /\/Subtype \/Form .*\/Matrix \[1 0 0 1 0 0\]/);
    assert.deepEqual(rect(a), /\/BBox \[([^\]]*)\]/.exec(form)[1].split(' ').map(Number));
    assert.match(form, /\n1 J\n1 j\n/);
    const len = Number(/\/Length (\d+)/.exec(form)[1]);
    const body = form.slice(form.indexOf('stream\n') + 7);
    assert.equal(body.slice(len), '\nendstream\n');
  }
});

test('scales the long side to 842pt and flips y', () => {
  const { text, objects } = parse(buildInkPdf({ width: 1000, height: 500, createdAt: at,
    strokes: [{ points: [[100, 100], [1000, 500]], color: 'black', width: 2 }] }));
  assert.match(objects.get(4), /\/MediaBox \[0 0 842 421\]/);
  assert.deepEqual(inkList(annots(text)[0]), [84.2, 336.8, 842, 0]);
  const portrait = parse(buildInkPdf({ width: 600, height: 1200, strokes: [], createdAt: at }));
  assert.match(portrait.objects.get(4), /\/MediaBox \[0 0 421 842\]/);
});

test('rect grows by half the line width and appearance path matches InkList', () => {
  const { text, objects } = parse(buildInkPdf({ width: 842, height: 842, createdAt: at,
    strokes: [{ points: [[100, 100], [200, 300]], color: 'green', width: 4 }] }));
  const a = annots(text)[0];
  assert.deepEqual(rect(a), [98, 540, 202, 744]);
  assert.deepEqual(inkList(a), [100, 742, 200, 542]);
  assert.match(objects.get(6), /\n100 742 m\n200 542 l\nS\n/);
});

test('maps colors and clamps line width to 0.8..6pt', () => {
  const strokes = ['black', 'blue', 'red', 'green', 'purple'].map((color, i) => ({ points: [[i, 0], [i, 9]], color, width: [1, 4, 100, 0, NaN][i] }));
  const list = annots(parse(buildInkPdf({ width: 1000, height: 1000, strokes, createdAt: at })).text);
  const colors = list.map(a => /\/C \[([^\]]*)\]/.exec(a)[1].split(' ').map(Number));
  assert.deepEqual(colors, [...['black', 'blue', 'red', 'green'].map(c => [...INK_PDF_COLORS[c]]), [...INK_PDF_COLORS.black]]);
  const widths = list.map(a => Number(/\/W ([\d.]+)/.exec(a)[1]));
  assert.deepEqual(widths, [0.84, 3.37, 6, 0.8, 0.8]);
  for (const c of colors.slice(0, 4)) assert.ok(Math.max(...c) <= 0.8, 'colors stay dark on white');
});

test('Korean title is a UTF-16BE hex string with BOM; catalog shows the title', () => {
  const { objects } = parse(buildInkPdf({ width: 10, height: 10, strokes: [], title: ' 판서 A😀 ', createdAt: at }));
  assert.match(objects.get(3), /\/Title <FEFFD310C11C00200041D83DDE00> \/Producer \(Slimboard\)/);
  assert.match(objects.get(1), /\/ViewerPreferences << \/DisplayDocTitle true >>/);
  const untitled = parse(buildInkPdf({ width: 10, height: 10, strokes: [], createdAt: at }));
  assert.doesNotMatch(untitled.objects.get(3), /\/Title/);
});

test('one page without a photo and two pages with a DCT photo', () => {
  const one = parse(buildInkPdf({ width: 100, height: 80, strokes: [], createdAt: at }));
  assert.match(one.objects.get(2), /\/Kids \[4 0 R\] \/Count 1/);
  assert.doesNotMatch(one.text, /DCTDecode/);

  const jpeg = fakeJpeg(1600, 1200);
  const pdf = buildInkPdf({ width: 1600, height: 1200, strokes: [{ points: [[1, 1], [2, 2]], color: 'red', width: 2 }], createdAt: at, photo: { jpeg } });
  const two = parse(pdf);
  assert.match(two.objects.get(2), /\/Kids \[4 0 R 7 0 R\] \/Count 2/);
  assert.match(two.objects.get(7), /\/MediaBox \[0 0 842 631.5\]/);
  assert.match(two.objects.get(8), /\n842 0 0 631.5 0 0 cm\n\/Im0 Do\n/);
  const image = two.objects.get(9);
  assert.match(image, /\/Width 1600 \/Height 1200 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/DCTDecode \/Length 23 >>/);
  const start = two.text.indexOf('stream\n', two.text.indexOf('9 0 obj')) + 7;
  assert.deepEqual([...pdf.slice(start, start + jpeg.length)], [...jpeg], 'JPEG bytes are embedded unchanged');
});

test('EXIF orientation rotates the photo page instead of the pixels', () => {
  assert.equal(readJpegInfo(fakeJpeg(4032, 3024, 6)).orientation, 6);
  const { objects } = parse(buildInkPdf({ width: 3024, height: 4032, strokes: [], createdAt: at, photo: { jpeg: fakeJpeg(4032, 3024, 6) } }));
  assert.match(objects.get(5), /\/MediaBox \[0 0 631.5 842\]/);
  assert.match(objects.get(6), /\n0 -842 631.5 0 0 842 cm\n/);
  assert.match(objects.get(7), /\/Width 4032 \/Height 3024 /);
});

test('rejects data that is not a JPEG and invalid page sizes', () => {
  assert.equal(readJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  assert.throws(() => buildInkPdf({ width: 10, height: 10, strokes: [], photo: { jpeg: new Uint8Array(8) } }), TypeError);
  for (const [w, h] of [[0, 10], [10, NaN], [Infinity, 5], [-1, 4]]) assert.throws(() => buildInkPdf({ width: w, height: h, strokes: [] }), RangeError);
});

test('empty stroke list still makes a valid one-page PDF', () => {
  const { objects, size } = parse(buildInkPdf({ width: 640, height: 480, strokes: [] }));
  assert.equal(size, 5);
  assert.doesNotMatch(objects.get(4), /\/Annots/);
});

test('skips NaN and Infinity points and strokes with no valid point', () => {
  const { text } = parse(buildInkPdf({ width: 100, height: 100, createdAt: at, strokes: [
    { points: [[NaN, 1], [10, 10], [Infinity, 3], [20, 20], [30, -Infinity]], color: 'black', width: 1 },
    { points: [[NaN, NaN], [Infinity, 1]], color: 'blue', width: 1 },
    { points: [], color: 'red', width: 1 },
    null,
  ] }));
  const list = annots(text);
  assert.equal(list.length, 1);
  assert.deepEqual(inkList(list[0]), [84.2, 757.8, 168.4, 673.6]);
});

test('single-point strokes become a short visible segment', () => {
  const { text, objects } = parse(buildInkPdf({ width: 842, height: 842, createdAt: at,
    strokes: [{ points: [[50, 50], [50, 50], [50.001, 50]], color: 'black', width: 3 }] }));
  assert.deepEqual(inkList(annots(text)[0]), [50, 792, 50.1, 792]);
  assert.match(objects.get(6), /\n50 792 m\n50.1 792 l\nS\n/);
});

test('numbers have at most two decimals and no exponent, NaN or -0', () => {
  const strokes = [{ points: [[1e-9, 1e-9], [0.000001, 842], [-0.001, 421.123456], [1 / 3, 2 / 3]], color: 'black', width: 1e-7 }];
  const { text } = parse(buildInkPdf({ width: 842, height: 842, strokes, createdAt: at }));
  const body = text.slice(0, text.indexOf('xref\n'));
  assert.doesNotMatch(body, /NaN|Infinity|\d[eE][+-]?\d|(^|[\s[])-0(?![.\d])/);
  for (const n of body.match(/-?\d+\.\d+/g)) assert.ok(n.split('.')[1].length <= 2, n);
});

test('4000 strokes with 200k points build quickly', () => {
  const strokes = Array.from({ length: 4000 }, (_, i) => ({
    color: ['black', 'blue', 'red', 'green'][i % 4], width: 3,
    points: Array.from({ length: 50 }, (_, k) => [(i % 80) * 50 + k * 0.9 + Math.sin(k) * 7, Math.floor(i / 80) * 60 + k * 0.7]),
  }));
  const t = performance.now();
  const pdf = buildInkPdf({ width: 4032, height: 3024, strokes, createdAt: at });
  const ms = performance.now() - t;
  const { size } = parse(pdf);
  assert.equal(size, 4 + 8000 + 1);
  assert.ok(ms < 2000, `${ms}ms`);
  console.log(`ink-pdf perf: ${ms.toFixed(0)}ms, ${(pdf.length / 1048576).toFixed(2)}MB`);
});

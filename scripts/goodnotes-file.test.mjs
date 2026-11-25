import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import {
  // protobuf
  encodeVarint, readVarint, decodeMessage, encodeMessage, pbVarint, pbString, pbBytes, pbMessage, pbFloat32,
  getField, fieldString, fieldVarint, fieldFloat32, fieldMessage, fieldNumber, replaceField, readDelimitedRecords, writeDelimitedRecords,
  bytesEqual, WIRE_GROUP_START, WIRE_GROUP_END,
  // zip
  crc32, readZip, readZipFiles, writeZip, writeZipStored, zipEntryData, zipEntryDataSync, ZIP_DEFLATE, ZIP_STORED,
  // lz4
  appleLz4Encode, appleLz4Decode, lz4CompressBlock, lz4DecompressBlock, lz4LiteralBlock, isAppleLz4, APPLE_LZ4_CHUNK_SIZE,
  // tpl
  encodeTpl, decodeTpl, parseTplSignature, encodeUniformPenTpl, decodeUniformPen, UNIFORM_PEN_SIGNATURE,
  polylineToLinePath, polylineToMidpointQuadPath, renderPenSubpath, polylineHausdorff, toFloat32, float32ToBits, bitsToFloat32,
  // ids
  sha1, toHex, uuidV5, uuidPlus, uuidEven, orderKeyAfter, orderKeys, naturalInkOrderKey, seededInt, ORDER_KEY_ALPHABET,
  // assets
  buildSolidPdf, buildSolidJpeg,
  // page
  readPageItems, pageObjects, writePageItems, strokeInfo, isPlainBallpointStroke, codecStrokeRecords, naturalInkStrokeRecords,
  rewritePageWithStrokes, KIND_STROKE, DJB2_EMPTY,
  // document
  buildGoodnotesDocument, buildGoodnotesFromTemplate, listTemplatePages, fitPhotoToPage, strokesToPage, A4_PT, GOODNOTES_UNITS_PER_PT,
} from '../lib/goodnotes-file.ts';
import { buildInkPdf } from '../lib/ink-pdf.ts';

const here = dirname(fileURLToPath(import.meta.url));
const enc = new TextEncoder();
const hexBytes = h => Uint8Array.from(h.match(/../g).map(x => parseInt(x, 16)));
const latin1 = b => Array.from(b, c => String.fromCharCode(c)).join('');

function pseudoRandom(n, seed = 1) {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i += 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

// ---------------------------------------------------------------------------
// protobuf

test('varint: 경계값 인코딩과 읽기', () => {
  for (const v of [0, 1, 127, 128, 300, 16383, 16384, 2 ** 31, 2 ** 32 + 5, Number.MAX_SAFE_INTEGER]) {
    const b = encodeVarint(v);
    assert.deepEqual(readVarint(b, 0), { value: v, next: b.length });
  }
  assert.deepEqual([...encodeVarint(300)], [0xac, 0x02]);
  assert.throws(() => encodeVarint(-1), /PB_BAD_VARINT_VALUE/);
  assert.throws(() => readVarint(Uint8Array.of(0x80), 0), /PB_TRUNCATED_VARINT/);
});

test('protobuf: 필드 쓰기 → 읽기, 모르는 필드와 group 표시를 바이트 그대로 보존', () => {
  const inner = encodeMessage([pbVarint(1, 1), pbVarint(2, 4294967295)]);
  const msg = encodeMessage([
    pbString(1, 'ABCD-1234'),
    pbBytes(2, Uint8Array.of(1, 2, 3)),
    pbFloat32(4, 0.25),
    pbMessage(7, [pbVarint(1, 5)]),
    pbVarint(99, 12345678901),
    pbBytes(9, inner),
  ]);
  // 손으로 만든 fixed64, group 시작/끝, 비정규 varint(0x80 0x00 = 0)를 덧붙인다.
  const extra = Uint8Array.of(0x29, 1, 2, 3, 4, 5, 6, 7, 8, (10 << 3) | WIRE_GROUP_START, (10 << 3) | WIRE_GROUP_END, 0x58, 0x80, 0x00);
  const all = new Uint8Array(msg.length + extra.length);
  all.set(msg);
  all.set(extra, msg.length);
  const fields = decodeMessage(all);
  assert.equal(fieldString(getField(fields, 1)), 'ABCD-1234');
  assert.equal(fieldFloat32(getField(fields, 4)), 0.25);
  assert.equal(fieldVarint(getField(fields, 99)), 12345678901);
  assert.equal(fieldVarint(getField(fieldMessage(getField(fields, 9)), 2)), 4294967295);
  assert.equal(fieldNumber(getField(fields, 4)), 0.25);
  assert.ok(fields.some(f => f.wireType === WIRE_GROUP_START));
  assert.ok(bytesEqual(encodeMessage(fields), all), '디코드 → 인코드가 원본과 같다');
  const replaced = replaceField(fields, pbString(1, 'NEW'));
  assert.equal(fieldString(getField(decodeMessage(encodeMessage(replaced)), 1)), 'NEW');
  assert.equal(replaced.length, fields.length);
});

test('protobuf: 길이 접두 레코드 스트림 왕복', () => {
  const records = [encodeMessage([pbVarint(1, 1)]), new Uint8Array(0), pseudoRandom(300), encodeMessage([pbString(2, 'x'.repeat(200))])];
  const stream = writeDelimitedRecords(records);
  const back = readDelimitedRecords(stream);
  assert.equal(back.length, records.length);
  back.forEach((r, i) => assert.ok(bytesEqual(r, records[i])));
  assert.throws(() => readDelimitedRecords(Uint8Array.of(5, 1, 2)), /PB_TRUNCATED_RECORD/);
});

// ---------------------------------------------------------------------------
// ZIP

test('crc32: 표준 검사값', () => {
  assert.equal(crc32(enc.encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('ZIP: stored 쓰기 → 읽기, CRC 일치, 한글 이름', async () => {
  const files = [
    { name: 'schema.pb', data: Uint8Array.of(8, 24) },
    { name: 'empty', data: new Uint8Array(0) },
    { name: 'notes/한글.bin', data: pseudoRandom(5000) },
  ];
  const zip = writeZipStored(files);
  const entries = readZip(zip);
  assert.deepEqual(entries.map(e => e.name), files.map(f => f.name));
  for (const [i, e] of entries.entries()) {
    assert.equal(e.method, ZIP_STORED);
    assert.equal(e.crc32, crc32(files[i].data));
    assert.ok(bytesEqual(zipEntryDataSync(e), files[i].data));
    assert.ok(bytesEqual(await zipEntryData(e), files[i].data));
  }
});

test('ZIP: deflate 쓰기 → 읽기, zlib과 교차 확인, 압축 데이터 그대로 복사', async () => {
  const data = enc.encode('goodnotes '.repeat(2000));
  const zip = await writeZip([
    { name: 'a.txt', data, method: ZIP_DEFLATE, date: new Date(Date.UTC(2026, 0, 1)) },
    { name: 'b.bin', data: pseudoRandom(1000), method: ZIP_STORED },
  ]);
  const [a, b] = readZip(zip);
  assert.equal(a.method, ZIP_DEFLATE);
  assert.ok(a.compressedSize < data.length / 10);
  assert.ok(bytesEqual(inflateRawSync(a.compressed), data), 'zlib이 우리 deflate를 푼다');
  assert.equal(a.dosDate, ((2026 - 1980) << 9) | (1 << 5) | 1);
  // zlib이 만든 deflate 멤버를 우리 리더가 푼다
  const zlibData = deflateRawSync(data);
  const copy = await writeZip([{ name: 'a.txt', copy: { ...a, compressed: zlibData, compressedSize: zlibData.length } }, { name: 'b.bin', copy: b }]);
  const files = await readZipFiles(copy);
  assert.ok(bytesEqual(files.get('a.txt'), data));
  assert.ok(bytesEqual(files.get('b.bin'), pseudoRandom(1000)));
  // CRC가 틀리면 오류
  const bad = await writeZip([{ name: 'x', copy: { ...b, crc32: b.crc32 ^ 1 } }]);
  await assert.rejects(zipEntryData(readZip(bad)[0]), /ZIP_CRC_MISMATCH/);
  assert.throws(() => zipEntryDataSync(a), /ZIP_NEEDS_ASYNC_INFLATE/);
});

test('ZIP: 시스템 unzip이 있으면 무결성 검사', { skip: spawnSync('unzip', ['-v']).status !== 0 && 'unzip 없음' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gn-zip-'));
  try {
    const path = join(dir, 't.zip');
    writeFileSync(path, await writeZip([
      { name: 'a.pb', data: pseudoRandom(70000), method: ZIP_DEFLATE },
      { name: 'b/c', data: enc.encode('hello'), method: ZIP_STORED },
    ]));
    const r = spawnSync('unzip', ['-t', path], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /No errors detected/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// LZ4

const LZ4_SAMPLES = {
  empty: new Uint8Array(0),
  one: Uint8Array.of(7),
  twelve: enc.encode('abcdefghijkl'),
  thirteen: enc.encode('aaaaaaaaaaaaa'),
  text: enc.encode('The quick brown fox jumps over the lazy dog. '.repeat(500)),
  zeros: new Uint8Array(100000),
  random: pseudoRandom(50000, 7),
  mixed: (() => {
    const a = pseudoRandom(40000, 3);
    for (let i = 0; i < a.length; i += 100) a.fill(0x41, i, i + 60);
    return a;
  })(),
};

test('LZ4 block: 압축 → 해제 일치, 반복 데이터는 작아진다', () => {
  for (const [name, data] of Object.entries(LZ4_SAMPLES)) {
    const block = lz4CompressBlock(data);
    assert.ok(bytesEqual(lz4DecompressBlock(block, data.length), data), name);
    assert.ok(bytesEqual(lz4DecompressBlock(lz4LiteralBlock(data), data.length), data), `${name} literal`);
  }
  assert.ok(lz4CompressBlock(LZ4_SAMPLES.zeros).length < 500);
  assert.ok(lz4CompressBlock(LZ4_SAMPLES.text).length < 400);
  assert.throws(() => lz4DecompressBlock(Uint8Array.of(0x10, 0x41, 0x00, 0x00), 5), /LZ4_BAD_OFFSET/);
});

test('Apple LZ4 프레임: 세 방식 왕복, 32 KiB 청크, 빈 입력', () => {
  for (const mode of ['lz4', 'literal', 'raw']) {
    for (const [name, data] of Object.entries(LZ4_SAMPLES)) {
      const blob = appleLz4Encode(data, { mode });
      const dec = appleLz4Decode(blob);
      assert.ok(bytesEqual(dec.data, data), `${mode} ${name}`);
      assert.equal(dec.trailing, 0);
      assert.equal(dec.consumed, blob.length);
      assert.equal(dec.chunks.length, Math.ceil(data.length / APPLE_LZ4_CHUNK_SIZE));
      assert.ok(dec.chunks.every(c => c.rawSize <= 32768));
    }
  }
  assert.deepEqual([...appleLz4Encode(new Uint8Array(0))], [...enc.encode('bv4$')]);
  const raw = appleLz4Encode(Uint8Array.of(1, 2, 3), { mode: 'raw' });
  assert.deepEqual([...raw.subarray(0, 8)], [...enc.encode('bv4-'), 3, 0, 0, 0], 'bv4- 헤더는 길이 하나');
  assert.equal(appleLz4Encode(LZ4_SAMPLES.text).slice(0, 4).every((b, i) => b === enc.encode('bv41')[i]), true);
  assert.ok(isAppleLz4(raw));
  assert.throws(() => appleLz4Decode(enc.encode('bv42xxxxxxxx')), /LZ4_BAD_CHUNK_MAGIC/);
  assert.throws(() => appleLz4Decode(appleLz4Encode(LZ4_SAMPLES.text).subarray(0, 20)), /LZ4_TRUNCATED_CHUNK/);
});

test('Apple LZ4: macOS libcompression이 만든 바이트를 푼다(고정 견본)', () => {
  // 이 견본은 compression_encode_buffer(COMPRESSION_LZ4)로 macOS에서 만들었다.
  const abc = hexBytes('6276343128230000a40000003f6162630300ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffbbf06a6361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626361626362763424');
  assert.ok(bytesEqual(appleLz4Decode(abc).data, enc.encode('abc'.repeat(3000))));
  const fox = hexBytes('6276343108070000b9000000ff1e54686520717569636b2062726f776e20666f78206a756d7073206f76657220746865206c617a7920646f672e202d00ffffffffffff4ff0706b2062726f776e20666f78206a756d7073206f76657220746865206c617a7920646f672e2054686520717569636b2062726f776e20666f78206a756d7073206f76657220746865206c617a7920646f672e2054686520717569636b2062726f776e20666f78206a756d7073206f76657220746865206c617a7920646f672e2062763424');
  assert.ok(bytesEqual(appleLz4Decode(fox).data, enc.encode('The quick brown fox jumps over the lazy dog. '.repeat(40))));
  const stored = hexBytes('6276342d18000000dd1db6ccbcc2f2d9afc82a2cd1941f02168f7d6cfe8c3d8562763424');
  const sd = appleLz4Decode(stored);
  assert.equal(toHex(sd.data), 'dd1db6ccbcc2f2d9afc82a2cd1941f02168f7d6cfe8c3d85');
  assert.deepEqual(sd.chunks, [{ kind: 'bv4-', rawSize: 24, storedSize: 24 }]);
});

// GOODNOTES_APPLE_LZ4=<applelz4 실행 파일>을 주면 libcompression과 양방향 교차 검증을 한다.
// 실행 파일은 Swift로 compression_encode_buffer/compression_decode_buffer(COMPRESSION_LZ4)를 부르는 작은 도구다.
const appleTool = process.env.GOODNOTES_APPLE_LZ4;
test('Apple LZ4: libcompression 교차 검증(선택)', { skip: !appleTool && 'GOODNOTES_APPLE_LZ4 미설정' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gn-lz4-'));
  try {
    let checked = 0;
    const samples = { ...LZ4_SAMPLES, big: pseudoRandom(200000, 11), tpl: encodeUniformPenTpl({ width: 2, subpaths: [polylineToLinePath(Array.from({ length: 2000 }, (_, i) => [i, Math.sin(i / 9) * 100]))] }) };
    for (const [name, data] of Object.entries(samples)) {
      for (const mode of ['lz4', 'literal', 'raw']) {
        for (const chunkSize of [32768, 65536]) {
          const ours = join(dir, `${name}-${mode}-${chunkSize}.lz4`);
          const back = join(dir, `${name}-${mode}-${chunkSize}.out`);
          writeFileSync(ours, appleLz4Encode(data, { mode, chunkSize }));
          const r = spawnSync(appleTool, ['decode', ours, back, String(data.length)], { encoding: 'utf8' });
          if (data.length === 0) {
            // libcompression은 빈 출력에 0을 돌려주므로 도구가 실패로 처리할 수 있다. 빈 입력은 bv4$ 하나라 Apple 출력과 같다.
            continue;
          }
          assert.equal(r.status, 0, `${name} ${mode} ${chunkSize}: ${r.stderr}`);
          assert.ok(bytesEqual(new Uint8Array(readFileSync(back)), data), `Apple이 우리 ${mode} 프레임을 원본으로 푼다: ${name} ${chunkSize}`);
          checked += 1;
        }
      }
      if (data.length === 0) continue;
      const src = join(dir, `${name}.bin`);
      const apple = join(dir, `${name}.apple`);
      writeFileSync(src, data);
      const r = spawnSync(appleTool, ['encode', src, apple], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(bytesEqual(appleLz4Decode(new Uint8Array(readFileSync(apple))).data, data), `우리 해제기가 Apple 프레임을 푼다: ${name}`);
      checked += 1;
    }
    assert.ok(checked > 40);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// tpl

test('tpl: 일반 시그니처 쓰기 → 읽기, f 크기 자동 판정', () => {
  const values = [3, 0xdeadbeef, [1, 2, 3], [[1, 2], [3, 4]], -5, [1.5, -2.25]];
  for (const floatSize of [4, 8]) {
    const raw = encodeTpl({ signature: 'vuA(v)A(S(uu))jA(f)', values, floatSize });
    assert.equal(new DataView(raw.buffer).getUint32(4, true), raw.length);
    const img = decodeTpl(raw);
    assert.equal(img.floatSize, floatSize, '전체 길이가 맞는 쪽을 고른다');
    assert.deepEqual(img.values, values);
    assert.equal(img.signature, 'vuA(v)A(S(uu))jA(f)');
  }
  // A(f)가 비면 두 해석이 같고 4를 고른다
  assert.equal(decodeTpl(encodeTpl({ signature: 'vA(f)', values: [1, []], floatSize: 8 })).floatSize, 4);
  assert.throws(() => parseTplSignature('vA(x)'), /TPL_UNSUPPORTED_TYPE/);
  assert.throws(() => decodeTpl(enc.encode('tpm\0')), /TPL_BAD_MAGIC/);
  const raw = encodeTpl({ signature: 'v', values: [1] });
  const broken = new Uint8Array(raw.length + 1);
  broken.set(raw);
  assert.throws(() => decodeTpl(broken), /TPL_LENGTH_MISMATCH/);
});

test('tpl 볼펜: 인코딩 → 디코딩, 레이아웃 바이트', () => {
  const subpaths = [polylineToLinePath([[10, 20], [30.5, 40.25], [50, 10]], 'start')];
  const raw = encodeUniformPenTpl({ width: 2.5, subpaths });
  const img = decodeTpl(raw);
  assert.equal(img.signature, UNIFORM_PEN_SIGNATURE);
  const pen = decodeUniformPen(img);
  assert.equal(pen.version, 2);
  assert.equal(pen.trailer, 1);
  assert.deepEqual(pen.widthSamples, []);
  assert.equal(pen.width, 2.5);
  assert.deepEqual(pen.subpaths, [{ move: [10, 20], quads: [[10, 20, 30.5, 40.25], [30.5, 40.25, 50, 10]] }]);
  // natural-ink 테스트와 같은 확인: 원시 바이트에 (x0, y0, x1, y1) float32 묶음이 그대로 있다
  const dv = new DataView(new ArrayBuffer(16));
  [10, 20, 30.5, 40.25].forEach((v, i) => dv.setFloat32(i * 4, v, true));
  assert.ok(latin1(raw).includes(latin1(new Uint8Array(dv.buffer))));
  // 레이아웃: "tpl\0" + 길이 + 시그니처 + v(2) u(width) A(v)=[0,1,1] ...
  const sigEnd = 8 + UNIFORM_PEN_SIGNATURE.length + 1;
  const v = new DataView(raw.buffer, raw.byteOffset);
  assert.equal(v.getUint16(sigEnd, true), 2);
  assert.equal(v.getFloat32(sigEnd + 2, true), 2.5);
  assert.equal(v.getUint32(sigEnd + 6, true), 3);
  assert.deepEqual([v.getUint16(sigEnd + 10, true), v.getUint16(sigEnd + 12, true), v.getUint16(sigEnd + 14, true)], [0, 1, 1]);
  assert.equal(v.getUint16(raw.length - 6, true), 1, '끝의 v = 1');
  assert.equal(v.getUint32(raw.length - 4, true), 0, '끝의 A(f) 개수 0');
});

const ZIGZAG = [[20, 30], [60, 90], [100, 30], [140, 90], [180, 30], [181, 31.5], [260, 200]];

test('폴리라인 → 직선 경로: 되돌려 그리면 원래 폴리라인과 같다(두 제어점 방식)', () => {
  for (const control of ['start', 'midpoint']) {
    const sp = polylineToLinePath(ZIGZAG, control);
    const pen = decodeUniformPen(decodeTpl(encodeUniformPenTpl({ width: 1, subpaths: [sp] })));
    const drawn = renderPenSubpath(pen.subpaths[0], 8);
    assert.ok(polylineHausdorff(drawn, ZIGZAG) < 1e-4, `${control}: ${polylineHausdorff(drawn, ZIGZAG)}`);
  }
  const dot = polylineToLinePath([[5, 5], [5, 5]]);
  assert.deepEqual(dot, { move: [5, 5], quads: [[5, 5, 5.001, 5]] }, '점 하나는 0.001 길이 구간(natural-ink 방식)');
  assert.throws(() => polylineToLinePath([]), /PATH_EMPTY_POLYLINE/);
});

test('폴리라인 → 중점 2차 Bézier: 중점 규칙을 지키고 오차가 허용치 이하', () => {
  for (const tolerance of [0.05, 0.25, 1]) {
    const sp = polylineToMidpointQuadPath(ZIGZAG, tolerance);
    // 각 끝점은 이 구간 제어점과 다음 구간 제어점의 중점(마지막은 자기 자신)
    sp.quads.forEach((q, k) => {
      const next = sp.quads[k + 1] ?? q;
      assert.ok(Math.abs(q[2] - (q[0] + next[0]) / 2) < 1e-9 && Math.abs(q[3] - (q[1] + next[1]) / 2) < 1e-9, `중점 규칙 ${k}`);
    });
    const drawn = renderPenSubpath(sp, 32);
    const err = polylineHausdorff(drawn, ZIGZAG);
    assert.ok(err <= tolerance * 1.001 + 1e-9, `tolerance ${tolerance}: error ${err}`);
    assert.ok(err > tolerance * 0.3, '모서리는 실제로 둥글다(허용치를 쓰고 있다)');
  }
});

test('float32 비트 변환', () => {
  assert.equal(float32ToBits(1), 0x3f800000);
  assert.equal(bitsToFloat32(0x3f800000), 1);
  assert.equal(toFloat32(0.1), Math.fround(0.1));
});

// ---------------------------------------------------------------------------
// 식별자

test('SHA-1, UUIDv5, UUID 덧셈, 시드 정수', () => {
  assert.equal(toHex(sha1(enc.encode('abc'))), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(toHex(sha1(new Uint8Array(0))), 'da39a3ee5e6b4b0d3255bfef95601890afd80709');
  assert.equal(toHex(sha1(new Uint8Array(1000).fill(97))), '291e9a6c66994949b57ba5e650361e98fc36b1ba');
  // Python: str(uuid.uuid5(uuid.NAMESPACE_URL, 'natural-ink:abc:document')).upper()
  assert.equal(uuidV5('natural-ink:abc:document'), '8E4EF6BD-7AE2-56C6-AA99-4A05BA7C8362');
  assert.equal(uuidPlus('00000000-0000-0000-0000-0000000000FF'), '00000000-0000-0000-0000-000000000100');
  assert.equal(uuidPlus('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'), '00000000-0000-0000-0000-000000000000');
  assert.equal(uuidEven('8E4EF6BD-7AE2-56C6-AA99-4A05BA7C8363'), '8E4EF6BD-7AE2-56C6-AA99-4A05BA7C8362');
  for (const bits of [8, 32, 48, 53]) {
    const v = seededInt('seed', 'x', bits);
    assert.ok(Number.isSafeInteger(v) && v >= 0 && v < 2 ** bits);
  }
  assert.equal(seededInt('a', 'b', 32), seededInt('a', 'b', 32));
  assert.notEqual(seededInt('a', 'b', 32), seededInt('a', 'c', 32));
});

test('페이지 순서 키: codec PR #16 규칙', () => {
  assert.deepEqual(orderKeys(4), ['40', '41', '42', '43']);
  assert.equal(orderKeyAfter('4~'), '5-');
  assert.equal(orderKeyAfter('~~'), '~~' + ORDER_KEY_ALPHABET[33]);
  const keys = orderKeys(500);
  for (let i = 1; i < keys.length; i += 1) assert.ok(keys[i - 1] < keys[i], `${keys[i - 1]} < ${keys[i]}`);
  assert.ok(keys.every(k => k[0] !== '~'));
  assert.equal(naturalInkOrderKey(12), 'A000012');
});

// ---------------------------------------------------------------------------
// 부속 파일

test('단색 PDF: xref 오프셋과 MediaBox, 안내선', () => {
  const pdf = buildSolidPdf({ width: 595.28, height: 841.89, color: [1, 1, 0.9], guides: [{ points: [[10, 20], [30, 40]], width: 2, color: [0.8, 0.8, 0.8] }] });
  const text = latin1(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(text, /10 821\.89 m 30 801\.89 l S/, 'y를 뒤집어 그린다');
  const xrefAt = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 5), 'xref\n');
  const rows = text.slice(xrefAt).split('\n').slice(3, 7);
  rows.forEach((row, i) => {
    const off = Number(row.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
  const len = Number(/\/Length (\d+)/.exec(text)[1]);
  const start = text.indexOf('stream\n') + 7;
  assert.equal(text.slice(start + len, start + len + 9), 'endstream');
});

test('단색 JPEG: 마커 구조와 크기', () => {
  const jpg = buildSolidJpeg(61, 85, 255);
  assert.deepEqual([...jpg.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...jpg.subarray(-2)], [0xff, 0xd9]);
  const sof = latin1(jpg).indexOf('\xff\xc0');
  assert.ok(sof > 0);
  assert.equal((jpg[sof + 5] << 8) | jpg[sof + 6], 85);
  assert.equal((jpg[sof + 7] << 8) | jpg[sof + 8], 61);
  assert.throws(() => buildSolidJpeg(0, 10), /JPEG_BAD_SIZE/);
});

test('단색 JPEG: macOS sips가 읽는다(있으면)', { skip: process.platform !== 'darwin' && 'macOS 아님' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gn-jpg-'));
  try {
    for (const [w, h, g] of [[61, 85, 255], [20, 9, 128], [16, 16, 30]]) {
      const p = join(dir, `${w}x${h}.jpg`);
      writeFileSync(p, buildSolidJpeg(w, h, g));
      const r = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, new RegExp(`pixelWidth: ${w}\\b`));
      assert.match(r.stdout, new RegExp(`pixelHeight: ${h}\\b`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 문서 생성(주 경로)

const STROKES = [
  { points: ZIGZAG, color: [0, 0, 0], width: 1.5 },
  { points: [[300, 300], [320, 310], [340, 300]], color: [0.1, 0.2, 0.9, 1], width: 3 },
  { points: [[400, 500]], color: [1, 0, 0], width: 4 },
  { points: [[50, 600], [250, 600]], color: [1, 1, 0, 0.5], width: 12, highlighter: true },
];

async function buildAndRead(profile, extra = {}) {
  const bytes = await buildGoodnotesDocument({
    title: '시험 문서',
    profile,
    idSeed: 'test-seed',
    createdAt: new Date(Date.UTC(2026, 10, 26, 1, 2, 3)),
    pages: [
      { width: A4_PT.width, height: A4_PT.height, strokes: STROKES },
      { width: A4_PT.width, height: A4_PT.height, strokes: [] },
    ],
    ...extra,
  });
  const entries = readZip(bytes);
  const files = await readZipFiles(bytes);
  return { bytes, entries, files };
}

function events(files) {
  return readDelimitedRecords(files.get('index.events.pb')).map(r => {
    const f = decodeMessage(r);
    const other = f.find(x => x.number !== 1);
    return { target: fieldString(getField(f, 1)), kind: other.number, body: fieldMessage(other) };
  });
}

function checkStrokes(files, pages, profile) {
  const noteFiles = pages.map(p => files.get(`notes/${p.noteId}`));
  const objects = pageObjects(noteFiles[0]);
  assert.equal(objects.length, STROKES.length);
  assert.equal(pageObjects(noteFiles[1]).length, 0);
  assert.equal(noteFiles[1].length, 0, '빈 페이지의 notes 파일은 비어 있다');
  const ids = new Set();
  objects.forEach((obj, i) => {
    const input = STROKES[i];
    assert.equal(obj.kind, KIND_STROKE);
    assert.ok(obj.meta, '메타 레코드가 짝지어진다');
    assert.ok(!ids.has(obj.id));
    ids.add(obj.id);
    assert.match(obj.id, /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/);
    assert.equal(fieldString(getField(obj.meta, 1)), obj.id);
    assert.equal(fieldVarint(getField(obj.meta, 16)), 24);
    assert.equal(fieldVarint(getField(obj.body, 21)), 24);
    assert.equal(fieldVarint(getField(obj.meta, 14)), profile === 'codec' ? DJB2_EMPTY : 1);
    assert.equal(getField(obj.meta, 3), undefined, '지움 표시 없음');
    assert.equal(getField(obj.body, 3), undefined, '볼펜은 펜 종류 f3을 쓰지 않는다');
    for (const n of [6, 9, 20]) assert.equal(getField(obj.body, n).data.length, 0, `본문 f${n}은 빈 bytes`);
    assert.equal(fieldVarint(getField(obj.body, 5)), input.highlighter ? 1 : undefined);
    const info = strokeInfo(obj);
    assert.equal(info.signature, UNIFORM_PEN_SIGNATURE);
    const want = input.color.length === 3 ? [...input.color, 1] : input.color;
    info.color.forEach((c, k) => assert.equal(c, Math.fround(want[k])));
    const colorFields = fieldMessage(getField(obj.body, 4));
    assert.equal(colorFields.length, profile === 'codec' ? want.filter(v => v !== 0).length : 4, '색 채널 생략 규칙');
    const blob = getField(obj.body, 2).data;
    const dec = appleLz4Decode(blob);
    assert.equal(dec.trailing, 0);
    assert.ok(dec.chunks.every(c => c.kind === 'bv41'));
    const pen = decodeUniformPen(decodeTpl(dec.data));
    assert.equal(pen.width, Math.fround(input.width));
    assert.equal(pen.version, 2);
    const drawn = renderPenSubpath(pen.subpaths[0]);
    const expected = input.points.length === 1 ? [input.points[0], [input.points[0][0] + 0.001, input.points[0][1]]] : input.points;
    assert.ok(polylineHausdorff(drawn, expected) < 1e-3);
    const q = pen.subpaths[0].quads[0];
    const [x0, y0] = pen.subpaths[0].move;
    if (profile === 'natural-ink') assert.deepEqual([q[0], q[1]], [x0, y0], '제어점 = 시작점');
    else assert.ok(Math.abs(q[0] - (x0 + q[2]) / 2) < 1e-3, '제어점 = 중점');
  });
  return objects;
}

test('buildGoodnotesDocument codec 프로필: 멤버, 색인, 이벤트, 획 필드', async () => {
  const { bytes, entries, files } = await buildAndRead('codec');
  assert.deepEqual(entries.slice(0, 5).map(e => e.name), ['schema.pb', 'document.info.pb', 'index.notes.pb', 'index.attachments.pb', 'index.events.pb']);
  assert.ok(entries.every(e => e.method === ZIP_DEFLATE));
  assert.ok(!files.has('thumbnail.jpg') && !files.has('index.search.pb'));
  assert.ok(bytesEqual(files.get('schema.pb'), Uint8Array.of(0x08, 0x18)));
  assert.equal(files.get('document.info.pb').length, 0);
  const ev = events(files);
  const doc = ev.find(e => e.kind === 30);
  assert.equal(fieldString(getField(fieldMessage(getField(doc.body, 2)), 1)), '시험 문서');
  assert.deepEqual(doc.body.map(f => f.number), [...doc.body.map(f => f.number)].sort((a, b) => a - b), '문서 이벤트 필드는 번호순');
  const att = ev.filter(e => e.kind === 6);
  assert.equal(att.length, 1, '같은 배경은 첨부 하나를 공유한다');
  const attId = att[0].target;
  const pdf = files.get(`attachments/${attId}`);
  assert.equal(fieldVarint(getField(att[0].body, 5)), pdf.length);
  assert.match(latin1(pdf), /\/MediaBox \[0 0 324\.696 459\.213\]/, '배경 PDF는 페이지의 6/11');
  const range = fieldMessage(getField(att[0].body, 12));
  assert.deepEqual([fieldVarint(getField(range, 1)), fieldVarint(getField(range, 2))], [1, 1]);
  assert.ok(ev.some(e => e.kind === 105 && e.target === attId), '첨부 검색 색인 이벤트');
  const layer = ev.find(e => e.kind === 2);
  const size = fieldMessage(getField(layer.body, 8));
  assert.equal(fieldFloat32(getField(size, 1)), Math.fround(A4_PT.width));
  assert.equal(fieldString(getField(layer.body, 4)), attId);
  const pages = listTemplatePages({ notesIndex: files.get('index.notes.pb'), events: files.get('index.events.pb'), names: entries.map(e => e.name) });
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map(p => p.orderKey), ['40', '41']);
  for (const p of pages) assert.equal(uuidPlus(p.pageId, 1), p.noteId, 'notes ID = 페이지 ID + 1');
  const notesIdx = readDelimitedRecords(files.get('index.notes.pb')).map(r => fieldString(getField(decodeMessage(r), 2)));
  assert.deepEqual(notesIdx, pages.map(p => `notes/${p.noteId}`));
  const attIdx = readDelimitedRecords(files.get('index.attachments.pb')).map(r => fieldString(getField(decodeMessage(r), 2)));
  assert.deepEqual(attIdx, [`attachments/${attId}`]);
  // notes 이벤트: 페이지마다 105/104/102, 획이 있는 페이지는 버전이 붙은 세트가 하나 더
  for (const [i, p] of pages.entries()) {
    const own = ev.filter(e => e.target === p.noteId);
    assert.deepEqual(own.map(e => e.kind), i === 0 ? [105, 104, 102, 105, 104, 102] : [105, 104, 102]);
  }
  const objects = checkStrokes(files, pages, 'codec');
  const devices = new Set(objects.map(o => fieldVarint(getField(o.meta, 8))));
  assert.equal(devices.size, 1);
  assert.deepEqual(objects.map(o => fieldVarint(getField(o.meta, 9))), [1, 2, 3, 4]);
  for (const o of objects) {
    const stamp = fieldMessage(getField(o.meta, 2));
    assert.equal(fieldVarint(getField(stamp, 1)), 1);
    assert.ok(bytesEqual(getField(o.body, 15).data, getField(o.meta, 2).data), '본문 f15 = 메타 도장');
  }
  // 같은 시드는 같은 바이트
  const again = await buildAndRead('codec');
  assert.ok(bytesEqual(bytes, again.bytes));
});

test('buildGoodnotesDocument natural-ink 프로필: 멤버, 이벤트, 획 필드', async () => {
  const { entries, files } = await buildAndRead('natural-ink');
  const names = entries.map(e => e.name);
  assert.deepEqual(names, [...names].sort(), '이름순');
  for (const n of ['schema.pb', 'document.info.pb', 'index.search.pb', 'index.notes.pb', 'index.attachments.pb', 'index.events.pb', 'thumbnail.jpg']) assert.ok(files.has(n), n);
  assert.ok(entries.every(e => e.dosDate === (((2026 - 1980) << 9) | (1 << 5) | 1) && e.dosTime === 0), 'ZIP 시각 2026-01-01 고정');
  const ev = events(files);
  assert.deepEqual(ev.map(e => e.kind), [30, 6, 2, 54, 6, 2, 54]);
  const att = ev.filter(e => e.kind === 6);
  for (const a of att) {
    const pdf = files.get(`attachments/${a.target}`);
    assert.match(latin1(pdf), /\/MediaBox \[0 0 595\.276 841\.89\]/, '배경 PDF는 페이지와 같은 크기');
    assert.equal(fieldVarint(getField(a.body, 5)), pdf.length);
  }
  const pages = listTemplatePages({ notesIndex: files.get('index.notes.pb'), events: files.get('index.events.pb'), names });
  assert.deepEqual(pages.map(p => p.orderKey), ['A000000', 'A000001']);
  assert.ok(pages.every(p => p.pageId.endsWith('0') || /[02468ACE]$/.test(p.pageId)), '페이지 ID 마지막 비트 0');
  const objects = checkStrokes(files, pages, 'natural-ink');
  assert.deepEqual(objects.map(o => fieldVarint(getField(o.meta, 9))), [1, 2, 3, 4]);
  assert.deepEqual(objects.map(o => fieldVarint(getField(o.meta, 8))), [1, 1, 1, 1]);
  const thumb = files.get('thumbnail.jpg');
  assert.deepEqual([...thumb.subarray(0, 2)], [0xff, 0xd8]);
});

test('buildGoodnotesDocument: backgroundPdf를 첨부로 그대로 넣는다(ink-pdf 사진 PDF)', async () => {
  // ink-pdf.ts가 만든 PDF를 배경으로 쓴다. 사진 쪽은 2쪽이므로 backgroundPdfPage 2를 지정한다.
  const jpeg = buildSolidJpeg(40, 30, 200);
  const photoPdf = buildInkPdf({ width: 40, height: 30, strokes: [], photo: { jpeg }, createdAt: new Date(Date.UTC(2026, 0, 1)) });
  for (const profile of ['codec', 'natural-ink']) {
    const bytes = await buildGoodnotesDocument({
      title: 'bg',
      profile,
      idSeed: 'bg',
      pages: [
        { width: 400, height: 300, strokes: [] },
        { width: 400, height: 300, strokes: [{ points: [[1, 1], [2, 2]], color: [0, 0, 0], width: 1 }], backgroundPdf: photoPdf, backgroundPdfPage: 2 },
      ],
    });
    const files = await readZipFiles(bytes);
    const ev = events(files);
    const att = ev.filter(e => e.kind === 6);
    assert.equal(att.length, 2);
    const photoAtt = att.find(a => bytesEqual(files.get(`attachments/${a.target}`), photoPdf));
    assert.ok(photoAtt, `${profile}: 사진 PDF가 바이트 그대로 들어간다`);
    const layer = ev.find(e => e.kind === 2 && fieldString(getField(e.body, 4)) === photoAtt.target);
    assert.equal(fieldVarint(getField(layer.body, 5)), 2, 'PDF 쪽 번호');
    if (profile === 'codec') assert.equal(fieldVarint(getField(fieldMessage(getField(photoAtt.body, 12)), 2)), 2, 'pageRange 쪽 수');
  }
  await assert.rejects(buildGoodnotesDocument({ title: 'x', pages: [{ width: 1, height: 1, strokes: [], backgroundPdf: Uint8Array.of(1, 2, 3, 4) }] }), /GOODNOTES_BACKGROUND_NOT_PDF/);
});

test('buildGoodnotesDocument: 입력 검증', async () => {
  await assert.rejects(buildGoodnotesDocument({ title: 'x', pages: [] }), /GOODNOTES_NO_PAGES/);
  await assert.rejects(buildGoodnotesDocument({ title: 'x', pages: [{ width: 0, height: 1, strokes: [] }] }), /GOODNOTES_BAD_PAGE_SIZE/);
  await assert.rejects(buildGoodnotesDocument({ title: 'x', pages: [{ width: 1, height: 1, strokes: [{ points: [], color: [0, 0, 0], width: 1 }] }] }), /GOODNOTES_EMPTY_STROKE/);
  await assert.rejects(buildGoodnotesDocument({ title: 'x', pages: [{ width: 1, height: 1, strokes: [{ points: [[0, NaN]], color: [0, 0, 0], width: 1 }] }] }), /GOODNOTES_BAD_POINT/);
  await assert.rejects(buildGoodnotesDocument({ title: 'x', pages: [{ width: 1, height: 1, strokes: [{ points: [[0, 0]], color: [2, 0, 0], width: 1 }] }] }), /STROKE_BAD_COLOR/);
});

test('goodnotes-inspect: 생성한 두 프로필 파일을 오류 없이 출력한다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gn-inspect-'));
  try {
    for (const profile of ['codec', 'natural-ink']) {
      const path = join(dir, `${profile}.goodnotes`);
      writeFileSync(path, (await buildAndRead(profile)).bytes);
      const before = readFileSync(path);
      const r = spawnSync(process.execPath, [join(here, 'goodnotes-inspect.mjs'), path, '--records', '0'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /tpl signature=vuA\(v\)A\(S\(uu\)\)A\(S\(uuuu\)\)vA\(f\)/);
      assert.match(r.stdout, /ballpoint version=2 width=1\.5 subpaths=1 quads=6/);
      assert.match(r.stdout, /objects=4 kinds=\{"7":4\} deleted=0 unpaired=0/);
      assert.match(r.stdout, /0: notes\/\S+ page=\S+ key=(40|A000000) size=595\.27\d*x841\.88\d*/);
      assert.doesNotMatch(r.stdout + r.stderr, /failed|Error/);
      assert.ok(bytesEqual(new Uint8Array(readFileSync(path)), new Uint8Array(before)), '읽기 전용');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 견본 방식(보조 경로)

/** 테스트용 가짜 견본: 볼펜 획 1개(모르는 필드 f99 포함), 텍스트 객체 1개, 짝 없는 레코드 1개, 지운 획 1개 */
async function syntheticTemplate({ withExemplar = true } = {}) {
  const docId = 'D0C00000-0000-4000-8000-0000000000AA';
  const pageId = 'AAAAAAAA-0000-4000-8000-000000000010';
  const noteId = uuidPlus(pageId, 1);
  const layerId = 'BBBBBBBB-0000-4000-8000-000000000020';
  const records = [];
  if (withExemplar) {
    const blob = appleLz4Encode(encodeUniformPenTpl({ width: 1.5, subpaths: [polylineToLinePath([[1, 2], [3, 4]], 'midpoint')] }));
    const [meta, body] = codecStrokeRecords({ id: 'EEEEEEEE-0000-4000-8000-000000000001', blob, color: [0, 0, 0, 1], device: 777, sequence: 41, tag: 5, tag2: 6 });
    const metaWithUnknown = encodeMessage([...decodeMessage(meta), pbVarint(99, 4242), pbBytes(20, enc.encode('group'))]);
    records.push(metaWithUnknown, body);
  }
  // 텍스트(21) 객체
  records.push(encodeMessage([pbString(1, 'TTTTTTTT-0000-4000-8000-000000000002'), pbVarint(9, 42), pbVarint(16, 24)]));
  records.push(encodeMessage([pbMessage(21, [pbString(1, 'TTTTTTTT-0000-4000-8000-000000000002'), pbVarint(5, 1)])]));
  // 짝 없는 레코드
  records.push(encodeMessage([pbVarint(77, 1)]));
  // 지운 획
  const [dm, db] = codecStrokeRecords({ id: 'DDDDDDDD-0000-4000-8000-000000000003', blob: appleLz4Encode(encodeUniformPenTpl({ width: 1, subpaths: [polylineToLinePath([[0, 0], [1, 1]])] })), color: [1, 0, 0, 1], device: 777, sequence: 43, tag: 1, tag2: 2 });
  records.push(encodeMessage([...decodeMessage(dm), pbVarint(3, 1)]), db);
  const page = writeDelimitedRecords(records);
  const events = writeDelimitedRecords([
    encodeMessage([pbString(1, docId), pbMessage(30, [pbString(1, docId)])]),
    encodeMessage([pbString(1, layerId), pbMessage(2, [pbString(1, docId), pbString(2, layerId), pbMessage(8, [pbFloat32(1, 1091.34), pbFloat32(2, 1543.47)])])]),
    encodeMessage([pbString(1, pageId), pbMessage(54, [pbString(1, docId), pbString(2, pageId), pbMessage(3, [pbString(1, layerId)]), pbMessage(4, [pbString(1, '40')])])]),
  ]);
  const zip = await writeZip([
    { name: 'schema.pb', data: Uint8Array.of(8, 24), method: ZIP_STORED },
    { name: 'index.notes.pb', data: writeDelimitedRecords([encodeMessage([pbString(1, noteId), pbString(2, `notes/${noteId}`)])]), method: ZIP_DEFLATE },
    { name: 'index.events.pb', data: events, method: ZIP_DEFLATE },
    { name: `notes/${noteId}`, data: page, method: ZIP_DEFLATE },
    { name: 'attachments/XYZ', data: pseudoRandom(3000), method: ZIP_DEFLATE },
    { name: 'thumbnail.jpg', data: buildSolidJpeg(8, 8), method: ZIP_STORED },
  ]);
  return { zip, noteId, pageId, page };
}

test('buildGoodnotesFromTemplate: 기존 획 유지, 새 획 추가, 견본 필드 보존, 다른 멤버 그대로', async () => {
  const { zip, noteId, page } = await syntheticTemplate();
  const strokes = [
    { points: [[100, 100], [200, 150], [300, 100]], color: [0, 0, 1], width: 2.75 },
    { points: [[10, 10]], color: [0, 0.5, 0, 1], width: 5 },
  ];
  const result = await buildGoodnotesFromTemplate({ template: zip, pageStrokes: strokes, idSeed: 'tpl', createdAt: new Date(Date.UTC(2026, 0, 2)) });
  assert.equal(result.exemplarId, 'EEEEEEEE-0000-4000-8000-000000000001');
  assert.equal(result.page.noteId, noteId);
  assert.deepEqual(result.page.size, { width: Math.fround(1091.34), height: Math.fround(1543.47) });
  const before = readZip(zip);
  const after = readZip(result.bytes);
  assert.deepEqual(after.map(e => e.name), before.map(e => e.name), '멤버 순서 유지');
  for (const name of ['schema.pb', 'index.notes.pb', 'attachments/XYZ', 'thumbnail.jpg']) {
    const a = before.find(e => e.name === name);
    const b = after.find(e => e.name === name);
    assert.ok(bytesEqual(a.compressed, b.compressed) && a.crc32 === b.crc32, `${name} 바이트 그대로`);
  }
  const files = await readZipFiles(result.bytes);
  const newPage = files.get(`notes/${noteId}`);
  assert.ok(bytesEqual(newPage.subarray(0, page.length), page), '기존 레코드는 앞부분에 바이트 그대로');
  const items = readPageItems(newPage);
  assert.equal(items.filter(i => i.type === 'record').length, 1, '짝 없는 레코드 보존');
  const objs = items.filter(i => i.type === 'object').map(i => i.object);
  assert.equal(objs.length, 5);
  assert.equal(new Set(objs.map(o => o.id)).size, 5, 'UUID 중복 없음');
  const added = objs.slice(3);
  assert.deepEqual(added.map(o => o.id), result.strokeIds);
  added.forEach((o, i) => {
    assert.ok(isPlainBallpointStroke(o));
    assert.equal(fieldVarint(getField(o.meta, 99)), 4242, '견본의 모르는 필드 유지');
    assert.equal(fieldString(getField(o.meta, 20)), 'group');
    assert.equal(fieldVarint(getField(o.meta, 8)), 777, '견본 장치 ID 유지');
    assert.equal(fieldVarint(getField(o.meta, 9)), 44 + i, '생성 순번은 기존 최대 다음');
    const info = strokeInfo(o);
    const want = strokes[i].color.length === 3 ? [...strokes[i].color, 1] : strokes[i].color;
    info.color.forEach((c, k) => assert.equal(c, Math.fround(want[k])));
    const pen = decodeUniformPen(decodeTpl(appleLz4Decode(getField(o.body, 2).data).data));
    assert.equal(pen.width, Math.fround(strokes[i].width));
  });
  // notes 버전 이벤트 세 개가 덧붙는다
  const ev = readDelimitedRecords(files.get('index.events.pb'));
  assert.equal(ev.length, 3 + 3);
  const kinds = ev.slice(3).map(r => decodeMessage(r).find(f => f.number !== 1).number);
  assert.deepEqual(kinds, [105, 104, 102]);
});

test('buildGoodnotesFromTemplate: 기존 획 지움 표시와 빼기, 본보기 없는 견본', async () => {
  const { zip, noteId } = await syntheticTemplate();
  const stroke = [{ points: [[1, 1], [5, 5]], color: [0, 0, 0], width: 1 }];
  const tomb = await buildGoodnotesFromTemplate({ template: zip, pageStrokes: stroke, existingStrokes: 'tombstone', idSeed: 'a' });
  const tObjs = pageObjects((await readZipFiles(tomb.bytes)).get(`notes/${noteId}`));
  assert.deepEqual(tObjs.map(o => [o.kind, o.deleted]), [[7, true], [21, false], [7, true], [7, false]]);
  const drop = await buildGoodnotesFromTemplate({ template: zip, pageStrokes: stroke, existingStrokes: 'drop', idSeed: 'a' });
  const dObjs = pageObjects((await readZipFiles(drop.bytes)).get(`notes/${noteId}`));
  assert.deepEqual(dObjs.map(o => o.kind), [21, 7]);
  const bare = await syntheticTemplate({ withExemplar: false });
  const r = await buildGoodnotesFromTemplate({ template: bare.zip, pageStrokes: stroke, idSeed: 'b' });
  assert.equal(r.exemplarId, null, '지운 획은 본보기로 쓰지 않는다');
  const o = pageObjects((await readZipFiles(r.bytes)).get(`notes/${bare.noteId}`)).at(-1);
  assert.equal(fieldVarint(getField(o.meta, 14)), DJB2_EMPTY, 'codec 방식 레코드로 만든다');
  assert.equal(fieldVarint(getField(o.meta, 8)), 777, '견본의 장치 ID를 쓴다');
  await assert.rejects(buildGoodnotesFromTemplate({ template: writeZipStored([{ name: 'a', data: new Uint8Array(1) }]), pageStrokes: stroke }), /TEMPLATE_NOT_GOODNOTES/);
  await assert.rejects(buildGoodnotesFromTemplate({ template: zip, pageStrokes: stroke, pageIndex: 3 }), /TEMPLATE_PAGE_OUT_OF_RANGE/);
});

test('rewritePageWithStrokes keep: 원래 바이트 + 새 레코드, writePageItems 왕복', () => {
  const [m, b] = naturalInkStrokeRecords({ id: 'A', blob: appleLz4Encode(Uint8Array.of(1)), color: [0, 0, 0, 1], counter: 1 });
  const page = writeDelimitedRecords([m, b]);
  assert.ok(bytesEqual(writePageItems(readPageItems(page)), page));
  const out = rewritePageWithStrokes(page, [m, b]);
  assert.equal(readDelimitedRecords(out).length, 4);
});

// ---------------------------------------------------------------------------
// 좌표 변환

test('fitPhotoToPage: 왼쪽 위 정렬 기본, 가운데 정렬, 굵기 배율', () => {
  const t = fitPhotoToPage({ width: 4000, height: 3000 }, { width: 595.28, height: 841.89 });
  assert.equal(t.offsetX, 0);
  assert.equal(t.offsetY, 0);
  assert.ok(Math.abs(t.scale - 595.28 / 4000) < 1e-12);
  const c = fitPhotoToPage({ width: 4000, height: 3000 }, { width: 595.28, height: 841.89 }, { align: 'center', margin: 10 });
  assert.equal(c.offsetX, 10);
  assert.ok(Math.abs(c.offsetY - (10 + (821.89 - 3000 * c.scale) / 2)) < 1e-9);
  const [s] = strokesToPage([{ points: [[4000, 3000]], width: 8, color: 'black' }], t);
  assert.deepEqual(s.points[0].map(v => Math.round(v * 1000) / 1000), [595.28, 446.46]);
  assert.ok(Math.abs(s.width - 8 * t.scale) < 1e-12);
  assert.equal(s.color, 'black');
  assert.ok(Math.abs(GOODNOTES_UNITS_PER_PT - 11 / 6) < 1e-15);
});

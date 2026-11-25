#!/usr/bin/env node
// .goodnotes 파일 구조를 읽기 전용으로 출력하는 개발 도구.
// 사용법: node scripts/goodnotes-inspect.mjs <파일.goodnotes> [--records N] [--depth N] [--points N]
//   --records N  멤버마다 자세히 보여 줄 레코드 수(기본 60, 0이면 전부)
//   --depth N    중첩 메시지를 펼칠 깊이(기본 6)
//   --points N   획마다 보여 줄 점 수(기본 4)
// 파일을 바꾸지 않는다.

import { readFileSync } from 'node:fs';
import {
  readZip,
  zipEntryData,
  readDelimitedRecords,
  tryDecodeMessage,
  fieldFloat32,
  fieldFloat64,
  fieldVarint,
  isAppleLz4,
  appleLz4Decode,
  decodeTpl,
  decodeUniformPen,
  UNIFORM_PEN_SIGNATURE,
  readPageItems,
  strokeInfo,
  listTemplatePages,
  WIRE_VARINT,
  WIRE_FIXED32,
  WIRE_FIXED64,
  WIRE_LEN,
} from '../lib/goodnotes-file.ts';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const MAX_RECORDS = opt('--records', 60);
const MAX_DEPTH = opt('--depth', 6);
const MAX_POINTS = opt('--points', 4);

if (!file) {
  console.error('usage: node scripts/goodnotes-inspect.mjs <file.goodnotes> [--records N] [--depth N] [--points N]');
  process.exit(2);
}

const WIRE_NAME = { 0: 'varint', 1: 'f64', 2: 'len', 3: 'group-start', 4: 'group-end', 5: 'f32' };
const text = new TextDecoder('utf-8', { fatal: true });
const fmt = n => (Number.isInteger(n) ? String(n) : Number(n.toPrecision(7)).toString());
const hex = (b, n = 24) => Array.from(b.subarray(0, n), x => x.toString(16).padStart(2, '0')).join(' ') + (b.length > n ? ' …' : '');

function printable(bytes) {
  if (bytes.length === 0 || bytes.length > 200) return null;
  try {
    const s = text.decode(bytes);
    return /^[\x20-\x7e -￿]*$/.test(s) ? s : null;
  } catch {
    return null;
  }
}

function describeBlob(bytes, indent) {
  const pad = '  '.repeat(indent);
  const lines = [];
  try {
    const dec = appleLz4Decode(bytes);
    const chunks = dec.chunks.map(c => `${c.kind}(${c.rawSize}/${c.storedSize})`).join(' ');
    lines.push(`${pad}apple-lz4 chunks=[${chunks}] raw=${dec.data.length} trailing=${dec.trailing}`);
    if (dec.data[0] === 0x74 && dec.data[1] === 0x70 && dec.data[2] === 0x6c) {
      const img = decodeTpl(dec.data);
      lines.push(`${pad}tpl signature=${img.signature} floatSize=${img.floatSize} flags=${img.flags}`);
      if (img.signature === UNIFORM_PEN_SIGNATURE) {
        const pen = decodeUniformPen(img);
        const segs = pen.subpaths.reduce((s, p) => s + p.quads.length, 0);
        lines.push(`${pad}ballpoint version=${pen.version} width=${fmt(pen.width)} subpaths=${pen.subpaths.length} quads=${segs} trailer=${pen.trailer} widthSamples=${pen.widthSamples.length}`);
        const sp = pen.subpaths[0];
        if (sp) {
          const pts = [`M(${fmt(sp.move[0])},${fmt(sp.move[1])})`, ...sp.quads.slice(0, MAX_POINTS).map(q => `Q(${q.map(fmt).join(',')})`)];
          lines.push(`${pad}first: ${pts.join(' ')}${sp.quads.length > MAX_POINTS ? ' …' : ''}`);
        }
      } else {
        lines.push(`${pad}values: ${img.values.map(v => (Array.isArray(v) ? `[${v.length}]` : String(v))).join(' ')}`);
      }
    } else {
      lines.push(`${pad}payload head: ${hex(dec.data)}`);
    }
  } catch (error) {
    lines.push(`${pad}(blob decode failed: ${error.message})`);
  }
  return lines;
}

function describeFields(fields, depth, lines) {
  const pad = '  '.repeat(depth + 1);
  for (const f of fields) {
    const head = `${pad}f${f.number} ${WIRE_NAME[f.wireType] ?? f.wireType}`;
    if (f.wireType === WIRE_VARINT) lines.push(`${head} = ${fieldVarint(f)}`);
    else if (f.wireType === WIRE_FIXED32) lines.push(`${head} = ${fmt(fieldFloat32(f))} (0x${hex(f.data, 4).replace(/ /g, '')})`);
    else if (f.wireType === WIRE_FIXED64) lines.push(`${head} = ${fmt(fieldFloat64(f))}`);
    else if (f.wireType === WIRE_LEN) {
      const len = f.data.length;
      if (len === 0) {
        lines.push(`${head} len=0`);
        continue;
      }
      if (isAppleLz4(f.data)) {
        lines.push(`${head} len=${len} (bv4 blob)`);
        lines.push(...describeBlob(f.data, depth + 2));
        continue;
      }
      const s = printable(f.data);
      const nested = depth < MAX_DEPTH ? tryDecodeMessage(f.data) : null;
      if (s !== null && (!nested || /^[0-9A-Za-z_.:/ -]+$/.test(s))) {
        lines.push(`${head} len=${len} "${s}"`);
      } else if (nested) {
        lines.push(`${head} len=${len} {`);
        describeFields(nested, depth + 1, lines);
        lines.push(`${pad}}`);
      } else {
        lines.push(`${head} len=${len} bytes ${hex(f.data)}`);
      }
    } else lines.push(head);
  }
}

function describeRecordStream(name, data) {
  const lines = [];
  let records;
  try {
    records = readDelimitedRecords(data);
  } catch (error) {
    lines.push(`  (not a record stream: ${error.message})`);
    return lines;
  }
  lines.push(`  records=${records.length}`);
  const limit = MAX_RECORDS === 0 ? records.length : Math.min(records.length, MAX_RECORDS);
  for (let i = 0; i < limit; i += 1) {
    const fields = tryDecodeMessage(records[i]);
    if (!fields) {
      lines.push(`  #${i} len=${records[i].length} (not a message) ${hex(records[i])}`);
      continue;
    }
    lines.push(`  #${i} len=${records[i].length}`);
    describeFields(fields, 1, lines);
  }
  if (limit < records.length) lines.push(`  … ${records.length - limit} more records (use --records 0)`);
  if (name.startsWith('notes/')) {
    const items = readPageItems(data);
    const objects = items.filter(it => it.type === 'object').map(it => it.object);
    const kinds = {};
    for (const o of objects) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
    lines.push(`  objects=${objects.length} kinds=${JSON.stringify(kinds)} deleted=${objects.filter(o => o.deleted).length} unpaired=${items.filter(it => it.type === 'record').length}`);
    for (const o of objects.filter(o => o.kind === 7).slice(0, MAX_RECORDS || undefined)) {
      const s = strokeInfo(o);
      lines.push(`  stroke ${o.id} sig=${s.signature} rgba=${s.color.map(fmt).join(',')} hl=${s.highlighter} tape=${s.tape} shape=${s.shape} moved=${s.moved} deleted=${o.deleted} meta=${o.meta ? 'yes' : 'no'}`);
    }
  }
  return lines;
}

function describeBinary(name, data) {
  const head = Array.from(data.subarray(0, 4), b => String.fromCharCode(b)).join('');
  if (head === '%PDF') {
    const latin = Array.from(data.subarray(0, Math.min(data.length, 1 << 20)), b => String.fromCharCode(b)).join('');
    const box = /\/MediaBox\s*\[\s*([-\d. ]+)\]/.exec(latin);
    const pages = (latin.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    return [`  PDF pages≈${pages} MediaBox=[${box ? box[1].trim() : '?'}]`];
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    for (let i = 2; i + 9 < data.length; ) {
      if (data[i] !== 0xff) break;
      const marker = data[i + 1];
      const len = (data[i + 2] << 8) | data[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3) return [`  JPEG ${(data[i + 7] << 8) | data[i + 8]}x${(data[i + 5] << 8) | data[i + 6]}`];
      i += 2 + len;
    }
    return ['  JPEG (size unknown)'];
  }
  if (data[0] === 0x89 && head.slice(1) === 'PNG') return ['  PNG'];
  return [`  head: ${hex(data)}`];
}

const bytes = new Uint8Array(readFileSync(file));
const entries = readZip(bytes);
const out = [];
out.push(`file: ${file}`);
out.push(`size: ${bytes.length} bytes, members: ${entries.length}`);
out.push('');
out.push('== ZIP members ==');
for (const e of entries) {
  const method = e.method === 0 ? 'stored' : e.method === 8 ? 'deflate' : `method${e.method}`;
  out.push(`  ${e.name}  ${method}  ${e.uncompressedSize} B (zip ${e.compressedSize} B)  crc=${e.crc32.toString(16).padStart(8, '0')}`);
}

const files = new Map();
for (const e of entries) files.set(e.name, await zipEntryData(e));

out.push('');
out.push('== pages (display order) ==');
try {
  const pages = listTemplatePages({ notesIndex: files.get('index.notes.pb'), events: files.get('index.events.pb'), names: entries.map(e => e.name) });
  pages.forEach((p, i) => out.push(`  ${i}: notes/${p.noteId} page=${p.pageId} key=${p.orderKey} size=${p.size ? `${fmt(p.size.width)}x${fmt(p.size.height)}` : '?'}`));
} catch (error) {
  out.push(`  (failed: ${error.message})`);
}

for (const [name, data] of files) {
  out.push('');
  out.push(`== ${name} (${data.length} B) ==`);
  if (data.length === 0) {
    out.push('  (empty)');
    continue;
  }
  if (name === 'schema.pb') {
    const fields = tryDecodeMessage(data);
    if (fields) describeFields(fields, 0, out);
    else out.push(`  ${hex(data)}`);
  } else if (name.endsWith('.pb') || name.startsWith('notes/')) {
    out.push(...describeRecordStream(name, data));
  } else {
    out.push(...describeBinary(name, data));
  }
}
console.log(out.join('\n'));

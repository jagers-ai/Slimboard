// 굿노트 획 경로의 `tpl` 이진 형식(Troy Hanson tpl 메모리 이미지) 읽기/쓰기와 볼펜 경로.
//
// 형식(모든 자료 공통): "tpl" + flags(1바이트, bit0=1이면 big-endian, 굿노트는 0)
//   + uint32 LE 전체 길이 + NUL로 끝나는 ASCII 시그니처 + 값들(little-endian, 패딩 없음)
// 시그니처 문자: v=uint16, u=uint32(좌표와 굵기는 float32 비트), A(T)=uint32 개수+배열, S(...)=구조체.
//
// 자료 차이: `f`의 크기
// - parser-for-goodnotes: float64(8바이트). 원래 tpl 라이브러리 규약과 같다.
// - goodparse, goodnotes-codec: float32(4바이트). goodnotes-codec는 실제 문서 206개를 바이트 단위로
//   왕복 검증했다고 기록했다.
// 볼펜 시그니처의 A(f)는 관찰된 파일에서 비어 있는 경우가 많아 두 해석이 같은 결과를 낸다.
// 디코더는 floatSize "auto"일 때 4와 8을 모두 시도해 전체 길이와 정확히 맞는 쪽을 고르고,
// 둘 다 맞으면 4를 고른다(codec의 왕복 검증 근거). 인코더 기본은 4다.
//
// 볼펜(균일 굵기) 시그니처 `vuA(v)A(S(uu))A(S(uuuu))vA(f)` 값의 뜻
//   [0] v  버전. natural-ink와 goodnotes-codec 모두 2를 쓴다.
//   [1] u  굵기(float32 비트). 단위는 아래 "굵기 단위" 참고.
//   [2] A(v) 노드 종류. 0=move(하위 경로 시작), 1=2차 Bézier 구간. bit1, bit2는 가변 굵기 펜에서만 쓴다(goodparse).
//   [3] A(S(uu)) move 점 (x, y)
//   [4] A(S(uuuu)) 구간 (cx, cy, x, y): 이전 끝점에서 (x, y)까지 제어점 (cx, cy)인 2차 Bézier
//   [5] v  natural-ink와 goodnotes-codec 모두 1을 쓴다. 뜻은 자료에 없다.
//   [6] A(f) 굵기 표본(goodnotes-codec 설명). 두 작성기 모두 빈 배열을 쓴다.
//
// 직선 구간 표현(자료 차이, 둘 다 실제 굿노트에서 열렸다고 기록됨)
// - natural-ink: 제어점 = 구간 시작점 (cx, cy) = (x0, y0)
// - goodnotes-codec: 제어점 = 구간 중점 ((x0+x)/2, (y0+y)/2)
// 굿노트가 직접 그린 획은 "중점 2차 Bézier 평활"이다(goodparse: 제어점은 입력 표본, 끝점은 연속한
// 제어점의 중점). 이 형태를 원하면 polylineToMidpointQuadPath를 쓴다.
//
// 굵기 단위(자료 차이)
// - natural-ink: 페이지 좌표와 같은 단위(pt 템플릿에서는 pt)의 지름.
// - goodnotes-codec: 페이지 단위 "thickness"(기본 1.5).
// - goodparse: 참조 PDF와 비교하니 저장값 1당 0.5 pt, 즉 6/11 배율 페이지에서 11/12 페이지 단위로 그려졌다.
// 이 모듈은 저장값을 그대로 받는다. 단위 변환은 호출하는 쪽(goodnotes-file-document.ts)에서 정한다.

export const UNIFORM_PEN_SIGNATURE = "vuA(v)A(S(uu))A(S(uuuu))vA(f)";

export type TplNode = string | { kind: "A" | "S"; children: TplNode[] };
/** 스칼라는 number(64비트 정수 I/U만 bigint), A는 배열, S는 배열(멤버 순서). 자식이 하나뿐인 A의 요소는 그 값 자체. */
export type TplValue = number | bigint | TplValue[];

export type TplImage = {
  flags: number;
  signature: string;
  values: TplValue[];
  /** `f` 하나의 바이트 수 */
  floatSize: 4 | 8;
};

const SCALAR_SIZE: Record<string, number> = { c: 1, j: 2, v: 2, i: 4, u: 4, I: 8, U: 8 };

// ---------------------------------------------------------------------------
// float32 비트 변환

const f32View = new DataView(new ArrayBuffer(4));

export function float32ToBits(value: number): number {
  f32View.setFloat32(0, value, true);
  return f32View.getUint32(0, true);
}

export function bitsToFloat32(bits: number): number {
  f32View.setUint32(0, bits >>> 0, true);
  return f32View.getFloat32(0, true);
}

/** float32로 표현했을 때의 값(왕복 비교용). */
export function toFloat32(value: number): number {
  return bitsToFloat32(float32ToBits(value));
}

// ---------------------------------------------------------------------------
// 시그니처 파싱

export function parseTplSignature(signature: string): TplNode[] {
  let i = 0;
  function group(closing: boolean): TplNode[] {
    const nodes: TplNode[] = [];
    while (i < signature.length) {
      const c = signature[i];
      i += 1;
      if (c === ")") {
        if (!closing) throw new Error("TPL_UNEXPECTED_CLOSE");
        return nodes;
      }
      if (c === "A" || c === "S") {
        if (signature[i] !== "(") throw new Error(`TPL_EXPECTED_PAREN after ${c}`);
        i += 1;
        nodes.push({ kind: c, children: group(true) });
      } else if (c in SCALAR_SIZE || c === "f") {
        nodes.push(c);
      } else {
        throw new Error(`TPL_UNSUPPORTED_TYPE ${c}`);
      }
    }
    if (closing) throw new Error("TPL_UNCLOSED_GROUP");
    return nodes;
  }
  return group(false);
}

// ---------------------------------------------------------------------------
// 디코드

class Cursor {
  view: DataView;
  pos: number;
  constructor(bytes: Uint8Array, pos: number) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }
  need(n: number): void {
    if (this.pos + n > this.view.byteLength) throw new Error("TPL_TRUNCATED");
  }
}

function readScalar(c: Cursor, t: string, floatSize: 4 | 8): number | bigint {
  const v = c.view;
  const p = c.pos;
  const size = t === "f" ? floatSize : SCALAR_SIZE[t];
  c.need(size);
  c.pos += size;
  switch (t) {
    case "c":
      return v.getInt8(p);
    case "j":
      return v.getInt16(p, true);
    case "v":
      return v.getUint16(p, true);
    case "i":
      return v.getInt32(p, true);
    case "u":
      return v.getUint32(p, true);
    case "I":
      return v.getBigInt64(p, true);
    case "U":
      return v.getBigUint64(p, true);
    default:
      return floatSize === 4 ? v.getFloat32(p, true) : v.getFloat64(p, true);
  }
}

function readNode(c: Cursor, node: TplNode, floatSize: 4 | 8): TplValue {
  if (typeof node === "string") return readScalar(c, node, floatSize);
  if (node.kind === "S") return node.children.map(child => readNode(c, child, floatSize));
  c.need(4);
  const count = c.view.getUint32(c.pos, true);
  c.pos += 4;
  const items: TplValue[] = [];
  for (let k = 0; k < count; k += 1) {
    if (node.children.length === 1) items.push(readNode(c, node.children[0], floatSize));
    else items.push(node.children.map(child => readNode(c, child, floatSize)));
  }
  return items;
}

function headerEnd(raw: Uint8Array): { signature: string; valuesStart: number } {
  if (raw.length < 9 || raw[0] !== 0x74 || raw[1] !== 0x70 || raw[2] !== 0x6c) throw new Error("TPL_BAD_MAGIC");
  if (raw[3] & 1) throw new Error("TPL_BIG_ENDIAN_UNSUPPORTED");
  const total = (raw[4] | (raw[5] << 8) | (raw[6] << 16) | (raw[7] << 24)) >>> 0;
  if (total !== raw.length) throw new Error(`TPL_LENGTH_MISMATCH header ${total} actual ${raw.length}`);
  let end = 8;
  while (end < raw.length && raw[end] !== 0) end += 1;
  if (end >= raw.length) throw new Error("TPL_UNTERMINATED_SIGNATURE");
  let signature = "";
  for (let k = 8; k < end; k += 1) signature += String.fromCharCode(raw[k]);
  return { signature, valuesStart: end + 1 };
}

function decodeWith(raw: Uint8Array, nodes: TplNode[], start: number, floatSize: 4 | 8): TplValue[] {
  const c = new Cursor(raw, start);
  const values = nodes.map(n => readNode(c, n, floatSize));
  if (c.pos !== raw.length) throw new Error(`TPL_TRAILING_BYTES ${raw.length - c.pos}`);
  return values;
}

/** 해제된 tpl 이미지를 읽는다. floatSize "auto"는 위 머리 주석 참고. */
export function decodeTpl(raw: Uint8Array, options: { floatSize?: 4 | 8 | "auto" } = {}): TplImage {
  const { signature, valuesStart } = headerEnd(raw);
  const nodes = parseTplSignature(signature);
  const flags = raw[3];
  const want = options.floatSize ?? "auto";
  if (want !== "auto") return { flags, signature, values: decodeWith(raw, nodes, valuesStart, want), floatSize: want };
  let firstError: unknown;
  for (const size of [4, 8] as const) {
    try {
      return { flags, signature, values: decodeWith(raw, nodes, valuesStart, size), floatSize: size };
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError;
}

// ---------------------------------------------------------------------------
// 인코드

function writeNode(out: number[], node: TplNode, value: TplValue, floatSize: 4 | 8): void {
  if (typeof node === "string") {
    const size = node === "f" ? floatSize : SCALAR_SIZE[node];
    const view = new DataView(new ArrayBuffer(size));
    if (typeof value === "object") throw new Error(`TPL_EXPECTED_SCALAR for ${node}`);
    switch (node) {
      case "c":
        view.setInt8(0, Number(value));
        break;
      case "j":
        view.setInt16(0, Number(value), true);
        break;
      case "v":
        view.setUint16(0, Number(value), true);
        break;
      case "i":
        view.setInt32(0, Number(value), true);
        break;
      case "u":
        view.setUint32(0, Number(value) >>> 0, true);
        break;
      case "I":
        view.setBigInt64(0, BigInt(value), true);
        break;
      case "U":
        view.setBigUint64(0, BigInt(value), true);
        break;
      default:
        if (floatSize === 4) view.setFloat32(0, Number(value), true);
        else view.setFloat64(0, Number(value), true);
    }
    for (let k = 0; k < size; k += 1) out.push(view.getUint8(k));
    return;
  }
  if (!Array.isArray(value)) throw new Error(`TPL_EXPECTED_ARRAY for ${node.kind}`);
  if (node.kind === "S") {
    if (value.length !== node.children.length) throw new Error("TPL_STRUCT_ARITY");
    node.children.forEach((child, k) => writeNode(out, child, value[k], floatSize));
    return;
  }
  const n = value.length;
  out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  for (const item of value) {
    if (node.children.length === 1) writeNode(out, node.children[0], item, floatSize);
    else {
      if (!Array.isArray(item) || item.length !== node.children.length) throw new Error("TPL_ARRAY_ITEM_ARITY");
      node.children.forEach((child, k) => writeNode(out, child, item[k], floatSize));
    }
  }
}

export function encodeTpl(image: { signature: string; values: ReadonlyArray<TplValue>; flags?: number; floatSize?: 4 | 8 }): Uint8Array {
  const nodes = parseTplSignature(image.signature);
  if (nodes.length !== image.values.length) throw new Error("TPL_VALUE_COUNT");
  const floatSize = image.floatSize ?? 4;
  const body: number[] = [];
  nodes.forEach((node, k) => writeNode(body, node, image.values[k], floatSize));
  const sig: number[] = [];
  for (let k = 0; k < image.signature.length; k += 1) {
    const code = image.signature.charCodeAt(k);
    if (code > 0x7e || code < 0x20) throw new Error("TPL_NON_ASCII_SIGNATURE");
    sig.push(code);
  }
  sig.push(0);
  const total = 8 + sig.length + body.length;
  const out = new Uint8Array(total);
  out.set([0x74, 0x70, 0x6c, image.flags ?? 0, total & 0xff, (total >>> 8) & 0xff, (total >>> 16) & 0xff, (total >>> 24) & 0xff], 0);
  out.set(sig, 8);
  out.set(body, 8 + sig.length);
  return out;
}

// ---------------------------------------------------------------------------
// 볼펜 경로

export type Point = readonly [number, number];
/** 하위 경로 하나: move 점과 2차 Bézier 구간 (cx, cy, x, y) 목록. */
export type PenSubpath = { move: Point; quads: Array<readonly [number, number, number, number]> };

export type UniformPen = {
  /** [0] 버전(관찰값 2) */
  version: number;
  /** [1] 굵기 저장값 */
  width: number;
  subpaths: PenSubpath[];
  /** [5] 뜻 모르는 uint16(관찰값 1) */
  trailer: number;
  /** [6] 굵기 표본(관찰값 빈 배열) */
  widthSamples: number[];
};

export const UNIFORM_PEN_DEFAULTS = { version: 2, trailer: 1 } as const;

export function encodeUniformPenTpl(pen: Partial<Pick<UniformPen, "version" | "trailer" | "widthSamples">> & Pick<UniformPen, "width" | "subpaths">): Uint8Array {
  const kinds: number[] = [];
  const moves: TplValue[] = [];
  const quads: TplValue[] = [];
  for (const sp of pen.subpaths) {
    kinds.push(0);
    moves.push([float32ToBits(sp.move[0]), float32ToBits(sp.move[1])]);
    for (const q of sp.quads) {
      kinds.push(1);
      quads.push(q.map(float32ToBits));
    }
  }
  return encodeTpl({
    signature: UNIFORM_PEN_SIGNATURE,
    values: [
      pen.version ?? UNIFORM_PEN_DEFAULTS.version,
      float32ToBits(pen.width),
      kinds,
      moves,
      quads,
      pen.trailer ?? UNIFORM_PEN_DEFAULTS.trailer,
      pen.widthSamples ?? [],
    ],
    floatSize: 4,
  });
}

export function decodeUniformPen(image: TplImage): UniformPen {
  if (image.signature !== UNIFORM_PEN_SIGNATURE) throw new Error(`TPL_NOT_UNIFORM_PEN ${image.signature}`);
  const [version, widthBits, kinds, moves, quads, trailer, samples] = image.values as [number, number, number[], number[][], number[][], number, number[]];
  const subpaths: PenSubpath[] = [];
  let mi = 0;
  let qi = 0;
  for (const kind of kinds) {
    if ((kind & 1) === 0) {
      const m = moves[mi++];
      if (!m) throw new Error("TPL_MOVE_MISSING");
      subpaths.push({ move: [bitsToFloat32(m[0]), bitsToFloat32(m[1])], quads: [] });
    } else {
      const q = quads[qi++];
      if (!q || subpaths.length === 0) throw new Error("TPL_QUAD_WITHOUT_MOVE");
      subpaths[subpaths.length - 1].quads.push([bitsToFloat32(q[0]), bitsToFloat32(q[1]), bitsToFloat32(q[2]), bitsToFloat32(q[3])]);
    }
  }
  if (mi !== moves.length || qi !== quads.length) throw new Error("TPL_NODE_COUNT_MISMATCH");
  return { version, width: bitsToFloat32(widthBits), subpaths, trailer, widthSamples: samples };
}

// ---------------------------------------------------------------------------
// 폴리라인 → 경로

export type LineControl = "start" | "midpoint";

/**
 * 폴리라인을 직선 구간만으로 된 경로로 바꾼다. 그린 결과는 폴리라인과 (float32 오차 안에서) 같다.
 * lineControl "start"는 natural-ink 방식(제어점 = 구간 시작점), "midpoint"는 goodnotes-codec 방식(제어점 = 구간 중점).
 * 점이 하나뿐이거나 모든 점이 같으면 natural-ink처럼 오른쪽으로 dotLength만큼 떨어진 점을 더해 아주 짧은 구간을 만든다.
 */
export function polylineToLinePath(points: ReadonlyArray<Point>, lineControl: LineControl = "start", dotLength = 0.001): PenSubpath {
  if (points.length === 0) throw new Error("PATH_EMPTY_POLYLINE");
  const pts: Point[] = [points[0]];
  for (let k = 1; k < points.length; k += 1) {
    const prev = pts[pts.length - 1];
    if (points[k][0] !== prev[0] || points[k][1] !== prev[1]) pts.push(points[k]);
  }
  if (pts.length === 1) pts.push([pts[0][0] + dotLength, pts[0][1]]);
  const quads: PenSubpath["quads"] = [];
  for (let k = 1; k < pts.length; k += 1) {
    const [x0, y0] = pts[k - 1];
    const [x, y] = pts[k];
    if (lineControl === "start") quads.push([x0, y0, x, y]);
    else quads.push([(x0 + x) / 2, (y0 + y) / 2, x, y]);
  }
  return { move: pts[0], quads };
}

/**
 * 굿노트가 손글씨에 쓰는 "중점 2차 Bézier" 규칙(끝점 = 연속한 제어점의 중점)을 지키면서 폴리라인 모서리를 살린다.
 * 각 꼭짓점을 제어점으로 두고, 각 변 위 양 끝에서 delta = 4 * tolerance 떨어진 점을 제어점으로 더한다.
 * 같은 변 위의 연속 제어점 사이 곡선은 그 변 위의 직선이고, 꼭짓점 근처 곡선이 꼭짓점에서 벗어나는 거리는
 * |v - B(1/2)| = |(v - m1) + (v - m2)| / 4 ≤ delta / 4 = tolerance 이다.
 */
export function polylineToMidpointQuadPath(points: ReadonlyArray<Point>, tolerance = 0.25, dotLength = 0.001): PenSubpath {
  if (!(tolerance > 0)) throw new Error("PATH_BAD_TOLERANCE");
  const line = polylineToLinePath(points, "start", dotLength);
  const verts: Point[] = [line.move, ...line.quads.map(q => [q[2], q[3]] as const)];
  const delta = 4 * tolerance;
  const controls: Point[] = [verts[0]];
  for (let k = 1; k < verts.length; k += 1) {
    const a = verts[k - 1];
    const b = verts[k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = Math.min(delta, len / 2);
    const ux = (b[0] - a[0]) / len;
    const uy = (b[1] - a[1]) / len;
    const p1: Point = [a[0] + ux * d, a[1] + uy * d];
    const p2: Point = [b[0] - ux * d, b[1] - uy * d];
    controls.push(p1);
    if (p2[0] !== p1[0] || p2[1] !== p1[1]) controls.push(p2);
    controls.push(b);
  }
  // 끝을 한 번 복제해 연장한 것으로 보면 모든 구간이 중점 규칙을 지킨다:
  // 구간 k = (제어점 C[k], 끝점 (C[k] + C[k+1]) / 2), C[m] = C[m-1].
  const quads: PenSubpath["quads"] = [];
  for (let k = 0; k < controls.length; k += 1) {
    const c = controls[k];
    const next = controls[k + 1] ?? c;
    quads.push([c[0], c[1], (c[0] + next[0]) / 2, (c[1] + next[1]) / 2]);
  }
  return { move: controls[0], quads };
}

/** 경로를 2차 Bézier 표본으로 되돌려 그린다(검증용). */
export function renderPenSubpath(sp: PenSubpath, stepsPerQuad = 8): Point[] {
  const out: Point[] = [sp.move];
  let [x0, y0] = sp.move;
  for (const [cx, cy, x, y] of sp.quads) {
    for (let s = 1; s <= stepsPerQuad; s += 1) {
      const t = s / stepsPerQuad;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      out.push([a * x0 + b * cx + c * x, a * y0 + b * cy + c * y]);
    }
    x0 = x;
    y0 = y;
  }
  return out;
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distanceToPolyline(p: Point, line: ReadonlyArray<Point>): number {
  if (line.length === 1) return Math.hypot(p[0] - line[0][0], p[1] - line[0][1]);
  let best = Infinity;
  for (let k = 1; k < line.length; k += 1) best = Math.min(best, pointSegmentDistance(p, line[k - 1], line[k]));
  return best;
}

/** 두 폴리라인 사이 대칭 하우스도르프 거리(표본 기준). */
export function polylineHausdorff(a: ReadonlyArray<Point>, b: ReadonlyArray<Point>): number {
  let worst = 0;
  for (const p of a) worst = Math.max(worst, distanceToPolyline(p, b));
  for (const p of b) worst = Math.max(worst, distanceToPolyline(p, a));
  return worst;
}

// ---------------------------------------------------------------------------
// 가변 굵기 펜: 만년필(본문 f3 = 1)과 붓(본문 f3 = 4)
//
// 출처(형식 사실만 참고, 코드는 옮기지 않고 새로 작성):
// - Taylor-Nilsen/goodnotes-codec (MIT) 기본 브랜치 docs/FORMAT.md, goodnotes/model.py, 개선 브랜치(PR #11, feat/full-format)
//   docs/FORMAT.md, goodnotes/schema.py, goodnotes/model.py, reports/full-20261020-111939/report.txt
//   https://github.com/Taylor-Nilsen/goodnotes-codec/pull/11 , https://github.com/Taylor-Nilsen/goodnotes-codec/issues/7
// - Kaih1825/parser-for-goodnotes (MIT) src/goodnotes_re/stroke.py, wiki 04 https://github.com/Kaih1825/parser-for-goodnotes
// - goodparse (GPL, 사실만 참고) src/goodparse/ink.py, oenderg/gnreader docs/FORMAT.md, cable729/inkterop (MIT) reader.py
//
// 시그니처(codec schema.py STROKE_SCHEMA, goodparse ink.py 머리 주석, parser-for-goodnotes 모두 같음)
//   만년필 VARIABLE_WIDTH  vA(v)A(u)A(u)A(v)A(v)A(u)A(u)A(u)A(u)A(v)
//   붓     DYNAMIC_WIDTH   vuA(v)A(u)A(u)A(v)A(v)A(u)A(u)A(u)A(u)A(v)   (버전 뒤 u 하나가 더 있다)
// 값 순서: [v 버전 2] [붓만: u 기본 반폭] A(v) 중심선 명령, A(u) move 실수들, A(u) quad 실수들,
//   A(v) 윤곽 하위 경로별 명령 수, A(v) 윤곽 명령, A(u) 윤곽 move(2개씩), A(u) 윤곽 quad(4개씩, 관찰상 비어 있음),
//   A(u) 윤곽 cubic(6개씩), A(u) 윤곽 arc(원호 5개 cx cy r a0 a1, 타원호 7개), A(v) 원호마다 시계 방향 표시.
//
// 중심선 명령 비트(goodparse ink.py, codec schema.py VW_COMMAND/DW_COMMAND가 같은 뜻으로 맞물린다)
//   bit0: 0 move, 1 quad. bit1(붓만): 그 노드가 자기 반폭을 가진다(codec의 variableMoveTo 2, variableQuadCurveTo 3).
//   bit2: 회전 값이 붙는다(move +1개, quad +3개, codec의 ...WithRotation, 마커 펜). 우리는 쓰지 않는다.
//   만년필: move (x, y, r), quad (cx, cy, cr, x, y, r). r은 반폭(페이지 단위). codec, goodparse, gnreader 같음.
//   붓 자기 반폭 노드: move (x, y, r). quad 값 순서는 자료가 다르다.
//     goodparse(참조 PDF와 맞춰 본 중심선 렌더): (cx, cy, x, y, cr, r)  ← 기본값 "goodparse"
//     codec 생성기와 디코더: (cx, cy, cr, x, y, r). codec은 윤곽으로만 그려서 이 순서가 그림으로 검증되지 않았다.
//   붓 기본 반폭 u: goodparse는 "자기 반폭이 없는 노드가 쓰는 반폭, 모든 노드가 자기 반폭을 가지면 -1"로 기록했다.
//     codec 생성기는 2 × max(반폭)을 쓴다. 기본값은 굿노트 자체 파일 관찰(goodparse)을 따라 -1이다.
// 윤곽 명령(만년필 / 붓): move 0/2, quad 1/3, cubic 2/4, arc 3/5, 타원호 6/8. 붓은 만년필 코드 + 2.
//   (codec schema.py, parser-for-goodnotes stroke.py extract_native_cgpath_segments_from_tpl)
//
// 굿노트가 죽던 원인과 개선 브랜치 규칙(codec 기본 브랜치 model.py new_fountain_stroke 주석 "KNOWN BROKEN",
// 개선 브랜치 docs/FORMAT.md, model.py _variable_width_blob)
//   기본 브랜치는 획 전체 윤곽을 하위 경로 하나로 써서 명령 수 배열이 [전체 명령 수] 하나였다. 굿노트의 역직렬화기는
//   중심선 quad 구간마다 윤곽 하위 경로 하나(quadCurveTo가 자기 구간 윤곽을 가진다)를 기대하고 명령 수를 검사하므로
//   개수가 다르면 가져오기에서 죽는다. 실제 문서의 가변 굵기 획 4,363개 모두 quad 구간 수 = 윤곽 하위 경로 수였다.
//   개선 브랜치는 구간마다 닫힌 캡슐을 쓰고, 끝 원호를 모두 시계 방향 표시 1(각도 감소)로 쓴다. 이 파일을
//   Mac용 굿노트로 가져와 죽지 않고 만년필, 붓 획이 그려졌다(report.txt "A 03 fountain/brush/tape pass").
//   여기서는 그 규칙을 따르고, 쓰기 전에 윤곽 수 = quad 수를 검사한다.
// 캡슐 안 명령 순서: 굿노트 자체 파일은 move, 옆선 cubic(1~3개), 끝 원호, 반대 옆선 cubic, 시작 원호다
//   (gnreader 관찰 [0,2,3,2,3,...], codec 이슈 #7 실제 획 [0,2,2,2,3,2,2,2,3]). codec 개선 브랜치 생성기는
//   move, 원호, cubic, 원호, cubic 순서로 썼고 그것도 열렸다. 여기서는 굿노트 자체 순서를 따른다.
// 칠하기: 하위 경로들이 겹치며 전체 획이 된다(codec: "overlapping stadiums fill to the full stroke"). 모든 캡슐을 같은
//   회전 방향으로 써서 nonzero 규칙에서 겹친 곳이 비지 않게 한다.

export const FOUNTAIN_PEN_SIGNATURE = "vA(v)A(u)A(u)A(v)A(v)A(u)A(u)A(u)A(u)A(v)";
export const BRUSH_PEN_SIGNATURE = "vuA(v)A(u)A(u)A(v)A(v)A(u)A(u)A(u)A(u)A(v)";

export type VariablePenKind = "fountain" | "brush";
/** 붓 자기 반폭 quad의 값 순서. 위 주석 참고. */
export type BrushQuadOrder = "goodparse" | "codec";

/** (x, y, r): 페이지 단위 좌표와 반폭 */
export type RadiusPoint = readonly [number, number, number];
export type VariableQuad = { c: RadiusPoint; p: RadiusPoint };
/** 중심선 하위 경로: move 노드와 2차 Bézier 구간(제어점과 끝점에 각각 반폭). */
export type VariableSubpath = { move: RadiusPoint; quads: VariableQuad[] };

export type OutlineCommand =
  | { op: "M"; x: number; y: number }
  | { op: "Q"; cx: number; cy: number; x: number; y: number }
  | { op: "C"; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  /** CGPathAddArc와 같은 원호. clockwise면 a0에서 a1로 각도가 줄어든다. */
  | { op: "A"; cx: number; cy: number; r: number; a0: number; a1: number; clockwise: boolean }
  | { op: "E"; cx: number; cy: number; rx: number; ry: number; a0: number; a1: number; rotation: number; clockwise: boolean };

export type VariablePen = {
  kind: VariablePenKind;
  /** 관찰값 2 */
  version: number;
  /** 붓의 기본 반폭(만년필은 null) */
  defaultRadius: number | null;
  centerline: VariableSubpath[];
  /** 중심선 quad 구간마다 닫힌 윤곽 하나(순서 같음) */
  outlines: OutlineCommand[][];
};

export const VARIABLE_PEN_DEFAULTS = { version: 2, brushDefaultRadius: -1 } as const;

const OUTLINE_BASE = { M: 0, Q: 1, C: 2, A: 3, E: 6 } as const;

function quadCount(centerline: ReadonlyArray<VariableSubpath>): number {
  return centerline.reduce((n, sp) => n + sp.quads.length, 0);
}

export function encodeVariablePenTpl(pen: {
  kind: VariablePenKind;
  centerline: ReadonlyArray<VariableSubpath>;
  outlines: ReadonlyArray<ReadonlyArray<OutlineCommand>>;
  version?: number;
  defaultRadius?: number;
  brushQuadOrder?: BrushQuadOrder;
}): Uint8Array {
  const brush = pen.kind === "brush";
  if (pen.centerline.length === 0) throw new Error("TPL_VARIABLE_EMPTY");
  if (pen.outlines.length !== quadCount(pen.centerline)) {
    // 굿노트가 가져오기에서 죽는 조건(codec 기본 브랜치). 쓰기 전에 막는다.
    throw new Error(`TPL_OUTLINE_COUNT_MISMATCH quads ${quadCount(pen.centerline)} outlines ${pen.outlines.length}`);
  }
  const order = pen.brushQuadOrder ?? "goodparse";
  const kinds: number[] = [];
  const moves: number[] = [];
  const quads: number[] = [];
  const bits = (v: number) => float32ToBits(v);
  for (const sp of pen.centerline) {
    kinds.push(brush ? 2 : 0);
    moves.push(...sp.move.map(bits));
    for (const { c, p } of sp.quads) {
      kinds.push(brush ? 3 : 1);
      if (brush && order === "goodparse") quads.push(bits(c[0]), bits(c[1]), bits(p[0]), bits(p[1]), bits(c[2]), bits(p[2]));
      else quads.push(bits(c[0]), bits(c[1]), bits(c[2]), bits(p[0]), bits(p[1]), bits(p[2]));
    }
  }
  const shift = brush ? 2 : 0;
  const counts: number[] = [];
  const types: number[] = [];
  const oMoves: number[] = [];
  const oQuads: number[] = [];
  const cubics: number[] = [];
  const arcs: number[] = [];
  const clockwise: number[] = [];
  for (const sub of pen.outlines) {
    if (sub.length === 0 || sub[0].op !== "M") throw new Error("TPL_OUTLINE_MUST_START_WITH_MOVE");
    counts.push(sub.length);
    for (const cmd of sub) {
      types.push(OUTLINE_BASE[cmd.op] + shift);
      switch (cmd.op) {
        case "M":
          oMoves.push(bits(cmd.x), bits(cmd.y));
          break;
        case "Q":
          oQuads.push(bits(cmd.cx), bits(cmd.cy), bits(cmd.x), bits(cmd.y));
          break;
        case "C":
          cubics.push(bits(cmd.c1x), bits(cmd.c1y), bits(cmd.c2x), bits(cmd.c2y), bits(cmd.x), bits(cmd.y));
          break;
        case "A":
          arcs.push(bits(cmd.cx), bits(cmd.cy), bits(cmd.r), bits(cmd.a0), bits(cmd.a1));
          clockwise.push(cmd.clockwise ? 1 : 0);
          break;
        default:
          arcs.push(bits(cmd.cx), bits(cmd.cy), bits(cmd.rx), bits(cmd.ry), bits(cmd.a0), bits(cmd.a1), bits(cmd.rotation));
          clockwise.push(cmd.clockwise ? 1 : 0);
      }
    }
  }
  const values: TplValue[] = [pen.version ?? VARIABLE_PEN_DEFAULTS.version, kinds, moves, quads, counts, types, oMoves, oQuads, cubics, arcs, clockwise];
  if (brush) values.splice(1, 0, bits(pen.defaultRadius ?? VARIABLE_PEN_DEFAULTS.brushDefaultRadius));
  return encodeTpl({ signature: brush ? BRUSH_PEN_SIGNATURE : FOUNTAIN_PEN_SIGNATURE, values, floatSize: 4 });
}

export function isVariablePenSignature(signature: string | null | undefined): boolean {
  return signature === FOUNTAIN_PEN_SIGNATURE || signature === BRUSH_PEN_SIGNATURE;
}

/** 만년필, 붓 경로를 읽는다. 명령 비트 규칙은 위 주석 참고(회전 값이 붙은 노드는 회전 값을 건너뛴다). */
export function decodeVariablePen(image: TplImage, options: { brushQuadOrder?: BrushQuadOrder } = {}): VariablePen {
  const brush = image.signature === BRUSH_PEN_SIGNATURE;
  if (!brush && image.signature !== FOUNTAIN_PEN_SIGNATURE) throw new Error(`TPL_NOT_VARIABLE_PEN ${image.signature}`);
  const v = image.values as Array<number | number[]>;
  const off = brush ? 2 : 1;
  const version = v[0] as number;
  const defaultRadius = brush ? bitsToFloat32(v[1] as number) : null;
  const [kinds, movesRaw, quadsRaw, counts, types, oMovesRaw, oQuadsRaw, cubicsRaw, arcsRaw, flags] = v.slice(off) as number[][];
  const f = (a: number[]) => a.map(bitsToFloat32);
  const moves = f(movesRaw);
  const quads = f(quadsRaw);
  const order = options.brushQuadOrder ?? "goodparse";
  const centerline: VariableSubpath[] = [];
  let mi = 0;
  let qi = 0;
  for (const k of kinds) {
    if (k > 7) throw new Error(`TPL_UNKNOWN_NODE ${k}`);
    const own = !brush || (k & 2) !== 0;
    const extra = (k & 4) !== 0;
    if (!brush && (k === 2 || k === 3 || k === 6)) throw new Error(`TPL_UNSUPPORTED_CENTERLINE_NODE ${k}`);
    if ((k & 1) === 0) {
      const n = own ? 3 : 2;
      if (mi + n > moves.length) throw new Error("TPL_MOVE_MISSING");
      const r = own ? moves[mi + 2] : (defaultRadius as number);
      centerline.push({ move: [moves[mi], moves[mi + 1], r], quads: [] });
      mi += n + (extra ? 1 : 0);
    } else {
      const n = own ? 6 : 4;
      if (qi + n > quads.length || centerline.length === 0) throw new Error("TPL_QUAD_WITHOUT_MOVE");
      const q = quads.slice(qi, qi + n);
      let c: RadiusPoint;
      let p: RadiusPoint;
      if (!own) {
        c = [q[0], q[1], defaultRadius as number];
        p = [q[2], q[3], defaultRadius as number];
      } else if (brush && order === "goodparse") {
        c = [q[0], q[1], q[4]];
        p = [q[2], q[3], q[5]];
      } else {
        c = [q[0], q[1], q[2]];
        p = [q[3], q[4], q[5]];
      }
      centerline[centerline.length - 1].quads.push({ c, p });
      qi += n + (extra ? 3 : 0);
    }
  }
  if (mi !== moves.length || qi !== quads.length) throw new Error(`TPL_NODE_COUNT_MISMATCH ${mi}/${moves.length} ${qi}/${quads.length}`);

  const pools = { M: f(oMovesRaw), Q: f(oQuadsRaw), C: f(cubicsRaw), A: f(arcsRaw) };
  const pos = { M: 0, Q: 0, C: 0, A: 0 };
  const take = (key: keyof typeof pos, n: number) => {
    const out = pools[key].slice(pos[key], pos[key] + n);
    if (out.length !== n) throw new Error(`TPL_OUTLINE_POOL_SHORT ${key}`);
    pos[key] += n;
    return out;
  };
  let ti = 0;
  let fi = 0;
  const shift = brush ? 2 : 0;
  const outlines: OutlineCommand[][] = [];
  for (const count of counts) {
    const sub: OutlineCommand[] = [];
    for (let k = 0; k < count; k += 1) {
      if (ti >= types.length) throw new Error("TPL_OUTLINE_TYPES_SHORT");
      const code = types[ti++] - shift;
      if (code === 0 || code === 4) {
        const m = take("M", code === 0 ? 2 : 3);
        sub.push({ op: "M", x: m[0], y: m[1] });
      } else if (code === 1 || code === 5) {
        const q = take("Q", code === 1 ? 4 : 5);
        sub.push({ op: "Q", cx: q[0], cy: q[1], x: q[2], y: q[3] });
      } else if (code === 2) {
        const c = take("C", 6);
        sub.push({ op: "C", c1x: c[0], c1y: c[1], c2x: c[2], c2y: c[3], x: c[4], y: c[5] });
      } else if (code === 3) {
        const a = take("A", 5);
        sub.push({ op: "A", cx: a[0], cy: a[1], r: a[2], a0: a[3], a1: a[4], clockwise: (flags[fi++] ?? 1) !== 0 });
      } else if (code === 6) {
        const e = take("A", 7);
        sub.push({ op: "E", cx: e[0], cy: e[1], rx: e[2], ry: e[3], a0: e[4], a1: e[5], rotation: e[6], clockwise: (flags[fi++] ?? 1) !== 0 });
      } else {
        throw new Error(`TPL_UNKNOWN_OUTLINE_COMMAND ${code + shift}`);
      }
    }
    outlines.push(sub);
  }
  if (ti !== types.length) throw new Error("TPL_OUTLINE_TYPES_LEFT");
  for (const key of ["M", "Q", "C", "A"] as const) if (pos[key] !== pools[key].length) throw new Error(`TPL_OUTLINE_POOL_LEFT ${key}`);
  return { kind: brush ? "brush" : "fountain", version, defaultRadius, centerline, outlines };
}

// ---------------------------------------------------------------------------
// 가변 굵기 중심선과 캡슐 윤곽 만들기

export type VariableGeometryOptions = {
  /** 윤곽 옆선 cubic의 허용 오차(페이지 단위). 기본 0.15 */
  tolerance?: number;
  /** 한 quad 구간이 꺾이는 최대 각도(라디안). 넘으면 같은 곡선을 둘로 나눈다. 기본 60° */
  maxTurn?: number;
  /** 반폭 하한(codec 개선 브랜치와 같은 0.05) */
  minRadius?: number;
  /** 점 하나짜리 획에 더하는 짧은 거리(codec과 같은 0.01) */
  dotLength?: number;
  /** 주면 polylineToMidpointQuadPath처럼 꼭짓점 근처 제어점을 더해 모서리 오차를 이 값 아래로 둔다. 기본 끔. curve "midpoint"에서만. */
  cornerTolerance?: number;
  /**
   * 중심선을 점들에서 만드는 방식.
   * "through"(기본): 곡선이 입력 점을 모두 지난다. 점마다 접선을 정해 이웃한 두 점 사이를 2차 Bézier 하나(접선이 맞지
   *   않으면 둘)로 잇는다. 꺾임이 cornerDegrees보다 큰 점은 모서리로 남긴다. 점을 줄인 획(lib/ink-medial-strokes.ts)에서
   *   점 사이의 휜 모양을 되살리고, 구간 수가 점 수 − 1에 가깝다.
   * "midpoint": 입력 점이 제어점이고 끝점은 연속한 제어점의 중점이다(굿노트 손글씨 관찰). 모서리가 둥글게 깎인다.
   * "polyline": 점 사이를 곧은 구간으로 잇는다.
   */
  curve?: "through" | "midpoint" | "polyline";
  /** curve "through"에서 이 각도(도)보다 크게 꺾이는 점은 모서리로 둔다. 기본 50 */
  cornerDegrees?: number;
  /**
   * 중심선 저장 좌표 간격(페이지 단위). 중심선 좌표와 반폭(snapRadius)을 반올림해 ZIP 압축이 잘 되게 한다.
   * 0이면 그대로. 기본 1/32(0.017pt, lib/ink-medial-strokes.ts 출력 간격과 같음).
   */
  coordinateStep?: number;
  /** 윤곽(옆선 cubic과 move) 좌표 간격. 0이면 그대로. 기본 1/8(0.068pt, 0.024mm). 원호 시작점과 최대 0.09단위 어긋난다. */
  outlineStep?: number;
  /** 끝 원호 각도 간격(라디안). 0이면 그대로. 기본 π/512(옆선 끝 방향이 0.18° 안에서 바뀐다). */
  angleStep?: number;
};

export const VARIABLE_GEOMETRY_DEFAULTS = {
  tolerance: 0.15,
  maxTurnDegrees: 60,
  cornerDegrees: 50,
  coordinateStep: 1 / 32,
  outlineStep: 1 / 8,
  angleStep: Math.PI / 512,
} as const;

const lerp3 = (a: RadiusPoint, b: RadiusPoint, t: number): RadiusPoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * 점과 반폭으로 중심선(2차 Bézier 구간들)을 만든다. 기본(curve "through")은 곡선이 입력 점을 모두 지나고 반폭은 점 사이에서
 * 선형으로 바뀐다. curve "midpoint"는 굿노트 손글씨처럼 입력 점이 제어점이고 끝점은 연속한 제어점의 중점이다(goodparse 관찰).
 * 많이 꺾이는 구간은 de Casteljau로 나눈다(곡선 모양은 그대로). 점이 하나뿐이면 dotLength만큼 떨어진 점을 더한다.
 * 좌표와 반폭은 coordinateStep으로 반올림한다(점 하나짜리 획은 반올림하지 않는다).
 *
 * 크기(실제 판서 A4 한 장, 2427획, 점 35,541개): 예전 기본(midpoint, 30° 분할, 반올림 없음)은 구간 57,726개, 4.71MB였다.
 * through는 구간을 나눌 일이 거의 없어 구간 33,060개가 되고, 좌표 반올림으로 ZIP 압축이 잘 되어 만년필 약 1.9MB, 붓 약 1.95MB(10진 MB)가 된다.
 */
export function variableCenterline(points: ReadonlyArray<Point>, radii: ReadonlyArray<number>, options: VariableGeometryOptions = {}): VariableSubpath {
  if (points.length === 0) throw new Error("PATH_EMPTY_POLYLINE");
  if (points.length !== radii.length) throw new Error("PATH_RADII_LENGTH");
  const minRadius = options.minRadius ?? 0.05;
  const pts: RadiusPoint[] = [];
  points.forEach(([x, y], k) => {
    const r = Math.max(minRadius, radii[k]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(r)) throw new Error("PATH_BAD_POINT");
    const prev = pts[pts.length - 1];
    if (prev && prev[0] === x && prev[1] === y) pts[pts.length - 1] = [x, y, Math.max(prev[2], r)];
    else pts.push([x, y, r]);
  });
  if (pts.length === 1) {
    const [x, y, r] = pts[0];
    const end: RadiusPoint = [x + (options.dotLength ?? 0.01), y, r];
    return { move: pts[0], quads: [{ c: lerp3(pts[0], end, 0.5), p: end }] };
  }
  const curve = options.curve ?? "through";
  const step = options.coordinateStep ?? VARIABLE_GEOMETRY_DEFAULTS.coordinateStep;
  if (!(step >= 0)) throw new Error("PATH_BAD_STEP");
  const maxTurn = options.maxTurn ?? (VARIABLE_GEOMETRY_DEFAULTS.maxTurnDegrees * Math.PI) / 180;
  if (curve !== "midpoint") {
    const raw = curve === "polyline" ? polylineQuads(pts) : throughQuads(pts, ((options.cornerDegrees ?? VARIABLE_GEOMETRY_DEFAULTS.cornerDegrees) * Math.PI) / 180);
    return roundSubpath({ move: pts[0], quads: splitTurns(pts[0], raw, maxTurn) }, step);
  }
  let controls = pts;
  if (options.cornerTolerance !== undefined) {
    if (!(options.cornerTolerance > 0)) throw new Error("PATH_BAD_TOLERANCE");
    const delta = 4 * options.cornerTolerance;
    controls = [pts[0]];
    for (let k = 1; k < pts.length; k += 1) {
      const a = pts[k - 1];
      const b = pts[k];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d = Math.min(delta, len / 2) / len;
      const p1 = lerp3(a, b, d);
      const p2 = lerp3(a, b, 1 - d);
      controls.push(p1);
      if (p2[0] !== p1[0] || p2[1] !== p1[1]) controls.push(p2);
      controls.push(b);
    }
  }
  const raw: VariableQuad[] = [];
  for (let k = 0; k < controls.length; k += 1) {
    const c = controls[k];
    const next = controls[k + 1] ?? c;
    raw.push({ c, p: lerp3(c, next, 0.5) });
  }
  return roundSubpath({ move: controls[0], quads: splitTurns(controls[0], raw, maxTurn) }, step);
}

const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

/** 반폭은 상대 오차 1/64 이하(간격이 반폭의 1/32 이하)로 반올림한다(가는 획의 굵기가 좌표 간격 때문에 크게 바뀌지 않게). */
function snapRadius(r: number, step: number): number {
  if (!(step > 0) || !(r > 0)) return r;
  const rel = 2 ** (Math.floor(Math.log2(r)) - 5);
  return snap(r, Math.min(step, rel));
}

/** 중심선 좌표를 step 간격으로, 반폭을 snapRadius로 반올림한다. */
function roundSubpath(sp: VariableSubpath, step: number): VariableSubpath {
  if (!(step > 0)) return sp;
  const r = (p: RadiusPoint): RadiusPoint => [snap(p[0], step), snap(p[1], step), snapRadius(p[2], step)];
  return { move: r(sp.move), quads: sp.quads.map(q => ({ c: r(q.c), p: r(q.p) })) };
}

/** 많이 꺾이는 구간을 de Casteljau로 나눈다(곡선 모양은 그대로). */
function splitTurns(first: RadiusPoint, raw: ReadonlyArray<VariableQuad>, maxTurn: number): VariableQuad[] {
  const quads: VariableQuad[] = [];
  let start = first;
  const split = (p0: RadiusPoint, q: VariableQuad, depth: number) => {
    const a = [q.c[0] - p0[0], q.c[1] - p0[1]];
    const b = [q.p[0] - q.c[0], q.p[1] - q.c[1]];
    const la = Math.hypot(a[0], a[1]);
    const lb = Math.hypot(b[0], b[1]);
    const turn = la > 0 && lb > 0 ? Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (la * lb)))) : 0;
    if (turn <= maxTurn || depth >= 6) {
      quads.push(q);
      return;
    }
    const m0 = lerp3(p0, q.c, 0.5);
    const m1 = lerp3(q.c, q.p, 0.5);
    const mid = lerp3(m0, m1, 0.5);
    split(p0, { c: m0, p: mid }, depth + 1);
    split(mid, { c: m1, p: q.p }, depth + 1);
  };
  for (const q of raw) {
    split(start, q, 0);
    start = q.p;
  }
  return quads;
}

/** 점 사이를 곧은 구간(제어점 = 가운데)으로 잇는다. */
function polylineQuads(pts: ReadonlyArray<RadiusPoint>): VariableQuad[] {
  const out: VariableQuad[] = [];
  for (let k = 1; k < pts.length; k += 1) out.push({ c: lerp3(pts[k - 1], pts[k], 0.5), p: pts[k] });
  return out;
}

const unit = (x: number, y: number): Vec | null => {
  const l = Math.hypot(x, y);
  return l > 0 ? [x / l, y / l] : null;
};

/**
 * 점을 모두 지나는 2차 Bézier 구간들. 점마다 들어오는 접선과 나가는 접선을 정한다(부드러운 점은 앞뒤 방향의 평균,
 * 모서리와 열린 끝은 그쪽 구간 방향). 두 점 사이 구간의 제어점은 양 끝 접선의 교점이다. 교점이 구간 밖으로
 * 멀거나(접선이 현과 45°보다 벌어짐) 없으면(S자) 가운데에서 현 방향 접선으로 나눠 둘로 잇고, 그래도 안 되면 곧게 잇는다.
 * 반폭은 구간 안에서 선형으로 바뀐다(제어점 반폭 = 양 끝 평균). 처음과 끝 점이 같으면 닫힌 획으로 보고 접선을 이어 붙인다.
 */
function throughQuads(pts: ReadonlyArray<RadiusPoint>, corner: number): VariableQuad[] {
  const n = pts.length;
  const closed = n > 3 && pts[0][0] === pts[n - 1][0] && pts[0][1] === pts[n - 1][1];
  const dir = (a: RadiusPoint, b: RadiusPoint) => unit(b[0] - a[0], b[1] - a[1]) as Vec;
  const cosCorner = Math.cos(corner);
  // tin[k]: 점 k로 들어오는 접선, tout[k]: 점 k에서 나가는 접선(null이면 정하지 않음)
  const tin: Array<Vec | null> = new Array(n).fill(null);
  const tout: Array<Vec | null> = new Array(n).fill(null);
  for (let k = 0; k < n; k += 1) {
    let prev: RadiusPoint | null = k > 0 ? pts[k - 1] : null;
    let next: RadiusPoint | null = k < n - 1 ? pts[k + 1] : null;
    if (closed && k === 0) prev = pts[n - 2];
    if (closed && k === n - 1) next = pts[1];
    if (!prev || !next) continue;
    const a = dir(prev, pts[k]);
    const b = dir(pts[k], next);
    if (a[0] * b[0] + a[1] * b[1] < cosCorner) {
      tin[k] = a;
      tout[k] = b;
      continue;
    }
    const t = unit(a[0] + b[0], a[1] + b[1]) ?? b;
    tin[k] = t;
    tout[k] = t;
  }
  const out: VariableQuad[] = [];
  const COS_MAX = Math.cos(Math.PI / 4);
  /** a에서 ta 방향, b로 tb 방향으로 들어가는 2차 Bézier의 제어점. 맞지 않으면 null */
  const control = (a: RadiusPoint, b: RadiusPoint, ta: Vec | null, tb: Vec | null): RadiusPoint | null => {
    const ch = dir(a, b);
    const reflect = (t: Vec): Vec => {
      const d = 2 * (t[0] * ch[0] + t[1] * ch[1]);
      return [d * ch[0] - t[0], d * ch[1] - t[1]];
    };
    if (!ta && !tb) return lerp3(a, b, 0.5);
    const u = ta ?? reflect(tb as Vec);
    const v = tb ?? reflect(ta as Vec);
    const cu = u[0] * ch[0] + u[1] * ch[1];
    const cv = v[0] * ch[0] + v[1] * ch[1];
    if (cu < COS_MAX || cv < COS_MAX) return null;
    // a + s·u = b − w·v 를 푼다
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const det = u[0] * v[1] - u[1] * v[0];
    if (Math.abs(det) < 1e-9) {
      // 접선이 나란하다: 둘 다 현 방향이면 곧은 구간, 아니면(S자) 맞지 않음
      return Math.abs(u[0] * ch[1] - u[1] * ch[0]) < 1e-6 ? lerp3(a, b, 0.5) : null;
    }
    const s = (dx * v[1] - dy * v[0]) / det;
    const w = (u[0] * dy - u[1] * dx) / det;
    const len = Math.hypot(dx, dy);
    if (!(s > 1e-6 * len && w > 1e-6 * len)) return null;
    return [a[0] + s * u[0], a[1] + s * u[1], (a[2] + b[2]) / 2];
  };
  for (let k = 1; k < n; k += 1) {
    const a = pts[k - 1];
    const b = pts[k];
    const ta = tout[k - 1];
    const tb = tin[k];
    const c = control(a, b, ta, tb);
    if (c) {
      out.push({ c, p: b });
      continue;
    }
    const m = lerp3(a, b, 0.5);
    const ch = dir(a, b);
    const c1 = control(a, m, ta, ch);
    const c2 = control(m, b, ch, tb);
    if (c1 && c2) out.push({ c: c1, p: m }, { c: c2, p: b });
    else out.push({ c: m, p: b });
  }
  return out;
}

type Vec = [number, number];

function quadAt(p0: RadiusPoint, q: VariableQuad, t: number): RadiusPoint {
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return [a * p0[0] + b * q.c[0] + c * q.p[0], a * p0[1] + b * q.c[1] + c * q.p[1], a * p0[2] + b * q.c[2] + c * q.p[2]];
}

/** 구간의 단위 접선. 속도가 0이면(제어점이 끝점과 같으면) 시작점에서 끝점 방향을 쓴다. */
function quadTangent(p0: RadiusPoint, q: VariableQuad, t: number): Vec {
  let dx = 2 * ((1 - t) * (q.c[0] - p0[0]) + t * (q.p[0] - q.c[0]));
  let dy = 2 * ((1 - t) * (q.c[1] - p0[1]) + t * (q.p[1] - q.c[1]));
  let len = Math.hypot(dx, dy);
  const scale = Math.hypot(q.p[0] - p0[0], q.p[1] - p0[1]) + Math.hypot(q.c[0] - p0[0], q.c[1] - p0[1]);
  if (len <= 1e-9 * Math.max(1, scale)) {
    dx = q.p[0] - p0[0];
    dy = q.p[1] - p0[1];
    len = Math.hypot(dx, dy);
    if (len === 0) return [1, 0];
  }
  return [dx / len, dy / len];
}

/** side +1은 왼쪽(n = (-ty, tx)), -1은 오른쪽 옆선 */
function offsetAt(p0: RadiusPoint, q: VariableQuad, t: number, side: 1 | -1): Vec {
  const [x, y, r] = quadAt(p0, q, t);
  const [tx, ty] = quadTangent(p0, q, t);
  return [x - ty * r * side, y + tx * r * side];
}

function cubicAt(a: Vec, c1: Vec, c2: Vec, b: Vec, s: number): Vec {
  const u = 1 - s;
  return [
    u * u * u * a[0] + 3 * u * u * s * c1[0] + 3 * u * s * s * c2[0] + s * s * s * b[0],
    u * u * u * a[1] + 3 * u * u * s * c1[1] + 3 * u * s * s * c2[1] + s * s * s * b[1],
  ];
}

/**
 * 옆선 offsetAt(t)를 t0 → t1(감소해도 된다)로 cubic 여러 개로 맞춘다. 양 끝점은 ends로 받는다(원호와 맞물리는 점).
 * step > 0이면 cubic 좌표를 그 간격으로 반올림한다.
 */
function fitOffsetSide(p0: RadiusPoint, q: VariableQuad, side: 1 | -1, t0: number, t1: number, tolerance: number, ends: [Vec, Vec], step: number): OutlineCommand[] {
  const h = 1e-5;
  const deriv = (t: number): Vec => {
    const ta = Math.max(0, t - h);
    const tb = Math.min(1, t + h);
    const a = offsetAt(p0, q, ta, side);
    const b = offsetAt(p0, q, tb, side);
    return [(b[0] - a[0]) / (tb - ta), (b[1] - a[1]) / (tb - ta)];
  };
  let out: OutlineCommand[] = [];
  for (let pieces = 1; pieces <= 8; pieces += 1) {
    out = [];
    let worst = 0;
    for (let k = 0; k < pieces; k += 1) {
      const ta = t0 + ((t1 - t0) * k) / pieces;
      const tb = t0 + ((t1 - t0) * (k + 1)) / pieces;
      const dt = tb - ta;
      const a = k === 0 ? ends[0] : offsetAt(p0, q, ta, side);
      const b = k === pieces - 1 ? ends[1] : offsetAt(p0, q, tb, side);
      const da = deriv(ta);
      const db = deriv(tb);
      const c1: Vec = [a[0] + (da[0] * dt) / 3, a[1] + (da[1] * dt) / 3];
      const c2: Vec = [b[0] - (db[0] * dt) / 3, b[1] - (db[1] * dt) / 3];
      const bs: Vec = [snap(b[0], step), snap(b[1], step)];
      const c1s: Vec = [snap(c1[0], step), snap(c1[1], step)];
      const c2s: Vec = [snap(c2[0], step), snap(c2[1], step)];
      const as: Vec = [snap(a[0], step), snap(a[1], step)];
      for (let s = 1; s <= 7; s += 1) {
        const want = offsetAt(p0, q, ta + (dt * s) / 8, side);
        const got = cubicAt(as, c1s, c2s, bs, s / 8);
        worst = Math.max(worst, Math.hypot(want[0] - got[0], want[1] - got[1]));
      }
      out.push({ op: "C", c1x: c1s[0], c1y: c1s[1], c2x: c2s[0], c2y: c2s[1], x: bs[0], y: bs[1] });
    }
    if (worst <= tolerance) break;
  }
  return out;
}

export type CapsuleOptions = {
  /** 옆선 cubic 허용 오차(페이지 단위). 기본 0.15 */
  tolerance?: number;
  /** 윤곽 좌표 간격(0이면 그대로). 끝점을 반올림하면 원호 시작점과 이 간격의 절반 남짓까지 어긋날 수 있다. */
  step?: number;
  /** 끝 원호 각도 간격(라디안, 0이면 그대로). 같은 각도가 되풀이되어 압축이 잘 된다. */
  angleStep?: number;
};

/**
 * 중심선 quad 구간 하나의 닫힌 캡슐 윤곽. 굿노트 자체 파일의 순서를 따른다:
 * 왼쪽 옆선 시작점으로 move, 왼쪽 옆선 cubic, 끝 원호(끝점 중심, 반폭, 시계 방향 표시, 각도 π 감소),
 * 오른쪽 옆선을 거꾸로 cubic, 시작 원호(시작점 중심, 각도 π 감소). 마지막 원호가 처음 move 점에서 끝난다.
 * 옆선의 양 끝은 원호 각도에서 계산하므로(각도를 반올림해도) 원호와 옆선이 같은 점에서 만난다.
 */
export function quadCapsuleOutline(p0: RadiusPoint, q: VariableQuad, tolerance: number | CapsuleOptions = VARIABLE_GEOMETRY_DEFAULTS.tolerance): OutlineCommand[] {
  const o: CapsuleOptions = typeof tolerance === "number" ? { tolerance } : tolerance;
  const tol = o.tolerance ?? VARIABLE_GEOMETRY_DEFAULTS.tolerance;
  const step = o.step ?? 0;
  const g = o.angleStep ?? 0;
  const qa = (a: number) => (g > 0 ? Math.round(a / g) * g : a);
  const [t1x, t1y] = quadTangent(p0, q, 1);
  const endStart = qa(Math.atan2(t1x, -t1y)); // +n = (-ty, tx)의 각도
  const [t0x, t0y] = quadTangent(p0, q, 0);
  const startStart = qa(Math.atan2(-t0x, t0y)); // -n = (ty, -tx)의 각도
  const at = (c: RadiusPoint, a: number): Vec => [c[0] + c[2] * Math.cos(a), c[1] + c[2] * Math.sin(a)];
  const left0 = at(p0, startStart - Math.PI);
  const left1 = at(q.p, endStart);
  const right1 = at(q.p, endStart - Math.PI);
  const right0 = at(p0, startStart);
  const out: OutlineCommand[] = [];
  out.push({ op: "M", x: snap(left0[0], step), y: snap(left0[1], step) });
  out.push(...fitOffsetSide(p0, q, 1, 0, 1, tol, [left0, left1], step));
  out.push({ op: "A", cx: q.p[0], cy: q.p[1], r: q.p[2], a0: endStart, a1: endStart - Math.PI, clockwise: true });
  out.push(...fitOffsetSide(p0, q, -1, 1, 0, tol, [right1, right0], step));
  out.push({ op: "A", cx: p0[0], cy: p0[1], r: p0[2], a0: startStart, a1: startStart - Math.PI, clockwise: true });
  return out;
}

/** 중심선 하위 경로의 quad마다 캡슐 윤곽을 만든다(윤곽 수 = quad 수). */
export function variableOutlines(centerline: ReadonlyArray<VariableSubpath>, tolerance: number | CapsuleOptions = VARIABLE_GEOMETRY_DEFAULTS.tolerance): OutlineCommand[][] {
  const out: OutlineCommand[][] = [];
  for (const sp of centerline) {
    let start = sp.move;
    for (const q of sp.quads) {
      out.push(quadCapsuleOutline(start, q, tolerance));
      start = q.p;
    }
  }
  return out;
}

/** 점과 지름(페이지 단위)으로 만년필이나 붓 경로 전체(중심선 + 윤곽)를 만든다. 반폭 = 지름 / 2. */
export function buildVariablePen(kind: VariablePenKind, points: ReadonlyArray<Point>, diameters: ReadonlyArray<number>, options: VariableGeometryOptions = {}): VariablePen {
  const centerline = [variableCenterline(points, diameters.map(d => d / 2), options)];
  return { kind, version: VARIABLE_PEN_DEFAULTS.version, defaultRadius: kind === "brush" ? VARIABLE_PEN_DEFAULTS.brushDefaultRadius : null, centerline, outlines: variableOutlines(centerline, { tolerance: options.tolerance, step: options.outlineStep ?? VARIABLE_GEOMETRY_DEFAULTS.outlineStep, angleStep: options.angleStep ?? VARIABLE_GEOMETRY_DEFAULTS.angleStep }) };
}

/** 윤곽 하위 경로를 폴리곤 점으로 펼친다(미리보기, 검증용). 원호는 굿노트 규칙(clockwise = 각도 감소)으로 그린다. */
export function flattenOutline(sub: ReadonlyArray<OutlineCommand>, step = 0.5): Point[] {
  const out: Point[] = [];
  let cur: Point | null = null;
  const push = (p: Point) => {
    out.push(p);
    cur = p;
  };
  for (const cmd of sub) {
    if (cmd.op === "M") push([cmd.x, cmd.y]);
    else if (cmd.op === "Q" || cmd.op === "C") {
      const from: Point = cur ?? [cmd.x, cmd.y];
      const n = 16;
      for (let s = 1; s <= n; s += 1) {
        const t = s / n;
        const u = 1 - t;
        if (cmd.op === "Q") push([u * u * from[0] + 2 * u * t * cmd.cx + t * t * cmd.x, u * u * from[1] + 2 * u * t * cmd.cy + t * t * cmd.y]);
        else push(cubicAt([from[0], from[1]], [cmd.c1x, cmd.c1y], [cmd.c2x, cmd.c2y], [cmd.x, cmd.y], t));
      }
    } else {
      const rx = cmd.op === "A" ? cmd.r : cmd.rx;
      const ry = cmd.op === "A" ? cmd.r : cmd.ry;
      const rot = cmd.op === "A" ? 0 : cmd.rotation;
      const tau = 2 * Math.PI;
      let sweep = cmd.clockwise ? (((cmd.a0 - cmd.a1) % tau) + tau) % tau : (((cmd.a1 - cmd.a0) % tau) + tau) % tau;
      if (sweep === 0 && cmd.a0 !== cmd.a1) sweep = tau;
      const dir = cmd.clockwise ? -1 : 1;
      const n = Math.max(2, Math.ceil((sweep * Math.max(rx, ry)) / step));
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      for (let s = 0; s <= n; s += 1) {
        const a = cmd.a0 + (dir * sweep * s) / n;
        const px = rx * Math.cos(a);
        const py = ry * Math.sin(a);
        push([cmd.cx + cr * px - sr * py, cmd.cy + sr * px + cr * py]);
      }
    }
  }
  return out;
}

/** 중심선을 (x, y, r) 표본으로 펼친다(검증용). */
export function renderVariableSubpath(sp: VariableSubpath, stepsPerQuad = 8): RadiusPoint[] {
  const out: RadiusPoint[] = [sp.move];
  let start = sp.move;
  for (const q of sp.quads) {
    for (let s = 1; s <= stepsPerQuad; s += 1) out.push(quadAt(start, q, s / stepsPerQuad));
    start = q.p;
  }
  return out;
}

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

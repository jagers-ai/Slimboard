// 펜 획(폴리라인)을 PDF Ink 주석으로 담는 순수 PDF 작성기.
// DOM, canvas, 외부 패키지 없이 브라우저, Web Worker, Node 24에서 그대로 돈다.
// 획은 페이지 내용이 아니라 주석(/Subtype /Ink)과 외관 스트림(/AP /N)으로 넣어,
// 주석을 편집 가능하게 가져오는 앱에서는 펜 획이 되고 다른 앱에서도 똑같이 보이게 한다.

export type InkPdfColor = "black" | "blue" | "red" | "green";

export type InkPdfStroke = {
  /** 사진 픽셀 좌표(좌상단 원점, y는 아래로 증가). */
  points: ReadonlyArray<readonly [number, number]>;
  color: InkPdfColor;
  /** 사진 픽셀 단위 선 굵기. */
  width: number;
};

export type InkPdfInput = {
  /** 획 좌표계(사진 픽셀) 크기. */
  width: number;
  height: number;
  strokes: ReadonlyArray<InkPdfStroke>;
  /** 문서 제목(한글 가능). */
  title?: string;
  /** 있으면 2쪽에 원본 사진을 재인코딩 없이 넣는다. 크기와 EXIF 방향은 JPEG 헤더에서 읽는다. */
  photo?: { jpeg: Uint8Array };
  /** /M, /CreationDate, /NM, /ID에 쓰는 시각. 기본은 지금. */
  createdAt?: Date;
};

export type JpegInfo = {
  /** 저장된 픽셀 크기(EXIF 방향 적용 전). */
  width: number;
  height: number;
  components: 1 | 3 | 4;
  /** EXIF Orientation 1~8. 없으면 1. */
  orientation: number;
  adobe: boolean;
};

/** 쪽 좌표(pt, 좌하단 원점)로 바꾼 획. 좌표는 문자열로 이미 포맷되어 있다. */
export type InkPdfPreparedStroke = {
  coords: string[];
  rect: [number, number, number, number];
  lineWidth: number;
  color: InkPdfColor;
};

/** PDF 쪽의 긴 변(A4 긴 변, pt). */
export const INK_PDF_LONG_SIDE = 842;
export const INK_PDF_MIN_LINE_WIDTH = 0.8;
export const INK_PDF_MAX_LINE_WIDTH = 6;

/** 굿노트 펜 기본 색에 가까운 진한 색(DeviceRGB, 0~1). */
export const INK_PDF_COLORS: Readonly<Record<InkPdfColor, readonly [number, number, number]>> = {
  black: [0.04, 0.04, 0.05], // #0A0A0D
  blue: [0.07, 0.27, 0.71], // #1245B5
  red: [0.8, 0.1, 0.12], // #CC1A1F
  green: [0.07, 0.5, 0.24], // #12803D
};

/** 획 좌표계 크기를 긴 변 842pt 쪽 크기와 배율로 바꾼다. */
export function inkPdfPageSize(width: number, height: number) {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) {
    throw new RangeError("ink-pdf: width and height must be positive finite numbers");
  }
  const scale = INK_PDF_LONG_SIDE / Math.max(width, height);
  return { width: round2(width * scale), height: round2(height * scale), scale };
}

/** 사진 픽셀 굵기를 pt로 바꾸고 0.8~6pt로 제한한다. */
export function inkPdfLineWidth(pixelWidth: number, scale: number) {
  const pt = pixelWidth * scale;
  if (!Number.isFinite(pt)) return INK_PDF_MIN_LINE_WIDTH;
  return round2(Math.min(INK_PDF_MAX_LINE_WIDTH, Math.max(INK_PDF_MIN_LINE_WIDTH, pt)));
}

/** 획의 색 연산자 문자열("r g b"). */
function inkPdfColorOperands(color: InkPdfColor) {
  const rgb = INK_PDF_COLORS[color];
  return `${num(rgb[0])} ${num(rgb[1])} ${num(rgb[2])}`;
}

/** 쪽 좌표 획을 둥근 끝과 둥근 이음으로 그리는 내용 스트림 조각. */
export function inkPdfStrokePath(stroke: InkPdfPreparedStroke) {
  const c = stroke.coords;
  let path = `${c[0]} ${c[1]} m\n`;
  for (let k = 2; k < c.length; k += 2) path += `${c[k]} ${c[k + 1]} l\n`;
  return `q\n${inkPdfColorOperands(stroke.color)} RG\n${num(stroke.lineWidth)} w\n1 J\n1 j\n${path}S\nQ\n`;
}

/** 사진 픽셀 좌표 획을 쪽 좌표로 바꾸고, 잘못된 점과 빈 획을 걸러 낸다. */
export function prepareInkPdfStrokes(
  strokes: ReadonlyArray<InkPdfStroke>,
  scale: number,
  pageHeight: number,
): InkPdfPreparedStroke[] {
  const out: InkPdfPreparedStroke[] = [];
  if (!Array.isArray(strokes)) return out;
  for (const stroke of strokes) {
    if (!stroke || !Array.isArray(stroke.points)) continue;
    const coords: string[] = [];
    let lastX = NaN;
    let lastY = NaN;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of stroke.points) {
      if (!point) continue;
      const x = round2(point[0] * scale);
      const y = round2(pageHeight - point[1] * scale);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x === lastX && y === lastY) continue;
      coords.push(num(x), num(y));
      lastX = x;
      lastY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!coords.length) continue;
    if (coords.length === 2) {
      // 점 하나짜리 획은 둥근 끝을 가진 아주 짧은 선분으로 그려 점으로 보이게 한다.
      const x = round2(lastX + DOT_LENGTH);
      coords.push(num(x), num(lastY));
      maxX = x;
    }
    const lineWidth = inkPdfLineWidth(stroke.width, scale);
    const half = lineWidth / 2;
    const color = Object.prototype.hasOwnProperty.call(INK_PDF_COLORS, stroke.color) ? stroke.color : "black";
    out.push({
      coords,
      rect: [floor2(minX - half), floor2(minY - half), ceil2(maxX + half), ceil2(maxY + half)],
      lineWidth,
      color,
    });
  }
  return out;
}

export function buildInkPdf(input: InkPdfInput): Uint8Array {
  const page = inkPdfPageSize(input.width, input.height);
  const pageHeightExact = input.height * page.scale;
  const created = input.createdAt && Number.isFinite(input.createdAt.getTime()) ? input.createdAt : new Date();
  const pdfDate = formatPdfDate(created);
  const photo = input.photo ? readPhoto(input.photo.jpeg) : null;

  const strokes = prepareInkPdfStrokes(input.strokes, page.scale, pageHeightExact);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const docKey = created.getTime().toString(36);

  // 객체 번호: 1 Catalog, 2 Pages, 3 Info, 4 1쪽, 그다음 획마다 (주석, 외관) 한 쌍, 마지막에 사진 쪽.
  const firstAnnot = 5;
  const photoPage = firstAnnot + strokes.length * 2;
  const photoContents = photoPage + 1;
  const photoImage = photoPage + 2;
  const objectCount = photo ? photoImage : photoPage - 1;

  const w = createPdfWriter(objectCount);
  w.object(1, "<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>");
  w.object(2, `<< /Type /Pages /Kids [4 0 R${photo ? ` ${photoPage} 0 R` : ""}] /Count ${photo ? 2 : 1} >>`);
  w.object(3, infoDictionary(title, pdfDate));

  const mediaBox = `[0 0 ${num(page.width)} ${num(page.height)}]`;
  let annots = "";
  for (let i = 0; i < strokes.length; i += 1) annots += `${i ? " " : ""}${firstAnnot + i * 2} 0 R`;
  w.object(
    4,
    `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox} /Resources << >>${strokes.length ? ` /Annots [${annots}]` : ""} >>`,
  );

  for (let i = 0; i < strokes.length; i += 1) {
    const annot = firstAnnot + i * 2;
    w.object(annot, inkAnnotationDictionary(strokes[i], { page: 4, name: `slimboard-${docKey}-${i + 1}`, date: pdfDate, appearance: annot + 1 }));
    // 외관 스트림은 쪽 좌표 그대로 그린다. /BBox를 /Rect와 같게 두고 /Matrix를 단위 행렬로 두면
    // 변환된 BBox가 Rect와 일치해 추가 변환이 생기지 않는다(PDF 1.7 12.5.5).
    w.stream(annot + 1, formDictionary(strokes[i].rect), inkPdfStrokePath(strokes[i]));
  }

  if (photo) {
    const oriented = photo.orientation >= 5 ? [photo.height, photo.width] : [photo.width, photo.height];
    const size = inkPdfPageSize(oriented[0], oriented[1]);
    w.object(
      photoPage,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(size.width)} ${num(size.height)}] /Resources << /XObject << /Im0 ${photoImage} 0 R >> >> /Contents ${photoContents} 0 R >>`,
    );
    const m = orientationMatrix(photo.orientation, size.width, size.height);
    w.stream(photoContents, "", `q\n${m.map(num).join(" ")} cm\n/Im0 Do\nQ\n`);
    const colorSpace = photo.components === 1 ? "/DeviceGray" : photo.components === 3 ? "/DeviceRGB" : "/DeviceCMYK";
    const decode = photo.components === 4 && photo.adobe ? " /Decode [1 0 1 0 1 0 1 0]" : "";
    w.binaryStream(
      photoImage,
      `/Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} /ColorSpace ${colorSpace} /BitsPerComponent 8${decode} /Filter /DCTDecode`,
      photo.jpeg,
    );
  }

  const idSeed = `${created.getTime()}|${title}|${strokes.length}|${input.width}x${input.height}|${photo ? photo.jpeg.length : 0}`;
  return w.finish(`/Root 1 0 R /Info 3 0 R /ID [${documentId(idSeed)} ${documentId(idSeed)}]`);
}

/** Ink 주석 사전. appearance를 빼면 /AP 없는 주석이 된다. */
export function inkAnnotationDictionary(
  stroke: InkPdfPreparedStroke,
  options: { page: number; name: string; date: string; appearance?: number },
) {
  const r = stroke.rect;
  const ap = options.appearance ? ` /AP << /N ${options.appearance} 0 R >>` : "";
  return `<< /Type /Annot /Subtype /Ink /P ${options.page} 0 R /Rect [${num(r[0])} ${num(r[1])} ${num(r[2])} ${num(r[3])}] /NM (${options.name}) /M (${options.date}) /F 4 /C [${inkPdfColorOperands(stroke.color)}] /BS << /Type /Border /W ${num(stroke.lineWidth)} /S /S >> /InkList [[${stroke.coords.join(" ")}]]${ap} >>`;
}

/** 외관 스트림용 Form XObject 사전(스트림 /Length 제외). BBox는 주석 Rect와 같다. */
export function formDictionary(rect: readonly [number, number, number, number]) {
  return `/Type /XObject /Subtype /Form /FormType 1 /BBox [${num(rect[0])} ${num(rect[1])} ${num(rect[2])} ${num(rect[3])}] /Matrix [1 0 0 1 0 0] /Resources << >>`;
}

function infoDictionary(title: string, pdfDate: string) {
  return `<< ${title ? `/Title ${utf16beHex(title)} ` : ""}/Producer (Slimboard) /Creator (Slimboard) /CreationDate (${pdfDate}) /ModDate (${pdfDate}) >>`;
}

/** JPEG 헤더에서 크기, 색 성분 수, EXIF 방향을 읽는다. 쓸 수 없는 JPEG면 null. */
export function readJpegInfo(bytes: Uint8Array): JpegInfo | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let orientation = 1;
  let adobe = false;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = bytes[i + 1];
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1];
    }
    i += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 1 >= bytes.length) return null;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2 || i + length > bytes.length) return null;
    const body = i + 2;
    if (marker === 0xe1) orientation = readExifOrientation(bytes, body, i + length) ?? orientation;
    if (marker === 0xee && length >= 7 && ascii(bytes, body, 5) === "Adobe") adobe = true;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (length < 8) return null;
      const precision = bytes[body];
      const height = (bytes[body + 1] << 8) | bytes[body + 2];
      const width = (bytes[body + 3] << 8) | bytes[body + 4];
      const components = bytes[body + 5];
      if (precision !== 8 || !width || !height) return null;
      if (components !== 1 && components !== 3 && components !== 4) return null;
      return { width, height, components: components as 1 | 3 | 4, orientation, adobe };
    }
    i += length;
  }
  return null;
}

/**
 * 객체 번호 1..objectCount를 받아 헤더, 정확한 xref 오프셋, trailer, startxref를 쓴다.
 * 모든 문자열 조각은 ASCII여야 한다(바이트 오프셋 = 문자 수).
 */
export function createPdfWriter(objectCount: number) {
  const parts: Array<string | Uint8Array> = [];
  let text: string[] = [];
  let offset = 0;
  const offsets = new Array<number>(objectCount + 1).fill(-1);

  const raw = (s: string) => {
    text.push(s);
    offset += s.length;
  };
  const bytes = (b: Uint8Array) => {
    if (text.length) parts.push(text.join(""));
    text = [];
    parts.push(b);
    offset += b.length;
  };
  const begin = (n: number) => {
    if (!Number.isInteger(n) || n < 1 || n > objectCount || offsets[n] !== -1) throw new Error(`ink-pdf: bad object number ${n}`);
    offsets[n] = offset;
    raw(`${n} 0 obj\n`);
  };

  raw("%PDF-1.7\n");
  bytes(BINARY_COMMENT);

  return {
    object(n: number, body: string) {
      begin(n);
      raw(`${body}\nendobj\n`);
    },
    stream(n: number, dict: string, content: string) {
      begin(n);
      raw(`<< ${dict ? `${dict} ` : ""}/Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    },
    binaryStream(n: number, dict: string, content: Uint8Array) {
      begin(n);
      raw(`<< ${dict} /Length ${content.length} >>\nstream\n`);
      bytes(content);
      raw("\nendstream\nendobj\n");
    },
    finish(trailer: string): Uint8Array {
      const xrefAt = offset;
      let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
      for (let n = 1; n <= objectCount; n += 1) {
        if (offsets[n] < 0) throw new Error(`ink-pdf: object ${n} was not written`);
        xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
      }
      raw(xref);
      raw(`trailer\n<< /Size ${objectCount + 1} ${trailer} >>\nstartxref\n${xrefAt}\n%%EOF\n`);
      if (text.length) parts.push(text.join(""));
      text = [];

      const out = new Uint8Array(offset);
      const encoder = new TextEncoder();
      let at = 0;
      for (const part of parts) {
        if (typeof part === "string") {
          const { written } = encoder.encodeInto(part, out.subarray(at));
          if (written !== part.length) throw new Error("ink-pdf: non-ASCII text in PDF body");
          at += written;
        } else {
          out.set(part, at);
          at += part.length;
        }
      }
      if (at !== offset) throw new Error("ink-pdf: size mismatch");
      return out;
    },
  };
}

/** 소수 둘째 자리까지, 지수 표기와 -0, NaN 없이 쓴다. */
function num(n: number): string {
  if (!Number.isFinite(n)) return "0";
  let r = Math.round(n * 100) / 100;
  if (r === 0) return "0";
  if (r > 1e9) r = 1e9;
  if (r < -1e9) r = -1e9;
  return String(r);
}

/** PDF 날짜 문자열(UTC). */
function formatPdfDate(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** UTF-16BE BOM 16진 문자열(<FEFF...>). */
function utf16beHex(s: string) {
  let hex = "<FEFF";
  for (let i = 0; i < s.length; i += 1) hex += s.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  return `${hex}>`;
}

/** 시드 문자열로 만든 16바이트 문서 ID(<hex>). */
function documentId(seed: string) {
  return `<${fnv1a(seed, 0x811c9dc5)}${fnv1a(seed, 0x01000193)}${fnv1a(seed, 0x9e3779b9)}${fnv1a(seed, 0x85ebca6b)}>`;
}

const BINARY_COMMENT = new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
const DOT_LENGTH = 0.1;

function readPhoto(jpeg: Uint8Array) {
  const info = readJpegInfo(jpeg);
  if (!info) throw new TypeError("ink-pdf: photo.jpeg is not an 8-bit JPEG");
  return { ...info, jpeg };
}

// 단위 정사각형(이미지 공간)을 쪽 좌표로 옮기는 cm 행렬. EXIF 방향을 반영한다.
// 이미지 공간에서 u는 0열→마지막 열, v는 마지막 행(0)→0행(1)이다.
function orientationMatrix(orientation: number, w: number, h: number): number[] {
  switch (orientation) {
    case 2:
      return [-w, 0, 0, h, w, 0];
    case 3:
      return [-w, 0, 0, -h, w, h];
    case 4:
      return [w, 0, 0, -h, 0, h];
    case 5:
      return [0, -h, -w, 0, w, h];
    case 6:
      return [0, -h, w, 0, 0, h];
    case 7:
      return [0, h, w, 0, 0, 0];
    case 8:
      return [0, h, -w, 0, w, 0];
    default:
      return [w, 0, 0, h, 0, 0];
  }
}

function readExifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (end - start < 14 || ascii(bytes, start, 4) !== "Exif" || bytes[start + 4] !== 0 || bytes[start + 5] !== 0) return null;
  const tiff = start + 6;
  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!little && !big) return null;
  const u16 = (at: number) => (little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1]);
  const u32 = (at: number) =>
    little
      ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
      : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  if (u16(tiff + 2) !== 42) return null;
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k += 1) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function floor2(n: number) {
  return Math.floor(n * 100) / 100;
}

function ceil2(n: number) {
  return Math.ceil(n * 100) / 100;
}

function fnv1a(s: string, seed: number) {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  let s = "";
  for (let i = 0; i < length && start + i < bytes.length; i += 1) s += String.fromCharCode(bytes[start + i]);
  return s;
}

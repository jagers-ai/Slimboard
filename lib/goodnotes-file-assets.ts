// 굿노트 문서에 넣는 부속 파일: 단색 배경 PDF와 단색 썸네일 JPEG. 외부 패키지 없이 바이트를 직접 쓴다.
//
// - 배경 PDF: 굿노트는 페이지 배경(종이)을 PDF 첨부로 둔다(모든 자료 공통). natural-ink는 페이지와 같은 크기의
//   단색 PDF를, goodnotes-codec는 페이지 크기의 6/11 크기 PDF를 쓴다. 크기는 호출하는 쪽이 정한다.
//   guides는 실기기 시험용이다: 획과 같은 경로를 연한 색으로 배경에 그려, 굿노트 획이 그 위에 정확히 겹치는지
//   (위치와 굵기 해석)를 눈으로 비교하게 한다.
// - 썸네일: natural-ink는 획을 그린 thumbnail.jpg를 넣고, goodnotes-codec의 Document.new는 thumbnail.jpg를
//   쓰지 않는데도 굿노트에서 열렸다고 기록했다. 여기서는 단색 JPEG(그레이스케일, baseline)만 만든다.

const encoder = new TextEncoder();

function num(v: number): string {
  if (!Number.isFinite(v)) throw new Error("PDF_NON_FINITE");
  const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

export type PdfGuide = {
  /** PDF 좌표가 아니라 페이지 왼쪽 위 원점, y 아래 방향, PDF pt 단위 */
  points: ReadonlyArray<readonly [number, number]>;
  width: number;
  /** 0~1 RGB */
  color: readonly [number, number, number];
};

export type SolidPdfOptions = {
  width: number;
  height: number;
  /** 0~1 RGB. 기본 흰색. */
  color?: readonly [number, number, number];
  guides?: ReadonlyArray<PdfGuide>;
};

/** 한 쪽짜리 단색 PDF. xref 오프셋을 정확히 계산한다. */
export function buildSolidPdf(options: SolidPdfOptions): Uint8Array {
  const { width, height } = options;
  if (!(width > 0 && height > 0)) throw new Error("PDF_BAD_SIZE");
  const [r, g, b] = options.color ?? [1, 1, 1];
  const ops: string[] = [`${num(r)} ${num(g)} ${num(b)} rg`, `0 0 ${num(width)} ${num(height)} re f`];
  for (const guide of options.guides ?? []) {
    if (guide.points.length === 0) continue;
    const [gr, gg, gb] = guide.color;
    ops.push(`${num(gr)} ${num(gg)} ${num(gb)} RG ${num(guide.width)} w 1 J 1 j`);
    const pts = guide.points.length === 1 ? [guide.points[0], guide.points[0]] : guide.points;
    ops.push(pts.map(([x, y], k) => `${num(x)} ${num(height - y)} ${k === 0 ? "m" : "l"}`).join(" ") + " S");
  }
  const content = ops.join("\n") + "\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] /Resources << >> /Contents 4 0 R >>`,
    `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`,
  ];
  let body = "%PDF-1.4\n%âãÏÓ\n";
  // 위 주석 줄의 비ASCII 문자는 latin1 한 바이트씩으로 써야 하므로 바이트 단위로 조립한다.
  const parts: Uint8Array[] = [];
  const latin1 = (s: string) => Uint8Array.from(s, ch => ch.charCodeAt(0) & 0xff);
  const offsets: number[] = [];
  let length = 0;
  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    length += bytes.length;
  };
  push(latin1(body));
  objects.forEach((obj, i) => {
    offsets.push(length);
    push(latin1(`${i + 1} 0 obj\n${obj}\nendobj\n`));
  });
  const xrefAt = length;
  body = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  push(latin1(body));
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 단색 JPEG

class BitWriter {
  bytes: number[] = [];
  acc = 0;
  n = 0;
  write(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      this.n += 1;
      if (this.n === 8) this.flushByte();
    }
  }
  flushByte(): void {
    this.bytes.push(this.acc);
    if (this.acc === 0xff) this.bytes.push(0x00); // 바이트 스터핑
    this.acc = 0;
    this.n = 0;
  }
  finish(): number[] {
    while (this.n !== 0) this.write(1, 1); // 남은 비트는 1로 채운다
    return this.bytes;
  }
}

function segment(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

/**
 * width×height 단색 그레이스케일 baseline JPEG. 모든 8×8 블록의 AC 계수가 0이고 DC 차분은 첫 블록만 0이 아니다.
 * 허프만 표는 쓰는 기호만 담은 작은 표로 둔다. DC: 범주 0 = "0", 범주 k = "10". AC: EOB = "0", 예비 기호 = "10".
 * (길이 1 코드를 두 개 두면 libjpeg가 "모두 1인 코드"로 보고 표를 거부하므로 두 번째 기호는 길이 2로 둔다.)
 */
export function buildSolidJpeg(width: number, height: number, gray = 255): Uint8Array {
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width < 65536 && height < 65536)) {
    throw new Error("JPEG_BAD_SIZE");
  }
  const level = Math.max(0, Math.min(255, Math.round(gray)));
  // 8×8 블록 평균 m의 DC 계수 = 8 * (m - 128). 양자화 값 8로 나누면 m - 128.
  const dc = level - 128;
  const magnitude = Math.abs(dc);
  let category = 0;
  while (magnitude >> category) category += 1;
  const dcCategory = Math.max(1, category); // 표의 두 번째 기호(dc가 0이면 쓰이지 않는다)
  const out: number[] = [0xff, 0xd8];
  out.push(...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0])); // JFIF 1.1, 종횡비 1:1
  out.push(...segment(0xdb, [0x00, ...new Array(64).fill(8)])); // 양자화 표 0, 모든 값 8
  out.push(...segment(0xc0, [8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 1, 1, 0x11, 0]));
  const counts = [1, 1, ...new Array(14).fill(0)]; // 길이 1에 하나, 길이 2에 하나
  out.push(...segment(0xc4, [0x00, ...counts, 0, dcCategory])); // DC 표 0
  out.push(...segment(0xc4, [0x10, ...counts, 0x00, 0x01])); // AC 표 0
  out.push(...segment(0xda, [1, 1, 0x00, 0, 63, 0]));
  const bits = new BitWriter();
  const blocks = Math.ceil(width / 8) * Math.ceil(height / 8);
  for (let k = 0; k < blocks; k += 1) {
    if (k === 0 && dc !== 0) {
      bits.write(0b10, 2); // 범주 dcCategory
      const extra = dc >= 0 ? dc : dc + (1 << dcCategory) - 1; // 음수는 1의 보수 표현
      bits.write(extra, dcCategory);
    } else {
      bits.write(0, 1); // 차분 0
    }
    bits.write(0, 1); // EOB
  }
  out.push(...bits.finish(), 0xff, 0xd9);
  return Uint8Array.from(out);
}

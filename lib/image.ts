// Browser canvas decodes, orients and resizes before upload. Workers cannot run
// native Sharp. Validate the prepared JPEG and remove metadata at the boundary.
export type PreparedImage = { analysis: { buffer: Buffer; contentType: "image/jpeg"; extension: "jpg" } };
export function sanitizeAnalysisJpeg(bytes: Uint8Array): Buffer {
  const bad = () => new Error("사진을 준비하지 못했어요. 사진을 다시 선택해주세요.");
  if (bytes.length < 4 || bytes.length > 10 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) throw bad();
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2, frame = false, scan = false;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 255) throw bad();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) {
      if (!frame || !scan || offset !== bytes.length) throw bad();
      parts.push(bytes.subarray(start, offset));
      return Buffer.concat(parts);
    }
    if (!marker || marker === 216 || (marker >= 208 && marker <= 215) || offset + 2 > bytes.length) throw bad();
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw bad();
    const end = offset + length;
    if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
      if (frame || ![192, 194].includes(marker) || length < 11 || bytes[offset + 2] !== 8) throw bad();
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      const channels = bytes[offset + 7];
      if (!width || !height || Math.max(width, height) > 2560 || ![1, 3].includes(channels) || length !== 8 + 3 * channels) throw bad();
      frame = true;
    }
    // APPn/COM may contain camera IDs, GPS or arbitrary metadata.
    if (!(marker >= 224 && marker <= 239) && marker !== 254) parts.push(bytes.subarray(start, end));
    offset = end;
    if (marker === 218) {
      if (!frame) throw bad();
      scan = true;
      const entropyStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 208 && next <= 215)) { offset += 2; continue; }
        break;
      }
      parts.push(bytes.subarray(entropyStart, offset));
    }
  }
  throw bad();
}
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.type !== "image/jpeg" || file.size > 10 * 1024 * 1024) throw new Error("사진을 다시 선택해주세요.");
  return { analysis: { buffer: sanitizeAnalysisJpeg(new Uint8Array(await file.arrayBuffer())), contentType: "image/jpeg", extension: "jpg" } };
}

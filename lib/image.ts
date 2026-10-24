import sharp from "sharp";

const ACCEPTED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ANALYSIS_MAX_EDGE = 2560;

export type PreparedImage = {
  analysis: {
    buffer: Buffer;
    contentType: "image/jpeg";
    extension: "jpg";
  };
};

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!ACCEPTED_TYPES.has(file.type)) {
    throw new Error("JPEG, PNG, WebP, HEIC 이미지만 업로드할 수 있어요.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("이미지는 20MB 이하로 업로드해주세요.");
  }

  const originalBuffer = Buffer.from(await file.arrayBuffer());
  const analysisBuffer = await sharp(originalBuffer, { failOn: "error", limitInputPixels: 80_000_000 })
    .rotate()
    .resize({
      width: ANALYSIS_MAX_EDGE,
      height: ANALYSIS_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 86,
      mozjpeg: true,
    })
    .toBuffer();

  return {
    analysis: {
      buffer: analysisBuffer,
      contentType: "image/jpeg",
      extension: "jpg",
    },
  };
}

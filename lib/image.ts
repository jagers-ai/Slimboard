import path from "node:path";

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
  original: {
    buffer: Buffer;
    contentType: string;
    extension: string;
  };
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
  const extension = getExtension(file);
  const analysisBuffer = await sharp(originalBuffer, { failOn: "none" })
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
    original: {
      buffer: originalBuffer,
      contentType: file.type,
      extension,
    },
    analysis: {
      buffer: analysisBuffer,
      contentType: "image/jpeg",
      extension: "jpg",
    },
  };
}

function getExtension(file: File) {
  const fromName = path.extname(file.name).replace(".", "").toLowerCase();

  if (fromName && /^[a-z0-9]+$/.test(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }

  switch (file.type) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "jpg";
  }
}

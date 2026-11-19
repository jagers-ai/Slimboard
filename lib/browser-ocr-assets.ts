export const browserOcrRoot = "/ocr/v2/";
export const browserOcrDetection = "PP-OCRv5_mobile_det";
export const browserOcrRecognition = "korean_PP-OCRv5_mobile_rec";

export const browserOcrDownloads = [
  "ort-gzip.bin",
  `${browserOcrDetection}.bin`,
  `${browserOcrRecognition}.bin`,
] as const;

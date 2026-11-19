export const browserOcrRoot = "/ocr/v2/";
export const browserOcrDetection = "PP-OCRv5_mobile_det";
export const browserOcrRecognition = "korean_PP-OCRv5_mobile_rec";
export const browserOcrWorker = "engine-parallel.js";

export const browserOcrWasm = "ort-gzip.bin";
export const browserOcrModels = [`${browserOcrDetection}.bin`, `${browserOcrRecognition}.bin`] as const;
export const browserOcrDownloads = [browserOcrWasm, ...browserOcrModels] as const;

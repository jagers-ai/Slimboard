import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";

// Build-time only. Runtime downloads come from Slimboard; selected photos never
// go to the OCR asset provider. Change the asset directory when its bytes change.
const output = new URL("../public/ocr/v2/", import.meta.url);
const previous = new URL("../public/ocr/v1/", import.meta.url);
await mkdir(output, { recursive: true });
const assetRoot = "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/";
const models = [
  ["PP-OCRv5_mobile_det", "781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30"],
  ["korean_PP-OCRv5_mobile_rec", "568ed8b43a260adc9f484d92105e425ea8cddf8ce16940c177bc12864cfb0eb0"],
];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const readIfPresent = url => readFile(url).catch(error => { if (error.code !== "ENOENT") throw error; });

async function prepareModel(name, checksum) {
  const target = new URL(`${name}.bin`, output);
  const packed = await readIfPresent(target);
  if (packed) {
    try {
      if (sha256(gunzipSync(packed)) === checksum) return;
    } catch {
      // A truncated generated file can be rebuilt from the verified model.
    }
  }
  let bytes = await readIfPresent(new URL(`${name}.tar`, previous));
  if (!bytes || sha256(bytes) !== checksum) {
    const response = await fetch(`${assetRoot}${name}_onnx_infer.tar`, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Could not download browser OCR model ${name} (HTTP ${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== checksum) throw new Error(`Unexpected checksum for ${name}`);
  }
  await writeFile(target, gzipSync(bytes));
}

await Promise.all([
  copyFile(new URL("../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", import.meta.url), new URL("ort.mjs", output)),
  readFile(new URL("../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", import.meta.url))
    .then(bytes => writeFile(new URL("ort-gzip.bin", output), gzipSync(bytes))),
  // The SDK's pinned standalone worker already contains OpenCV and ORT. Ship it
  // once; importing the SDK from Vinext would duplicate both in client and SSR.
  readFile(new URL("../node_modules/@paddleocr/paddleocr-js/dist/assets/worker-entry-C9UNuyOJ.js", import.meta.url), "utf8")
    .then(source => {
      const probeGpu = "const webgpuState = await detectWebGpuAvailability();";
      if (!source.includes("async function initOpenCvRuntime()") || !source.includes(probeGpu)) {
        throw new Error("The pinned OCR worker entry changed.");
      }
      // The runner awaits this same promise when the models arrive.
      const warm = "void initOpenCvRuntime().catch(() => {});";
      const worker = source.replace(/^\/\/# sourceMappingURL=.*$/m, "")
        .replace(probeGpu, 'const webgpuState = backend === "wasm" ? { available: false, reason: "WASM selected" } : await detectWebGpuAvailability();');
      return writeFile(new URL("engine-fast.js", output), worker + "\n" + warm);
    }),
  ...["onnxruntime-LICENSE", "onnxruntime-NOTICES", "paddleocr-LICENSE", "opencv-LICENSE"].map(name =>
    copyFile(new URL(`../docs/third-party-ocr/${name}.txt`, import.meta.url), new URL(`${name}.txt`, output))),
  ...models.map(([name, checksum]) => prepareModel(name, checksum)),
]);

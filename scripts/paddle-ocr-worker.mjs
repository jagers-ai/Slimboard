const modelBridge = `
const slimboardModels = new Map();
function slimboardModel(filename) {
  if (!slimboardModels.has(filename)) {
    let deliver;
    const pending = new Promise(resolve => { deliver = resolve; });
    slimboardModels.set(filename, { pending, deliver });
  }
  return slimboardModels.get(filename);
}
self.addEventListener("message", ({ data }) => {
  if (data?.kind === "slimboard-ocr-model" && data.blob instanceof Blob) {
    slimboardModel(data.filename).deliver(data.blob);
  }
});
async function slimboardModelResponse(url, fetchImpl) {
  const prefix = "slimboard-ocr:";
  if (!url.startsWith(prefix)) return fetchImpl(url);
  const filename = url.slice(prefix.length);
  const blob = await slimboardModel(filename).pending;
  slimboardModels.delete(filename);
  return new Response(blob);
}
`;

const compileModelsSeparately = `    await this.disposeModelsOnly();
    const load = async (slot, kind, name, batchSize, createModel) => {
      const asset = await loadModelAsset(assets[slot], fetchImpl);
      validateLoadedModelName(kind, name, asset.configText);
      const model = await createModel({
        ort, modelBytes: asset.modelBytes, configText: asset.configText, backend, webgpuState, batchSize
      });
      return { asset, model };
    };
    const [detection, recognition] = await Promise.all([
      load("det", "TextDetection", this.pipelineConfig.modelSelection.textDetectionModelName,
        this.pipelineConfig.textDetectionBatchSize, createDetModel),
      load("rec", "TextRecognition", this.pipelineConfig.modelSelection.textRecognitionModelName,
        this.pipelineConfig.textRecognitionBatchSize, createRecModel)
    ]);
    const { model: detModel } = detection;
    const { model: recModel } = recognition;
    const loadedAssets = [detection.asset, recognition.asset];
`;

/** Adapt the pinned SDK bundle at build time. The ONNX files stay byte-for-byte intact. */
export function buildBrowserOcrWorker(source) {
  const probeGpu = "const webgpuState = await detectWebGpuAvailability();";
  const download = "const response = await fetchImpl(asset.url);";
  const start = source.indexOf("    const loadedAssets = await Promise.all([");
  const end = source.indexOf("    this.detModel = detModel;", start);
  if (start < 0 || end < 0 || !source.includes("async function initOpenCvRuntime()") ||
    !source.includes(probeGpu) || !source.includes(download)) {
    throw new Error("The pinned OCR worker entry changed.");
  }
  const withoutBarrier = source.slice(0, start) + compileModelsSeparately + source.slice(end);
  const worker = withoutBarrier.replace(/^\/\/# sourceMappingURL=.*$/m, "")
    .replace(probeGpu, 'const webgpuState = backend === "wasm" ? { available: false, reason: "WASM selected" } : await detectWebGpuAvailability();')
    .replace(download, "const response = await slimboardModelResponse(asset.url, fetchImpl);");
  return modelBridge + worker + "\nvoid initOpenCvRuntime().catch(() => {});\n";
}

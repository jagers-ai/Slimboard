"use client";

import { formatBrowserOcrPreview } from "./ocr-preview";

const assetPath = "/ocr/v1/";
const detection = "PP-OCRv5_mobile_det";
const recognition = "korean_PP-OCRv5_mobile_rec";
type OcrPage = { items: { text: string; score: number }[] };
type WorkerReply = { kind: string; requestId: number; status: string; payload: unknown };

// Only the pinned PaddleOCR 0.4.2 standalone worker is served. Its transport
// adapter lives here so no second OpenCV/WASM bundle is loaded on the main thread.
function connect(worker: Worker) {
  let sequence = 0;
  return function request<T>(type: string, payload: unknown, transfers: Transferable[] = [], timeout = 12_000) {
    return new Promise<T>((resolve, reject) => {
      const requestId = ++sequence;
      const cleanup = () => {
        clearTimeout(timer);
        worker.removeEventListener("message", receive);
        worker.removeEventListener("error", failed);
      };
      const failed = () => { cleanup(); reject(new Error("Browser OCR unavailable")); };
      const receive = (event: MessageEvent<WorkerReply>) => {
        const reply = event.data;
        if (reply?.kind !== "worker-transport-response" || reply.requestId !== requestId) return;
        if (reply.status !== "success") { failed(); return; }
        cleanup();
        resolve(reply.payload as T);
      };
      const timer = setTimeout(failed, timeout);
      worker.addEventListener("message", receive);
      worker.addEventListener("error", failed);
      try { worker.postMessage({ kind: "worker-transport-request", type, payload, requestId }, transfers); }
      catch { failed(); }
    });
  };
}

async function initialize() {
  const root = new URL(assetPath, location.origin);
  const worker = new Worker(new URL("engine.js", root), { type: "module" });
  const request = connect(worker);
  let wasm: string | undefined;
  try {
    const response = await fetch(new URL("ort-gzip.bin", root), { signal: AbortSignal.timeout(12_000) });
    if (!response.ok || !response.body) throw new Error("Browser OCR runtime unavailable");
    const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
    wasm = URL.createObjectURL(await new Response(stream, { headers: { "Content-Type": "application/wasm" } }).blob());
    await request("init", {
      options: {
        pipelineConfig: {
          modelSelection: { textDetectionModelName: detection, textRecognitionModelName: recognition },
          assets: { det: { url: new URL(`${detection}.tar`, root).href }, rec: { url: new URL(`${recognition}.tar`, root).href } },
          textDetectionBatchSize: 1, textRecognitionBatchSize: 6, warnings: [],
          runtimeDefaults: { textDetThresh: 0.3, textDetBoxThresh: 0.6, textDetUnclipRatio: 1.5 },
        },
        ortOptions: { backend: "wasm", wasmPaths: { mjs: new URL("ort.mjs", root).href, wasm }, numThreads: 1, disableWasmProxy: true },
      },
    });
    return { request, dispose: () => worker.terminate() };
  } catch (error) {
    worker.terminate();
    throw error;
  } finally {
    if (wasm) URL.revokeObjectURL(wasm);
  }
}

let engine: Promise<Awaited<ReturnType<typeof initialize>> | null> | undefined;
const previews = new WeakMap<File, Promise<string | null>>();
let newest = 0;
let queue = Promise.resolve();

export function prepareBrowserOcr() {
  if (typeof Worker === "undefined" || typeof createImageBitmap !== "function" || typeof DecompressionStream === "undefined") return Promise.resolve(null);
  engine ??= initialize().catch(() => { engine = undefined; return null; });
  return engine;
}

/** Local preview only: the server's verified transcription is the saved result. */
export function previewBrowserOcr(file: File) {
  const cached = previews.get(file);
  if (cached) return cached;
  const sequence = ++newest;
  const getEngine = prepareBrowserOcr();
  const result = queue.then(async () => {
    const ocr = await getEngine;
    if (!ocr || newest !== sequence) return null;
    const imageBitmap = await createImageBitmap(file);
    try {
      const [page] = await ocr.request<OcrPage[]>("predict", {
        sources: [{ kind: "imageBitmap", imageBitmap }],
        params: { textDetLimitSideLen: 960, textDetLimitType: "max", textRecScoreThresh: 0 },
      }, [imageBitmap], 4_000);
      return formatBrowserOcrPreview(page?.items ?? []);
    } catch {
      ocr.dispose();
      engine = undefined;
      return null;
    } finally {
      imageBitmap.close();
    }
  }).catch(() => null);
  previews.set(file, result);
  queue = result.then(() => undefined);
  return result;
}

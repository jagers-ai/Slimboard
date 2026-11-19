"use client";

import { formatBrowserOcrPreview } from "./ocr-preview";
import {
  browserOcrRoot,
  browserOcrDetection,
  browserOcrRecognition,
  browserOcrModels,
  browserOcrWasm,
  browserOcrWorker,
} from "./browser-ocr-assets";
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
  const root = new URL(browserOcrRoot, location.origin);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12_000);
  const assets: string[] = [];
  let worker: Worker | undefined;
  try {
    async function download(filename: string) {
      const response = await fetch(new URL(filename, root), { signal: abort.signal });
      if (!response.ok || !response.body) throw new Error("Browser OCR assets unavailable");
      return response.body;
    }
    async function unpack(filename: string, type: string) {
      const stream = (await download(filename)).pipeThrough(new DecompressionStream("gzip"));
      return new Response(stream, { headers: { "Content-Type": type } }).blob();
    }
    // Use the same fetch as the document's preload. The running worker warms
    // OpenCV while the two model downloads and decompression finish.
    const workerReady = (async () => {
      const source = await new Response(await download(browserOcrWorker), { headers: { "Content-Type": "text/javascript" } }).blob();
      if (abort.signal.aborted) throw new Error("Browser OCR initialization cancelled");
      const url = URL.createObjectURL(source);
      assets.push(url);
      worker = new Worker(url, { type: "module" });
      return worker;
    })();
    const modelMessages = browserOcrModels.map(async filename => {
      const [runningWorker, blob] = await Promise.all([workerReady, unpack(filename, "application/x-tar")]);
      runningWorker.postMessage({ kind: "slimboard-ocr-model", filename, blob });
    });
    const initialized = (async () => {
      const [runningWorker, runtime] = await Promise.all([workerReady, unpack(browserOcrWasm, "application/wasm")]);
      const url = URL.createObjectURL(runtime);
      assets.push(url);
      const request = connect(runningWorker);
      await request("init", {
        options: {
          pipelineConfig: {
            modelSelection: { textDetectionModelName: browserOcrDetection, textRecognitionModelName: browserOcrRecognition },
            assets: {
              det: { url: `slimboard-ocr:${browserOcrModels[0]}` },
              rec: { url: `slimboard-ocr:${browserOcrModels[1]}` },
            },
            textDetectionBatchSize: 1, textRecognitionBatchSize: 6, warnings: [],
            runtimeDefaults: { textDetThresh: 0.3, textDetBoxThresh: 0.6, textDetUnclipRatio: 1.5 },
          },
          ortOptions: { backend: "wasm", wasmPaths: { mjs: new URL("ort.mjs", root).href, wasm: url }, numThreads: 1, disableWasmProxy: true },
        },
      });
      return { request, dispose: () => runningWorker.terminate() };
    })();
    const [engine] = await Promise.all([initialized, ...modelMessages]);
    return engine;
  } catch (error) {
    worker?.terminate();
    throw error;
  } finally {
    clearTimeout(timeout);
    abort.abort();
    assets.forEach(url => URL.revokeObjectURL(url));
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

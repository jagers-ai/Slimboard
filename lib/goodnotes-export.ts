"use client";

import { convertInk, goodnotesDocument, readInkPixels, type InkDocument, type InkPreview, type InkReply, type InkRequest } from "./goodnotes-ink";

/** The screen shares or saves `file` and draws `preview` without knowing the format. */
export type GoodnotesPage = { file: File; title: string; preview: InkPreview; saveLabel: string };
export type GoodnotesFailure = "photo-missing" | "photo" | "ink";

export class GoodnotesExportError extends Error {
  readonly failure: GoodnotesFailure;
  constructor(failure: GoodnotesFailure, cause?: unknown) {
    super(`Goodnotes export failed: ${failure}`, { cause });
    this.name = "GoodnotesExportError";
    this.failure = failure;
  }
}

const untitled = "슬림보드 노트";
const workerTimeout = 60_000;

/** Null means the photo holds no handwriting. Aborting rejects and stops the worker. */
export async function prepareGoodnotesPage({ photoUrl, title, signal }: {
  photoUrl: string; title: string; signal: AbortSignal;
}): Promise<GoodnotesPage | null> {
  const request = { photo: await loadPhoto(photoUrl, signal), title: title.trim() || untitled };
  const document = await convertInWorker(request, signal) ?? await convertOnPage(request, signal);
  if (!document.ink) return null;
  return {
    file: new File([document.ink.bytes as BlobPart], goodnotesFileName(title), { type: goodnotesDocument.type }),
    title: request.title,
    preview: document.ink.preview,
    saveLabel: goodnotesDocument.saveLabel,
  };
}

export function goodnotesFileName(title: string) {
  const safe = title.replace(/\s+/g, " ").replace(/[/\\:*?"<>|\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return `${Array.from(safe).slice(0, 60).join("").trim() || untitled}${goodnotesDocument.extension}`;
}

async function loadPhoto(url: string, signal: AbortSignal) {
  let response: Response;
  let photo: Blob;
  try {
    response = await fetch(url, { signal, credentials: "same-origin" });
    if (response.ok) photo = await response.blob();
  } catch (error) {
    throw new GoodnotesExportError("photo", error);
  }
  if (!response.ok) throw new GoodnotesExportError(response.status === 404 ? "photo-missing" : "photo", `HTTP ${response.status}`);
  return photo!;
}

/** Null when this browser cannot run the conversion in a worker. */
function convertInWorker(request: InkRequest, signal: AbortSignal) {
  return new Promise<{ ink: InkDocument | null } | null>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    if (typeof Worker === "undefined") { resolve(null); return; }
    let worker: Worker;
    try {
      worker = new Worker(new URL("./goodnotes-export.worker.ts", import.meta.url), { type: "module" });
    } catch (error) {
      console.warn("Goodnotes export worker unavailable", error);
      resolve(null);
      return;
    }
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      worker.terminate();
      settle();
    };
    const stop = () => finish(() => reject(signal.reason));
    const timer = setTimeout(() => finish(() => reject(new GoodnotesExportError("ink", "timeout"))), workerTimeout);
    signal.addEventListener("abort", stop);
    worker.onerror = event => finish(() => {
      console.warn("Goodnotes export worker unavailable", event.message);
      resolve(null);
    });
    worker.onmessage = (event: MessageEvent<InkReply>) => finish(() => {
      const reply = event.data;
      if (reply.status === "done") resolve({ ink: reply.document });
      else if (reply.status === "unsupported") resolve(null);
      else reject(new GoodnotesExportError(reply.step, reply.detail));
    });
    worker.postMessage(request);
  });
}

async function convertOnPage({ photo, title }: InkRequest, signal: AbortSignal) {
  const url = URL.createObjectURL(photo);
  const image = new Image();
  let pixels;
  let jpeg;
  try {
    image.src = url;
    await image.decode();
    pixels = readInkPixels(image, image.naturalWidth, image.naturalHeight, document.createElement("canvas"));
    jpeg = new Uint8Array(await photo.arrayBuffer());
  } catch (error) {
    throw new GoodnotesExportError("photo", error);
  } finally {
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
  // Leaving during the decode must not start the long conversion on the page.
  signal.throwIfAborted();
  try {
    if (!pixels) throw new Error("2D canvas unavailable");
    return { ink: convertInk(pixels, jpeg, title) };
  } catch (error) {
    throw new GoodnotesExportError("ink", error);
  }
}

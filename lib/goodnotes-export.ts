/// <reference types="vite/client" />
"use client";

// Vinext rewrites import.meta.url in browser chunks, so `new URL(..., import.meta.url)`
// builds the worker but cannot load it. Take the emitted address instead.
import workerUrl from "./goodnotes-export.worker.ts?worker&url";
import { readInk, readInkPixels, type Ink, type InkReply } from "./goodnotes-ink";
import { INK_PDF_COLORS, buildInkPdf, inkPdfLineWidth, inkPdfPageSize } from "./ink-pdf";

// The file format is decided only here: change this object to send another kind of file.
const format = {
  type: "application/pdf",
  extension: ".pdf",
  async write({ width, height, strokes }: Ink, title: string, photo: Blob): Promise<Uint8Array> {
    return buildInkPdf({ width, height, strokes, title, photo: { jpeg: new Uint8Array(await photo.arrayBuffer()) } });
  },
  /** Pen color and width as the file shows them, for the preview. */
  pen({ width, height }: Ink, stroke: Ink["strokes"][number]) {
    const { scale } = inkPdfPageSize(width, height);
    return {
      color: `rgb(${INK_PDF_COLORS[stroke.color].map(value => Math.round(value * 255)).join(" ")})`,
      width: inkPdfLineWidth(stroke.width, scale) / scale,
    };
  },
};

/** One path per color and pen width, in the coordinates of `width` x `height`. */
export type GoodnotesPreview = { width: number; height: number; paths: Array<{ d: string; color: string; width: number }> };
/** The screen shares or saves `file` and draws `preview` without knowing the format. */
export type GoodnotesFile = { file: File; title: string; preview: GoodnotesPreview };
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
export async function prepareGoodnotesFile({ photoUrl, title, signal }: {
  photoUrl: string; title: string; signal: AbortSignal;
}): Promise<GoodnotesFile | null> {
  const photo = await loadPhoto(photoUrl, signal);
  const ink = await readInWorker(photo, signal) ?? await readOnPage(photo, signal);
  if (!ink.strokes.length) return null;
  const shownTitle = title.trim() || untitled;
  try {
    const bytes = await format.write(ink, shownTitle, photo);
    return {
      file: new File([bytes as BlobPart], goodnotesFileName(title), { type: format.type }),
      title: shownTitle,
      preview: previewInk(ink),
    };
  } catch (error) {
    throw new GoodnotesExportError("ink", error);
  }
}

export function goodnotesFileName(title: string) {
  // Titles may hold line breaks, so whitespace collapses before control characters go.
  const safe = title.replace(/[/\\:*?"<>|]/g, "").replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return `${Array.from(safe).slice(0, 60).join("").trim() || untitled}${format.extension}`;
}

function previewInk(ink: Ink): GoodnotesPreview {
  const paths = new Map<string, GoodnotesPreview["paths"][number]>();
  for (const stroke of ink.strokes) {
    if (!stroke.points.length) continue;
    const pen = format.pen(ink, stroke);
    const width = Math.round(pen.width * 2) / 2;
    const key = `${pen.color} ${width}`;
    let path = paths.get(key);
    if (!path) paths.set(key, path = { d: "", color: pen.color, width });
    path.d += stroke.points.map(([x, y], index) => `${index ? "L" : "M"}${round(x)} ${round(y)}`).join("");
    // A zero-length line still paints its round caps, so a single point shows as a dot.
    if (stroke.points.length === 1) path.d += "h0";
  }
  return { width: ink.width, height: ink.height, paths: [...paths.values()] };
}

function round(value: number) { return Math.round(value * 10) / 10; }

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

/** Null when this browser cannot read the photo in a worker. */
function readInWorker(photo: Blob, signal: AbortSignal) {
  return new Promise<Ink | null>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    if (typeof Worker === "undefined") { resolve(null); return; }
    let worker: Worker;
    try {
      worker = new Worker(workerUrl, { type: "module" });
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
      if (reply.status === "done") resolve(reply.ink);
      else if (reply.status === "unsupported") resolve(null);
      else reject(new GoodnotesExportError(reply.step, reply.detail));
    });
    worker.postMessage(photo);
  });
}

async function readOnPage(photo: Blob, signal: AbortSignal) {
  const url = URL.createObjectURL(photo);
  const image = new Image();
  let pixels;
  try {
    image.src = url;
    await image.decode();
    pixels = readInkPixels(image, image.naturalWidth, image.naturalHeight, document.createElement("canvas"));
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
    return readInk(pixels);
  } catch (error) {
    throw new GoodnotesExportError("ink", error);
  }
}

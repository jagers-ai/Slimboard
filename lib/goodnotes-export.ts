/// <reference types="vite/client" />
"use client";

// Vinext rewrites import.meta.url in browser chunks, so `new URL(..., import.meta.url)`
// builds the worker but cannot load it. Take the emitted address instead.
import workerUrl from "./goodnotes-export.worker.ts?worker&url";
import { readInk, readInkPixels, type Ink, type InkPen, type InkReply, type InkRequest } from "./goodnotes-ink";
import {
  GOODNOTES_EXPORT_PEN,
  GOODNOTES_EXPORT_PEN_CHOICES,
  GOODNOTES_EXPORT_TYPE,
  buildGoodnotesExport,
  goodnotesFileName,
  inkPreviewColor,
  inkPreviewFillPaths,
  inkPreviewFrame,
  isVariableExportStroke,
  withExportPen,
  type ExportVariablePen,
  type ExportVariableStroke,
} from "./goodnotes-export-format";

/** The pens the screen offers, and the one it starts with. They share the stroke shapes, so changing pen never reads the photo again. */
export type GoodnotesPen = ExportVariablePen;
export const GOODNOTES_PENS = GOODNOTES_EXPORT_PEN_CHOICES;
export const GOODNOTES_DEFAULT_PEN: GoodnotesPen = GOODNOTES_EXPORT_PEN;
export function isGoodnotesPen(value: unknown): value is GoodnotesPen {
  return GOODNOTES_PENS.includes(value as GoodnotesPen);
}

// The file format, its profile and page units are decided only in ./goodnotes-export-format.ts.
// 배경 PDF 규칙(실기기 확인 2026-11-26, 사진 눈대중 측정): 굿노트는 배경 PDF 1pt를 페이지 단위 11/6개로 그린다.
// 그래서 사진 쪽 크기는 사진 PDF 크기(pt) × 11/6이다(BACKGROUND_UNITS_PER_PT).
const format = {
  type: GOODNOTES_EXPORT_TYPE,
  async write(ink: Ink, title: string, photo: Blob): Promise<Uint8Array> {
    return buildGoodnotesExport({ ink, title, jpeg: new Uint8Array(await photo.arrayBuffer()), idSeed: newSeed() });
  },
  /** Where the photo sits on page 1 and the pen colors, for the preview. */
  frame: inkPreviewFrame,
  color: inkPreviewColor,
  fills: inkPreviewFillPaths,
};

// randomUUID exists only in secure contexts; without it the module seeds from the input.
function newSeed() {
  try { return globalThis.crypto?.randomUUID?.(); } catch { return undefined; }
}

/**
 * In the coordinates of `width` x `height` (the photo's area on page 1): `paths` are stroked lines, one per color and
 * pen width (ballpoint); `fills` are filled outlines, one per color (fountain and brush, whose width changes per point).
 */
export type GoodnotesPreview = {
  width: number;
  height: number;
  paths: Array<{ d: string; color: string; width: number }>;
  fills: Array<{ d: string; color: string }>;
};
/** What a prepared file was written from, so another pen can rewrite it without reading the photo. The screen never looks inside. */
type GoodnotesSource = { ink: Ink; title: string; photo: Blob };
/** The screen shares or saves `file` and draws `preview` without knowing the format. `pen` is the pen `file` was written with. */
export type GoodnotesFile = { file: File; preview: GoodnotesPreview; pen: GoodnotesPen; readonly source: GoodnotesSource };
export type GoodnotesFailure = "photo-missing" | "photo" | "ink";

export class GoodnotesExportError extends Error {
  readonly failure: GoodnotesFailure;
  constructor(failure: GoodnotesFailure, cause?: unknown) {
    super(`Goodnotes export failed: ${failure}`, { cause });
    this.name = "GoodnotesExportError";
    this.failure = failure;
  }
}

const workerTimeout = 60_000;

/** Null means the photo holds no handwriting. Aborting rejects and stops the worker. The pen defaults to GOODNOTES_DEFAULT_PEN. */
export async function prepareGoodnotesFile({ photoUrl, title, signal, pen = GOODNOTES_DEFAULT_PEN }: {
  photoUrl: string; title: string; signal: AbortSignal; pen?: GoodnotesPen;
}): Promise<GoodnotesFile | null> {
  const photo = await loadPhoto(photoUrl, signal);
  const ink = await readInWorker(photo, pen, signal) ?? await readOnPage(photo, pen, signal);
  if (!ink.strokes.length) return null;
  try {
    return { file: await writeFile(ink, title, photo), preview: previewInk(ink), pen, source: { ink, title, photo } };
  } catch (error) {
    throw new GoodnotesExportError("ink", error);
  }
}

/**
 * The same handwriting written with another pen: no photo analysis, only the document is written again
 * (about 0.4 s on the main thread for a real board). Fountain and brush strokes have the same shapes, so the preview stays.
 */
export async function changeGoodnotesPen(prepared: GoodnotesFile, pen: GoodnotesPen): Promise<GoodnotesFile> {
  if (prepared.pen === pen) return prepared;
  const { title, photo } = prepared.source;
  const ink = withExportPen(prepared.source.ink, pen);
  try {
    return { file: await writeFile(ink, title, photo), preview: prepared.preview, pen, source: { ink, title, photo } };
  } catch (error) {
    throw new GoodnotesExportError("ink", error);
  }
}

async function writeFile(ink: Ink, title: string, photo: Blob) {
  const bytes = await format.write(ink, title, photo);
  return new File([bytes as BlobPart], goodnotesFileName(title), { type: format.type });
}

// The preview draws the very strokes of the file: same points, colors and widths.
function previewInk(ink: Ink): GoodnotesPreview {
  const frame = format.frame(ink);
  const paths = new Map<string, { color: string; width: number; parts: string[] }>();
  const variable: ExportVariableStroke[] = [];
  for (const stroke of ink.strokes) {
    if (!stroke.points.length) continue;
    if (isVariableExportStroke(stroke)) { variable.push(stroke); continue; }
    const color = format.color(stroke.color);
    const width = Math.round(stroke.width * 4) / 4;
    const key = `${color} ${width}`;
    let path = paths.get(key);
    if (!path) paths.set(key, path = { color, width, parts: [] });
    path.parts.push(strokePath(stroke.points, frame));
  }
  return {
    width: frame.width,
    height: frame.height,
    paths: [...paths.values()].map(({ color, width, parts }) => ({ d: parts.join(""), color, width })),
    fills: format.fills(variable, frame).map(({ color, d }) => ({ color: format.color(color), d })),
  };
}

// About 50,000 points per photo: half-unit steps (about 0.2 px on screen) in relative moves keep the path short.
function strokePath(points: ReadonlyArray<readonly [number, number]>, frame: { x: number; y: number }) {
  let lastX = snap(points[0][0] - frame.x);
  let lastY = snap(points[0][1] - frame.y);
  let d = `M${lastX} ${lastY}l`;
  let moved = false;
  for (let index = 1; index < points.length; index += 1) {
    const x = snap(points[index][0] - frame.x);
    const y = snap(points[index][1] - frame.y);
    if (x === lastX && y === lastY) continue;
    d += `${moved ? " " : ""}${x - lastX} ${y - lastY}`;
    lastX = x;
    lastY = y;
    moved = true;
  }
  // A zero-length line still paints its round caps, so a single point shows as a dot.
  return moved ? d : `${d}0 0`;
}

function snap(value: number) { return Math.round(value * 2) / 2; }

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
function readInWorker(photo: Blob, pen: InkPen, signal: AbortSignal) {
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
    worker.postMessage({ photo, pen } satisfies InkRequest);
  });
}

async function readOnPage(photo: Blob, pen: InkPen, signal: AbortSignal) {
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
    return readInk(pixels, pen);
  } catch (error) {
    throw new GoodnotesExportError("ink", error);
  }
}

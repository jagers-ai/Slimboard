// Turns photo pixels into the document and preview handed to Goodnotes.
// The only caller of ink-strokes and ink-pdf; it runs in the export worker and,
// where a worker cannot draw, on the page itself.
import { INK_PDF_COLORS, buildInkPdf, inkPdfLineWidth, inkPdfPageSize } from "./ink-pdf";
import { extractInkStrokes } from "./ink-strokes";

export const goodnotesDocument = { type: "application/pdf", extension: ".pdf", saveLabel: "PDF 저장" } as const;

export type InkPixels = { width: number; height: number; data: Uint8ClampedArray };
/** One path per color and pen width, in the coordinates of `width` x `height`. */
export type InkPreview = { width: number; height: number; paths: Array<{ d: string; color: string; width: number }> };
export type InkDocument = { bytes: Uint8Array; preview: InkPreview };
export type InkRequest = { photo: Blob; title: string };
export type InkReply =
  | { status: "done"; document: InkDocument | null }
  | { status: "unsupported" }
  | { status: "failed"; step: "photo" | "ink"; detail: string };

type Canvas2d = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect" | "drawImage" | "getImageData" | "imageSmoothingQuality">;

const longSide = 1600;

/** Draws the decoded photo at the analysis size; null when there is no 2D canvas here. */
export function readInkPixels(
  source: CanvasImageSource, sourceWidth: number, sourceHeight: number,
  canvas: OffscreenCanvas | HTMLCanvasElement,
): InkPixels | null {
  const scale = Math.min(1, longSide / Math.max(sourceWidth, sourceHeight));
  const width = canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  const height = canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true }) as Canvas2d | null;
  if (!context) return null;
  try {
    context.imageSmoothingQuality = "high";
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return { width, height, data: context.getImageData(0, 0, width, height).data };
  } finally {
    // Release the large canvas backing store promptly on mobile Safari.
    canvas.width = canvas.height = 1;
  }
}

/** Null means the photo holds no handwriting. */
export function convertInk(pixels: InkPixels, jpeg: Uint8Array, title: string): InkDocument | null {
  const { width, height, strokes } = extractInkStrokes(pixels);
  if (!strokes.length) return null;
  return {
    bytes: buildInkPdf({ width, height, strokes, title, photo: { jpeg } }),
    preview: inkPreview(width, height, strokes),
  };
}

function inkPreview(width: number, height: number, strokes: ReturnType<typeof extractInkStrokes>["strokes"]): InkPreview {
  const { scale } = inkPdfPageSize(width, height);
  const paths = new Map<string, InkPreview["paths"][number]>();
  for (const { points, color, width: penWidth } of strokes) {
    if (!points.length) continue;
    // Same limits as the document, so the preview shows the pen that will arrive.
    const shownWidth = Math.round(inkPdfLineWidth(penWidth, scale) / scale * 2) / 2;
    const key = `${color} ${shownWidth}`;
    let path = paths.get(key);
    if (!path) paths.set(key, path = { d: "", color: cssColor(color), width: shownWidth });
    path.d += points.map(([x, y], index) => `${index ? "L" : "M"}${round(x)} ${round(y)}`).join("");
    // A zero-length line still paints its round caps, so a single point shows as a dot.
    if (points.length === 1) path.d += "h0";
  }
  return { width, height, paths: [...paths.values()] };
}

function cssColor(color: keyof typeof INK_PDF_COLORS) {
  return `rgb(${INK_PDF_COLORS[color].map(value => Math.round(value * 255)).join(" ")})`;
}

function round(value: number) { return Math.round(value * 10) / 10; }

// Reads the handwriting of a decoded photo as Goodnotes pen strokes: outlines
// (./ink-outline) filled with pen strokes on the page (./goodnotes-export-format).
// Runs in the export worker and, where a worker cannot draw, on the page itself.
import { extractInkOutlines } from "./ink-outline.ts";
import { outlineToInk, type ExportInk } from "./goodnotes-export-format.ts";

export type InkPixels = { width: number; height: number; data: Uint8ClampedArray };
export type Ink = ExportInk;
export type InkReply =
  | { status: "done"; ink: Ink }
  | { status: "unsupported" }
  | { status: "failed"; step: "photo" | "ink"; detail: string };

type Canvas2d = Pick<CanvasRenderingContext2D, "fillStyle" | "fillRect" | "drawImage" | "getImageData" | "imageSmoothingQuality">;

/**
 * Analysis size: the photo's long side is drawn at most this large and outlined at this size.
 * Saved note photos are 2560 on the long side, so they are read at full size. 2026-11-26, Mac Node:
 * synthetic 2560 boards gave IoU 0.929/0.931 at 2560 against 0.910/0.890 at 2000 and 0.897/0.901 at 1600,
 * and lost fewer small strokes; the real 1500x2000 board took 2.3 s (2.8 s when enlarged to 2560).
 */
export const INK_LONG_SIDE = 2560;

/** Draws the decoded photo at the analysis size; null when there is no 2D canvas here. */
export function readInkPixels(
  source: CanvasImageSource, sourceWidth: number, sourceHeight: number,
  canvas: OffscreenCanvas | HTMLCanvasElement,
): InkPixels | null {
  const scale = Math.min(1, INK_LONG_SIDE / Math.max(sourceWidth, sourceHeight));
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

/** Outlines, then pen strokes in page units. Both steps run here, never on the main thread when a worker exists. */
export function readInk(pixels: InkPixels): Ink {
  const outline = extractInkOutlines(pixels, { maxSide: INK_LONG_SIDE });
  if (outline.truncated) console.warn("Goodnotes export: small ink shapes dropped over the shape or point limit");
  return outlineToInk(outline);
}

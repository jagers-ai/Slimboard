// Reads pen strokes from a decoded photo. Runs in the export worker and, where a
// worker cannot draw, on the page itself. Knows nothing about the file format.
import { extractInkStrokes } from "./ink-strokes";

export type InkPixels = { width: number; height: number; data: Uint8ClampedArray };
export type Ink = Pick<ReturnType<typeof extractInkStrokes>, "width" | "height" | "strokes">;
export type InkReply =
  | { status: "done"; ink: Ink }
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

export function readInk(pixels: InkPixels): Ink {
  const { width, height, strokes } = extractInkStrokes(pixels);
  return { width, height, strokes };
}

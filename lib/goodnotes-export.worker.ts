import { readInk, readInkPixels, type InkReply, type InkRequest } from "./goodnotes-ink";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InkRequest>) => void) | null;
  postMessage(reply: InkReply): void;
};

scope.onmessage = event => { void read(event.data); };

async function read({ photo, pen }: InkRequest) {
  let step: "photo" | "ink" = "photo";
  try {
    if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
      scope.postMessage({ status: "unsupported" });
      return;
    }
    const bitmap = await createImageBitmap(photo);
    let pixels;
    try { pixels = readInkPixels(bitmap, bitmap.width, bitmap.height, new OffscreenCanvas(1, 1)); }
    finally { bitmap.close(); }
    if (!pixels) {
      scope.postMessage({ status: "unsupported" });
      return;
    }
    step = "ink";
    scope.postMessage({ status: "done", ink: readInk(pixels, pen) });
  } catch (error) {
    scope.postMessage({ status: "failed", step, detail: String(error) });
  }
}

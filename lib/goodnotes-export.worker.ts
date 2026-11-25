import { convertInk, readInkPixels, type InkReply, type InkRequest } from "./goodnotes-ink";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InkRequest>) => void) | null;
  postMessage(reply: InkReply, transfers?: Transferable[]): void;
};

scope.onmessage = event => { void convert(event.data); };

async function convert({ photo, title }: InkRequest) {
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
    const jpeg = new Uint8Array(await photo.arrayBuffer());
    step = "ink";
    const document = convertInk(pixels, jpeg, title);
    scope.postMessage({ status: "done", document }, document ? [document.bytes.buffer] : []);
  } catch (error) {
    scope.postMessage({ status: "failed", step, detail: String(error) });
  }
}

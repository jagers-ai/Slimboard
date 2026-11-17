import assert from "node:assert/strict";
import test from "node:test";
import { formatBrowserOcrPreview } from "../lib/ocr-preview.ts";

test("weak OCR lines are placeholders and a completely uncertain scan is withheld", () => {
  const weak = { text: "손글씨를 틀리게 읽었어요", score: 0.79 };
  const clear = { text: "  여운 한 줄  ", score: 0.89 };
  assert.equal(formatBrowserOcrPreview([weak, clear]), "___\n여운 한 줄");
  assert.equal(formatBrowserOcrPreview([weak, { text: " ", score: 1 }]), null);
});

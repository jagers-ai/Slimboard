type OcrLine = { text: string; score: number };

export function formatBrowserOcrPreview(lines: readonly OcrLine[]) {
  const rendered = lines.map(({ text, score }) => {
    const cleaned = text.trim();
    return Number.isFinite(score) && score >= 0.82 && cleaned ? cleaned : "___";
  });
  return rendered.some(line => line !== "___") ? rendered.join("\n") : null;
}

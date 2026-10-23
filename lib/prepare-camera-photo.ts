// Browser-only preparation. Canvas keeps the browser's EXIF orientation and
// removes camera metadata before the temporary lab sends a JPEG to the server.
export async function prepareCameraPhoto(selected: File): Promise<File> {
  if (!selected.size) throw new Error("비어 있는 사진이에요. 다른 사진을 선택해주세요.");
  if (selected.size > 40 * 1024 * 1024) {
    throw new Error("사진 용량이 너무 커요. 40MB 이하 사진을 선택하거나 다시 촬영해주세요.");
  }
  if (selected.type && !selected.type.startsWith("image/")) {
    throw new Error("사진 파일을 선택해주세요.");
  }
  const url = URL.createObjectURL(selected);
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    image.src = url;
    try { await image.decode(); } catch {
      throw new Error("이 사진을 열 수 없어요. JPG 사진을 선택하거나 다시 촬영해주세요.");
    }
    const scale = Math.min(1, 3000 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("사진을 준비하지 못했어요. 다시 선택해주세요.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (!blob) break;
      if (blob.size <= 10 * 1024 * 1024) return new File([blob], "whiteboard.jpg", { type: "image/jpeg" });
    }
    throw new Error("사진 용량을 줄이지 못했어요. 다른 사진을 선택해주세요.");
  } finally {
    // Release the large canvas backing store promptly on mobile Safari.
    canvas.width = canvas.height = 1;
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}

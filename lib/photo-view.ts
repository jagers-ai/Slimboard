export function photoView(width: number, height: number, viewportWidth: number, viewportHeight: number, mode: 'width' | 'fit' | number) {
  if (![width, height, viewportWidth, viewportHeight].every(n => Number.isFinite(n) && n > 0)) return { width: 0, height: 0, zoom: 1 };
  const fit = Math.min(viewportWidth / width, viewportHeight / height);
  const zoom = mode === 'fit' ? 1 : mode === 'width' ? Math.min(6, viewportWidth / width / fit) : Math.min(6, Math.max(1, mode));
  return { width: width * fit * zoom, height: height * fit * zoom, zoom };
}

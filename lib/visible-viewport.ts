/** Bound fixed app chrome to the intersection of valid viewport measurements. */
export function visibleViewportBounds(innerHeight: number, clientHeight: number, visualHeight: number, offsetTop: number) {
  const layouts = [innerHeight, clientHeight].filter(n => Number.isFinite(n) && n > 0);
  const layout = layouts.length ? Math.min(...layouts) : visualHeight;
  const height = Math.min(layout, visualHeight > 0 && Number.isFinite(visualHeight) ? visualHeight : layout);
  const top = Math.max(0, Math.min(Number.isFinite(offsetTop) ? offsetTop : 0, Math.max(0, layout - height)));
  return { height, top };
}

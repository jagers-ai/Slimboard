"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Download, Expand, Maximize, Minus, Plus, X } from "lucide-react";
import { photoView } from "@/lib/photo-view";

export function PhotoZoom({ src, alt, className = "", downloadUrl }: {
  src: string; alt: string; className?: string; downloadUrl?: string;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<'width' | 'fit' | number>('width');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const center = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const view = photoView(natural.width, natural.height, size.width, size.height, mode);

  useEffect(() => {
    if (!open) return;
    const modal = dialog.current!;
    modal.showModal();
    closeButton.current?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const resizeViewport = () => {
      if (!viewport || Math.abs(viewport.scale - 1) > .01) return;
      modal.style.setProperty('--photo-viewport-height', `${viewport.height}px`);
      modal.style.setProperty('--photo-viewport-top', `${viewport.offsetTop}px`);
    };
    resizeViewport();
    viewport?.addEventListener('resize', resizeViewport);
    viewport?.addEventListener('scroll', resizeViewport);
    const observer = new ResizeObserver(() => {
      const element = stage.current;
      if (element) setSize(old => old.width === element.clientWidth && old.height === element.clientHeight ? old : { width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(stage.current!);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener('resize', resizeViewport);
      viewport?.removeEventListener('scroll', resizeViewport);
      modal.close();
      trigger.current?.focus({ preventScroll: true });
      drag.current = null;
    };
  }, [open]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !view.width) return;
    if (center.current) {
      element.scrollLeft = Math.max(0, (size.width - view.width) / 2) + center.current.x * view.width - size.width / 2;
      element.scrollTop = Math.max(0, (size.height - view.height) / 2) + center.current.y * view.height - size.height / 2;
      center.current = null;
    }
  }, [view.width, view.height, size.width, size.height]);

  function changeZoom(next: 'fit' | number) {
    const element = stage.current;
    if (!element || !view.width) return;
    center.current = {
      x: (element.scrollLeft + size.width / 2 - Math.max(0, (size.width - view.width) / 2)) / view.width,
      y: (element.scrollTop + size.height / 2 - Math.max(0, (size.height - view.height) / 2)) / view.height,
    };
    setMode(next);
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    // Touch uses native two-axis scrolling; mouse/pen also support grab-to-pan.
    if (event.pointerType === 'touch' || event.button !== 0 || !view.width || (event.target as HTMLElement).closest('button, a')) return;
    const element = event.currentTarget;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    element.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  }
  function openPhoto() {
    setNatural({ width: 0, height: 0 }); setMode('width'); setFailed(false); center.current = null; setOpen(true);
  }

  return <>
    <button ref={trigger} type="button" className={`photo-zoom-trigger ${className}`} aria-label={`${alt} 크게 보기`} aria-haspopup="dialog" onClick={openPhoto}>
      <img src={src} alt={alt} />
      <span className="photo-expand-icon" aria-hidden="true"><Expand size={22} /></span>
    </button>
    {open ? <dialog ref={dialog} className="photo-viewer" aria-labelledby={titleId} onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
      <header className="photo-viewer-header">
        <h2 id={titleId}>사진 보기</h2>
        {downloadUrl ? <a className="photo-viewer-download" href={downloadUrl} download={downloadUrl.startsWith("blob:") ? "slimboard-photo.jpg" : true}><Download size={20} aria-hidden="true" /><span>사진 다운로드</span></a> : null}
        <button ref={closeButton} type="button" className="photo-viewer-close" aria-label="사진 확대 보기 닫기" onClick={() => setOpen(false)}><X size={26} /></button>
      </header>
      <div ref={stage} className="photo-viewer-stage" tabIndex={0} aria-label="확대 사진, 스크롤하거나 드래그해 이동" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
        {failed ? <div className="photo-viewer-message"><p role="alert">사진을 불러오지 못했어요.</p><button type="button" onClick={() => { setFailed(false); setNatural({ width: 0, height: 0 }); setAttempt(n => n + 1); }}>다시 불러오기</button></div> : <>
          {!natural.width ? <p className="photo-viewer-loading" role="status">사진을 불러오고 있어요.</p> : null}
          <div className="photo-viewer-canvas" style={{ width: Math.max(size.width, view.width), height: Math.max(size.height, view.height) }}>
            <img key={attempt} src={src} alt={alt} draggable={false} onDragStart={event => event.preventDefault()} onLoad={event => { setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); if (dialog.current && !dialog.current.contains(document.activeElement)) stage.current?.focus({ preventScroll: true }); }} onError={() => setFailed(true)} style={{ width: view.width, height: view.height, left: Math.max(0, (size.width - view.width) / 2), top: Math.max(0, (size.height - view.height) / 2), visibility: view.width ? 'visible' : 'hidden' }} />
          </div>
        </>}
      </div>
      <footer className="photo-viewer-footer">
        <div className="photo-viewer-controls">
          <button type="button" disabled={!view.width || failed || view.zoom <= 1} onClick={() => changeZoom(Math.max(1, view.zoom / 1.4))}><Minus size={22} aria-hidden="true" />축소</button>
          <button type="button" disabled={!view.width || failed} onClick={() => changeZoom('fit')}><Maximize size={22} aria-hidden="true" />화면 맞춤</button>
          <button type="button" disabled={!view.width || failed || view.zoom >= 6} onClick={() => changeZoom(Math.min(6, view.zoom * 1.4))}><Plus size={22} aria-hidden="true" />확대</button>
        </div>
        <p>확대 후 드래그해 이동</p>
      </footer>
    </dialog> : null}
  </>;
}

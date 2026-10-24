"use client";
import { useLayoutEffect, useRef } from "react";

/** A real labelled input, sized like document text instead of a nested form. */
export function DocumentField({ label, value, onChange, disabled, title = false }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean; title?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const resize = () => {
      if (!field.clientWidth) return;
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    };
    resize();
    let animationFrame = 0;
    const scheduleResize = () => { cancelAnimationFrame(animationFrame); animationFrame = requestAnimationFrame(resize); };
    let width = field.clientWidth;
    let fontSize = getComputedStyle(field).fontSize;
    const observer = new ResizeObserver(() => {
      const nextFontSize = getComputedStyle(field).fontSize;
      if (field.clientWidth !== width || nextFontSize !== fontSize) { width = field.clientWidth; fontSize = nextFontSize; scheduleResize(); }
    });
    observer.observe(field);
    if (measure.current) observer.observe(measure.current);
    const toggle = scheduleResize;
    field.closest("details")?.addEventListener("toggle", toggle);
    return () => { cancelAnimationFrame(animationFrame); observer.disconnect(); field.closest("details")?.removeEventListener("toggle", toggle); };
  }, [value]);
  return <span className="document-field-wrap"><span ref={measure} className="document-field-measure" aria-hidden="true" /><textarea ref={ref} aria-label={label} className={`document-field${title ? " document-title-field" : ""}`}
    maxLength={100_000} rows={title ? 2 : 4} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}
    placeholder={title ? "제목을 입력하세요" : "내용을 입력하세요"} /></span>;
}

import { useLayoutEffect, useRef } from 'react';

// Fit the entire date using real font sizes, not a bitmap/transform. The old
// flex item could clip half of the final digit at a fractional available width.
export function PrintDate({ value }: { value: string }) {
  const root = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = root.current;
    const text = host?.firstElementChild as HTMLElement | null;
    if (!host || !text) return;
    let active = true;
    const fit = () => {
      if (!active) return;
      const style = getComputedStyle(host);
      const width =
        host.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height =
        host.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const desired = parseFloat(style.fontSize);
      // Leave glyph bearings and a small rounding allowance inside the box.
      const fits = (size: number) => {
        text.style.fontSize = `${size}px`;
        return text.offsetWidth <= width - 1 && text.offsetHeight <= height - 1;
      };
      let size = desired;
      if (!fits(size)) {
        let low = Math.min(8, desired),
          high = desired; // 6 pt minimum legible size
        for (let i = 0; i < 12; i++) {
          const mid = (low + high) / 2;
          if (fits(mid)) low = mid;
          else high = mid;
        }
        size = Math.floor(low * 10) / 10;
      }
      host.dataset.dateOverflow = String(!fits(size));
      host.dataset.dateReady = 'true';
    };
    fit();
    void document.fonts.ready.then(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    window.addEventListener('beforeprint', fit);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener('beforeprint', fit);
    };
  });
  return (
    <span ref={root} className="print-date-fit">
      <span>送货日期：{value}</span>
    </span>
  );
}

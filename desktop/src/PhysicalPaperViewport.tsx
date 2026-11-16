import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const MM_PX = 96 / 25.4;

// Both renderers lay out in physical mm first, then use ONE uniform screen
// transform. Never shrink just the table while leaving the font at full size.
export function PhysicalPaperViewport({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.max(0.01, Math.min(1, el.clientWidth / (width * MM_PX))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div
      ref={ref}
      className="tpl-fit"
      data-paper-width={width}
      data-paper-height={height}
      data-screen-scale={scale}
    >
      <div
        className="tpl-fit-sized"
        style={{ width: width * MM_PX * scale, height: height * MM_PX * scale }}
      >
        <div
          className="tpl-fit-inner"
          style={{
            width: `${width}mm`,
            height: `${height}mm`,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

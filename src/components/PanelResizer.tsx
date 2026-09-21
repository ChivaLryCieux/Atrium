import React, { useRef, useState, useCallback, useEffect } from "react";

export type PanelResizerProps = {
  orientation?: "vertical" | "horizontal";
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  onReset?: () => void;
  className?: string;
  title?: string;
};

export function PanelResizer({
  orientation = "vertical",
  onResize,
  onResizeEnd,
  onReset,
  className = "",
  title,
}: PanelResizerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const lastPosRef = useRef<number>(0);

  // Clean up dragging classes if component unmounts
  useEffect(() => {
    return () => {
      document.body.classList.remove("resizing-col", "resizing-row");
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      setIsDragging(true);
      lastPosRef.current = orientation === "vertical" ? e.clientX : e.clientY;

      if (orientation === "vertical") {
        document.body.classList.add("resizing-col");
      } else {
        document.body.classList.add("resizing-row");
      }
    },
    [orientation]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      e.preventDefault();

      const currentPos = orientation === "vertical" ? e.clientX : e.clientY;
      const delta = currentPos - lastPosRef.current;
      if (delta !== 0) {
        onResize(delta);
        lastPosRef.current = currentPos;
      }
    },
    [isDragging, orientation, onResize]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      e.preventDefault();

      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }

      setIsDragging(false);
      document.body.classList.remove("resizing-col", "resizing-row");

      onResizeEnd?.();
    },
    [isDragging, onResizeEnd]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onReset?.();
    },
    [onReset]
  );

  const isVertical = orientation === "vertical";
  const baseClass = isVertical ? "panel-resizer-col" : "panel-resizer-row";
  const stateClass = isDragging ? "dragging" : "";

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      tabIndex={-1}
      className={`${baseClass} ${stateClass} ${className}`.trim()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    />
  );
}

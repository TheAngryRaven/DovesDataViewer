import { useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";

interface ResizableSplitProps {
  topPanel: React.ReactNode;
  bottomPanel: React.ReactNode;
  defaultRatio?: number; // 0-1, top panel height ratio
  minTopHeight?: number;
  minBottomHeight?: number;
}

export function ResizableSplit({
  topPanel,
  bottomPanel,
  defaultRatio = 0.7,
  minTopHeight = 150,
  minBottomHeight = 100,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(defaultRatio);

  const DIVIDER_HEIGHT = 8; // h-2 = 0.5rem

  const [topPx, setTopPx] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);

  const clampTopPx = useCallback(
    (desiredTopPx: number, availableHeight: number) => {
      const maxTop = Math.max(minTopHeight, availableHeight - minBottomHeight);
      return Math.max(minTopHeight, Math.min(maxTop, desiredTopPx));
    },
    [minTopHeight, minBottomHeight],
  );

  const measureAndSetFromRatio = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const availableHeight = container.clientHeight - DIVIDER_HEIGHT;
    if (availableHeight <= 0) return;

    const desired = availableHeight * ratioRef.current;
    const clamped = clampTopPx(desired, availableHeight);

    ratioRef.current = clamped / availableHeight;
    setTopPx(clamped);
  }, [clampTopPx]);

  // Set initial size before paint to avoid the bottom panel "starting full height".
  useLayoutEffect(() => {
    measureAndSetFromRatio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep split stable on container resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      measureAndSetFromRatio();
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [measureAndSetFromRatio]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (clientY: number) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const availableHeight = rect.height - DIVIDER_HEIGHT;
      if (availableHeight <= 0) return;

      const desiredTop = clientY - rect.top;
      const clamped = clampTopPx(desiredTop, availableHeight);

      ratioRef.current = clamped / availableHeight;
      setTopPx(clamped);
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientY);

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      handleMove(e.touches[0].clientY);
    };

    const handleEnd = () => setIsDragging(false);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleEnd);

    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleEnd);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleEnd);
      document.removeEventListener("touchmove", handleTouchMove as any);
      document.removeEventListener("touchend", handleEnd);
    };
  }, [isDragging, clampTopPx]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-hidden grid"
      style={{
        gridTemplateRows: `${topPx}px ${DIVIDER_HEIGHT}px 1fr`,
      }}
    >
      {/* Top Panel */}
      <div className="overflow-hidden">{topPanel}</div>

      {/* Divider */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className={`
          bg-border cursor-row-resize flex items-center justify-center select-none touch-none
          hover:bg-primary/30 transition-colors
          ${isDragging ? "bg-primary/50" : ""}
        `}
      >
        <div className="w-12 h-1 bg-muted-foreground/30 rounded-full" />
      </div>

      {/* Bottom Panel */}
      <div className="overflow-hidden">{bottomPanel}</div>
    </div>
  );
}

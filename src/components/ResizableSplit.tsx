import { useState, useCallback, useRef, useEffect } from 'react';

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
  minBottomHeight = 100
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(defaultRatio);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMove = (clientY: number) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const y = clientY - rect.top;
      const totalHeight = rect.height;
      
      // Calculate new ratio with constraints
      let newRatio = y / totalHeight;
      
      // Apply min height constraints
      const minTopRatio = minTopHeight / totalHeight;
      const minBottomRatio = minBottomHeight / totalHeight;
      
      newRatio = Math.max(minTopRatio, Math.min(1 - minBottomRatio, newRatio));
      
      setRatio(newRatio);
    };

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientY);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        handleMove(e.touches[0].clientY);
      }
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging, minTopHeight, minBottomHeight]);

  const dividerHeight = 8; // h-2 = 0.5rem = 8px

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      {/* Top Panel */}
      <div 
        style={{ height: `calc(${ratio * 100}% - ${dividerHeight / 2}px)` }} 
        className="overflow-hidden shrink-0"
      >
        {topPanel}
      </div>

      {/* Divider */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className={`
          h-2 bg-border cursor-row-resize flex items-center justify-center shrink-0
          hover:bg-primary/30 transition-colors
          ${isDragging ? 'bg-primary/50' : ''}
        `}
      >
        <div className="w-12 h-1 bg-muted-foreground/30 rounded-full" />
      </div>

      {/* Bottom Panel */}
      <div 
        style={{ height: `calc(${(1 - ratio) * 100}% - ${dividerHeight / 2}px)` }} 
        className="overflow-hidden shrink-0"
      >
        {bottomPanel}
      </div>
    </div>
  );
}

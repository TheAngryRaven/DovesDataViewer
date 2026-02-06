import * as React from "react";
import { useRef, useCallback } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

interface RangeSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  formatLabel?: (value: number) => string;
  minRange?: number;
  className?: string;
}

export function RangeSlider({
  min,
  max,
  value,
  onChange,
  formatLabel,
  minRange = 10,
  className,
}: RangeSliderProps) {
  const trackRef = useRef<HTMLSpanElement>(null);
  const dragState = useRef<{ startX: number; startValue: [number, number] } | null>(null);

  const handleValueChange = (newValue: number[]) => {
    if (newValue.length !== 2) return;

    let [start, end] = newValue;

    // Enforce minimum range
    if (end - start < minRange) {
      if (start !== value[0]) {
        end = Math.min(max, start + minRange);
        if (end - start < minRange) {
          start = end - minRange;
        }
      } else {
        start = Math.max(min, end - minRange);
        if (end - start < minRange) {
          end = start + minRange;
        }
      }
    }

    onChange([start, end]);
  };

  // --- Drag-to-pan the selected range ---
  const valueToPx = useCallback(
    (units: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const range = max - min;
      return range > 0 ? (units / range) * track.getBoundingClientRect().width : 0;
    },
    [min, max],
  );

  const pxToValue = useCallback(
    (px: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const range = max - min;
      return range > 0 ? (px / track.getBoundingClientRect().width) * range : 0;
    },
    [min, max],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only drag when the range is actually shortened
      if (value[0] === min && value[1] === max) return;
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragState.current = { startX: e.clientX, startValue: [...value] as [number, number] };
    },
    [value, min, max],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      const dx = e.clientX - dragState.current.startX;
      const dv = pxToValue(dx);
      const span = dragState.current.startValue[1] - dragState.current.startValue[0];

      let newStart = Math.round(dragState.current.startValue[0] + dv);
      let newEnd = newStart + span;

      // Clamp
      if (newStart < min) {
        newStart = min;
        newEnd = min + span;
      }
      if (newEnd > max) {
        newEnd = max;
        newStart = max - span;
      }

      onChange([newStart, newEnd]);
    },
    [min, max, onChange, pxToValue],
  );

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const startLabel = formatLabel ? formatLabel(value[0]) : value[0].toString();
  const endLabel = formatLabel ? formatLabel(value[1]) : value[1].toString();

  const range = max - min;
  const startPercent = range > 0 ? ((value[0] - min) / range) * 100 : 0;
  const endPercent = range > 0 ? ((value[1] - min) / range) * 100 : 100;
  const isFullRange = value[0] === min && value[1] === max;

  return (
    <div className={cn("relative px-2 py-3", className)}>
      {/* Labels */}
      <div className="absolute -top-1 left-0 right-0 pointer-events-none">
        <div
          className="absolute text-xs font-mono text-muted-foreground whitespace-nowrap transform -translate-x-1/2"
          style={{ left: `calc(${startPercent}% + 8px)` }}
        >
          {startLabel}
        </div>
        <div
          className="absolute text-xs font-mono text-muted-foreground whitespace-nowrap transform -translate-x-1/2"
          style={{ left: `calc(${endPercent}% + 8px)` }}
        >
          {endLabel}
        </div>
      </div>

      <SliderPrimitive.Root
        min={min}
        max={max}
        step={1}
        value={value}
        onValueChange={handleValueChange}
        className="relative flex w-full touch-none select-none items-center"
      >
        <SliderPrimitive.Track
          ref={trackRef}
          className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary"
        >
          <SliderPrimitive.Range
            className={cn(
              "absolute h-full bg-primary/60",
              !isFullRange && "cursor-grab active:cursor-grabbing",
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-ew-resize" />
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-ew-resize" />
      </SliderPrimitive.Root>
    </div>
  );
}

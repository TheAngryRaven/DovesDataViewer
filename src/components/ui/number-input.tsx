import * as React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface NumberInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  onValueChange?: (value: string) => void;
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, step = "1", onValueChange, onChange, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const combinedRef = (node: HTMLInputElement | null) => {
      (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (onValueChange) onValueChange(e.target.value);
      if (onChange) onChange(e);
    };

    const stepValue = (direction: 1 | -1) => {
      const input = inputRef.current;
      if (!input) return;
      if (direction === 1) input.stepUp();
      else input.stepDown();
      const nativeEvent = new Event("input", { bubbles: true });
      input.dispatchEvent(nativeEvent);
      if (onValueChange) onValueChange(input.value);
      if (onChange) {
        const syntheticEvent = { target: input, currentTarget: input } as React.ChangeEvent<HTMLInputElement>;
        onChange(syntheticEvent);
      }
    };

    return (
      <div className="relative flex">
        <input
          type="number"
          step={step}
          onChange={handleChange}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pr-8 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            className,
          )}
          ref={combinedRef}
          {...props}
        />
        <div className="absolute right-0 top-0 bottom-0 flex flex-col border-l border-input rounded-r-md overflow-hidden">
          <button
            type="button"
            tabIndex={-1}
            onClick={() => stepValue(1)}
            className="flex-1 flex items-center justify-center w-7 bg-secondary hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <div className="h-px bg-border" />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => stepValue(-1)}
            className="flex-1 flex items-center justify-center w-7 bg-secondary hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  },
);
NumberInput.displayName = "NumberInput";

export { NumberInput };

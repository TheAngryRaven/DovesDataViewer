/**
 * SimDevicePanel — "the device" (plan 0010, Phase A).
 *
 * Renders the firmware's REAL 128×64 framebuffer on a canvas: offscreen
 * 1:1 ImageData, blitted at an INTEGER scale only (fractional scaling
 * would interpolate away the pixel-perfection the wasm build guarantees),
 * `image-rendering: pixelated`, inside a subtle bezel so it reads as
 * hardware. A true-size toggle renders the panel at its physical active
 * area (≈55 × 27.5 mm) via CSS millimetres — blown-up looks great and
 * lies; legibility critique needs true size. Defaults ON for first-time
 * visitors.
 *
 * The three buttons feed the sim's pin map (pointer events + ←/Enter/→),
 * so presses go through the real firmware debounce — including during
 * playback.
 */

import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BirdsEyeSim } from "@/lib/sim/simClient";

const FB_W = 128;
const FB_H = 64;
/** SH1106 128×64 panel active area, mm (the spec's "true size"). */
const PANEL_W_MM = 55.0;
const PANEL_H_MM = 27.5;

export interface SimDevicePanelProps {
  /** Register/unregister the blit sink (called when the frame hash changes). */
  setFrameSink: (sink: ((sim: BirdsEyeSim) => void) | null) => void;
  buttonDown: (idx: number) => void;
  buttonUp: (idx: number) => void;
  trueSize: boolean;
  onTrueSizeChange: (v: boolean) => void;
  scale: number;
  onScaleChange: (s: number) => void;
}

export function SimDevicePanel({
  setFrameSink, buttonDown, buttonUp,
  trueSize, onTrueSizeChange, scale, onScaleChange,
}: SimDevicePanelProps) {
  const { t } = useTranslation("simulator");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<ImageData | null>(null);

  // Blit sink: firmware page layout -> 1:1 ImageData -> canvas. The host
  // hook only calls this when the frame hash actually changed (fw paints
  // at 3 Hz — no 60 fps repaints of identical pixels).
  const blit = useCallback((sim: BirdsEyeSim) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let img = imageRef.current;
    if (!img) {
      img = ctx.createImageData(FB_W, FB_H);
      imageRef.current = img;
    }
    const fb = sim.getFramebuffer();
    const px = img.data;
    for (let y = 0; y < FB_H; y++) {
      const page = (y >> 3) * FB_W;
      const bit = y & 7;
      for (let x = 0; x < FB_W; x++) {
        const on = (fb[x + page] >> bit) & 1;
        const o = (y * FB_W + x) * 4;
        // Warm OLED white on near-black, like the real panel.
        px[o] = on ? 240 : 6;
        px[o + 1] = on ? 244 : 8;
        px[o + 2] = on ? 248 : 10;
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  useEffect(() => {
    setFrameSink(blit);
    return () => setFrameSink(null);
  }, [blit, setFrameSink]);

  // Keyboard: ← Enter → (ignore auto-repeat; the fw does its own timing).
  useEffect(() => {
    const keyIdx = (key: string) =>
      key === "ArrowLeft" ? 0 : key === "Enter" ? 1 : key === "ArrowRight" ? 2 : -1;
    const down = (e: KeyboardEvent) => {
      const idx = keyIdx(e.key);
      if (idx < 0 || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      e.preventDefault();
      buttonDown(idx);
    };
    const up = (e: KeyboardEvent) => {
      const idx = keyIdx(e.key);
      if (idx >= 0) buttonUp(idx);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [buttonDown, buttonUp]);

  const sizeStyle = trueSize
    ? { width: `${PANEL_W_MM}mm`, height: `${PANEL_H_MM}mm` }
    : { width: FB_W * scale, height: FB_H * scale };

  const deviceButton = (idx: number, label: string, icon: React.ReactNode) => (
    <Button
      variant="secondary"
      size="sm"
      className="touch-none select-none px-5"
      aria-label={label}
      onPointerDown={() => buttonDown(idx)}
      onPointerUp={() => buttonUp(idx)}
      onPointerCancel={() => buttonUp(idx)}
      onPointerLeave={() => buttonUp(idx)}
    >
      {icon}
    </Button>
  );

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-xl border border-border bg-zinc-900 p-4 shadow-inner dark:bg-zinc-950">
        <canvas
          ref={canvasRef}
          width={FB_W}
          height={FB_H}
          style={{ ...sizeStyle, imageRendering: "pixelated" }}
          className="block bg-black"
          aria-label={t("display.canvasLabel")}
        />
      </div>

      <div className="flex items-center gap-2" role="group" aria-label={t("buttons.group")}>
        {deviceButton(0, t("buttons.left"), <ChevronLeft className="h-4 w-4" />)}
        {deviceButton(1, t("buttons.select"), <CircleDot className="h-4 w-4" />)}
        {deviceButton(2, t("buttons.right"), <ChevronRight className="h-4 w-4" />)}
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
          {t("buttons.keyboardHint")}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <Switch id="sim-true-size" checked={trueSize} onCheckedChange={onTrueSizeChange} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Label htmlFor="sim-true-size" className="cursor-help underline decoration-dotted">
                {t("display.trueSize")}
              </Label>
            </TooltipTrigger>
            <TooltipContent className="max-w-56">{t("display.trueSizeWhy")}</TooltipContent>
          </Tooltip>
        </div>
        {!trueSize && (
          <div className="flex items-center gap-2">
            <Label>{t("display.scale")}</Label>
            <Select value={String(scale)} onValueChange={(v) => onScaleChange(Number(v))}>
              <SelectTrigger className="h-8 w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[4, 6, 8].map((s) => (
                  <SelectItem key={s} value={String(s)}>{s}×</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

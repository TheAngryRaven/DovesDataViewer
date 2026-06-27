// Client-side avatar cropping: take any uploaded image, crop a centered square,
// downscale so neither side exceeds a cap (256 px), and re-encode small. Pure
// browser work — no upload, no Supabase — so profile pictures never need a
// server-side image pipeline (Golden Rule 1: don't do on the server what the
// client can do). The geometry is split into `computeSquareCrop` so it can be
// unit-tested without a real canvas.

export interface SquareCrop {
  /** Source-x of the centered square crop. */
  sx: number;
  /** Source-y of the centered square crop. */
  sy: number;
  /** Side length of the square crop in source pixels. */
  side: number;
  /** Output side length (<= side, capped at `max`). */
  target: number;
}

/**
 * Geometry for a centered 1:1 crop downscaled to at most `max` px per side.
 * Never upscales: `target` is the smaller of the crop side and `max`.
 */
export function computeSquareCrop(width: number, height: number, max: number): SquareCrop {
  const side = Math.max(0, Math.min(width, height));
  const sx = Math.floor((width - side) / 2);
  const sy = Math.floor((height - side) / 2);
  const target = Math.max(1, Math.min(side, max));
  return { sx, sy, side, target };
}

export interface CroppedImage {
  blob: Blob;
  width: number;
  height: number;
  type: string;
}

export interface CropOptions {
  /** Max output side in px (default 256). */
  max?: number;
  /** Encoder quality 0..1 (default 0.85). */
  quality?: number;
  /** Preferred output type; falls back to JPEG if unsupported (default webp). */
  type?: "image/webp" | "image/jpeg";
}

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Decode a Blob to a drawable image, preferring createImageBitmap. */
async function loadImage(file: Blob): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  // Fallback for older webviews without createImageBitmap.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Failed to decode image"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Crop `file` to a centered square, downscale to at most `max` px (default 256),
 * and re-encode (webp when supported, else jpeg). Throws on an undecodable image.
 */
export async function cropToSquareAvatar(file: Blob, opts: CropOptions = {}): Promise<CroppedImage> {
  const max = opts.max ?? 256;
  const quality = opts.quality ?? 0.85;
  const preferred = opts.type ?? "image/webp";

  const img = await loadImage(file);
  try {
    if (!img.width || !img.height) throw new Error("Image has no dimensions");
    const { sx, sy, side, target } = computeSquareCrop(img.width, img.height, max);

    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img.source, sx, sy, side, side, 0, 0, target, target);

    // Prefer webp; if the platform can't encode it, toBlob yields null → jpeg.
    let blob = await canvasToBlob(canvas, preferred, quality);
    if (!blob || (preferred === "image/webp" && !blob.type.includes("webp"))) {
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }
    if (!blob) throw new Error("Failed to encode cropped image");

    return { blob, width: target, height: target, type: blob.type || "image/jpeg" };
  } finally {
    img.close();
  }
}

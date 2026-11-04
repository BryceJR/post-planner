// Browser-side picture work before an upload: read a file, shrink it to a
// 2048 px JPEG, so a phone's 8 MB photo uploads in a moment. No React here.

export const FULL_LONG_SIDE = 2048;
export const THUMB_LONG_SIDE = 480;

export type ImageSource = ImageBitmap | HTMLImageElement;

export class UnreadableImageError extends Error {
  constructor() {
    super("Couldn't read this photo; try a JPEG.");
    this.name = "UnreadableImageError";
  }
}

function viaImgElement(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new UnreadableImageError());
    };
    img.src = url;
  });
}

// createImageBitmap honors EXIF orientation and is fast; an <img> is the fallback.
export async function readImage(file: File): Promise<ImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // fall through: HEIC and friends land here on most browsers
    }
  }
  return viaImgElement(file);
}

function sizeOf(src: ImageSource) {
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  return { w: src.width, h: src.height };
}

// Draws the source onto a fresh canvas whose long side is at most `maxLong`.
export function drawResized(src: ImageSource | HTMLCanvasElement, maxLong: number): HTMLCanvasElement {
  const { w, h } = src instanceof HTMLCanvasElement ? { w: src.width, h: src.height } : sizeOf(src);
  if (!w || !h) throw new UnreadableImageError();
  const scale = Math.min(1, maxLong / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize photos.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the photo."))), "image/jpeg", quality);
    } catch (e) {
      reject(e);
    }
  });
}


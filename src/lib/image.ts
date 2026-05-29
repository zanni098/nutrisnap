"use client";

export interface ProcessedImage {
  /** Full-size-ish data URL sent to the model (downscaled, JPEG). */
  dataUrl: string;
  /** Small data URL stored with the meal as a thumbnail. */
  thumbnail: string;
  mimeType: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image."));
    img.src = src;
  });
}

function drawToDataUrl(img: HTMLImageElement, maxSize: number, quality: number): string {
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported.");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Read a File (or data URL) and produce a downscaled image + thumbnail. */
export async function processImageFile(file: File): Promise<ProcessedImage> {
  const reader = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.readAsDataURL(file);
  });
  return processDataUrl(reader);
}

export async function processDataUrl(src: string): Promise<ProcessedImage> {
  const img = await loadImage(src);
  return {
    dataUrl: drawToDataUrl(img, 1024, 0.82),
    thumbnail: drawToDataUrl(img, 320, 0.7),
    mimeType: "image/jpeg",
  };
}

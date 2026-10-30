export function isVectorImage(src: string, mimeType?: string): boolean {
  return (
    mimeType?.split(";", 1)[0]?.trim().toLowerCase() === "image/svg+xml" ||
    /^data:image\/svg\+xml(?:[;,]|$)/i.test(src)
  );
}

export function fitZoomableImage({
  availableWidth,
  maxHeight,
  naturalWidth,
  naturalHeight,
  allowUpscale,
}: {
  availableWidth: number;
  maxHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  allowUpscale: boolean;
}): number {
  return Math.min(
    allowUpscale ? Infinity : 1,
    availableWidth / (naturalWidth || 1),
    maxHeight / (naturalHeight || 1),
  );
}

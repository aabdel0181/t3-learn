import { describe, expect, it } from "vite-plus/test";

import { fitZoomableImage, isVectorImage } from "./ZoomableImage.logic.ts";

describe("fitZoomableImage", () => {
  it.each([
    {
      name: "caps raster images at natural size",
      allowUpscale: false,
      expected: 1,
    },
    {
      name: "scales vector images up to the available viewer area",
      allowUpscale: true,
      expected: 2,
    },
  ])("$name", ({ allowUpscale, expected }) => {
    expect(
      fitZoomableImage({
        availableWidth: 800,
        maxHeight: 600,
        naturalWidth: 400,
        naturalHeight: 300,
        allowUpscale,
      }),
    ).toBe(expected);
  });
});

describe("isVectorImage", () => {
  it("recognizes SVG MIME types and data URLs", () => {
    expect(isVectorImage("blob:diagram", "image/svg+xml")).toBe(true);
    expect(isVectorImage("data:image/svg+xml,%3Csvg%3E")).toBe(true);
    expect(isVectorImage("data:image/png;base64,AAAA", "image/png")).toBe(false);
  });
});

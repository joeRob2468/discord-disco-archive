/**
 * The square crop's geometry, in the image's own pixels: which square of the image the
 * frame shows (`crop.ts` draws it and cuts it out). Pure, so it's tested on its own.
 */

/** The framed square: its centre and its side, in image pixels. */
export interface CropSquare {
  cx: number;
  cy: number;
  side: number;
}

/** How far in the zoom slider goes: 1 shows the whole short side, 4 a quarter of it. */
export const MAX_ZOOM = 4;

/** The framed square at `zoom`, centred on (cx, cy) but kept within the image. */
export function cropSquare(
  width: number,
  height: number,
  zoom: number,
  cx: number,
  cy: number,
): CropSquare {
  const side = Math.min(width, height) / Math.min(Math.max(zoom, 1), MAX_ZOOM);
  const clamp = (value: number, size: number) =>
    Math.min(Math.max(value, side / 2), size - side / 2);
  return { cx: clamp(cx, width), cy: clamp(cy, height), side };
}

/** Where to draw the image so the frame (`frame` CSS pixels wide) shows `square`. */
export function placement(
  square: CropSquare,
  frame: number,
): { scale: number; left: number; top: number } {
  const scale = frame / square.side;
  return {
    scale,
    left: frame / 2 - square.cx * scale,
    top: frame / 2 - square.cy * scale,
  };
}

/** The square after dragging the image by (dx, dy) CSS pixels in a `frame`-wide frame. */
export function dragged(
  square: CropSquare,
  width: number,
  height: number,
  zoom: number,
  frame: number,
  dx: number,
  dy: number,
): CropSquare {
  const perPixel = square.side / frame;
  return cropSquare(width, height, zoom, square.cx - dx * perPixel, square.cy - dy * perPixel);
}

/** The output's side: the framed square at its own resolution, at most `max` pixels. */
export const outputSide = (square: CropSquare, max: number): number =>
  Math.max(1, Math.min(max, Math.round(square.side)));

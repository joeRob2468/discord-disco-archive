import { describe, expect, it } from 'vitest';
import { cropSquare, dragged, MAX_ZOOM, outputSide, placement } from './crop-geometry.ts';

describe('crop geometry', () => {
  it('frames the whole short side at zoom 1, and less as it zooms in', () => {
    expect(cropSquare(1600, 900, 1, 800, 450)).toEqual({ cx: 800, cy: 450, side: 900 });
    expect(cropSquare(1600, 900, 2, 800, 450).side).toBe(450);
    // Zoom is capped both ways.
    expect(cropSquare(1600, 900, 0.5, 800, 450).side).toBe(900);
    expect(cropSquare(1600, 900, MAX_ZOOM * 2, 800, 450).side).toBe(900 / MAX_ZOOM);
  });

  it('keeps the square inside the image', () => {
    expect(cropSquare(1600, 900, 1, 0, 0)).toEqual({ cx: 450, cy: 450, side: 900 });
    expect(cropSquare(1600, 900, 1, 5000, 5000)).toEqual({ cx: 1150, cy: 450, side: 900 });
  });

  it('places the image so the frame shows the square', () => {
    const square = { cx: 1150, cy: 450, side: 900 };
    // A 300 px frame showing a 900 px square: a third of the size, shifted left.
    expect(placement(square, 300)).toEqual({ scale: 1 / 3, left: 150 - 1150 / 3, top: 0 });
  });

  it('moves the square against a drag, in image pixels', () => {
    const square = cropSquare(1600, 900, 1, 800, 450);
    // Dragging the image 100 px right in a 300 px frame shows 300 image px further left.
    expect(dragged(square, 1600, 900, 1, 300, 100, 0)).toEqual({ cx: 500, cy: 450, side: 900 });
    // Never past the edge.
    expect(dragged(square, 1600, 900, 1, 300, 1000, 1000).cx).toBe(450);
  });

  it('outputs at the square’s own size, up to the cap', () => {
    expect(outputSide({ cx: 0, cy: 0, side: 450.4 }, 1024)).toBe(450);
    expect(outputSide({ cx: 0, cy: 0, side: 3000 }, 1024)).toBe(1024);
  });
});

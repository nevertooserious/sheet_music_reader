import { describe, expect, it } from 'vitest';
import { MAX_BITMAP_PIXELS, bitmapBytes, effectiveDpr, pageRange, renderOrder } from './pageMath';

describe('effectiveDpr', () => {
  it('caps the device ratio at 2 and tolerates bogus values', () => {
    expect(effectiveDpr(1, 600, 800)).toBe(1);
    expect(effectiveDpr(2, 600, 800)).toBe(2);
    expect(effectiveDpr(3, 600, 800)).toBe(2);
    expect(effectiveDpr(0, 600, 800)).toBe(1);
    expect(effectiveDpr(NaN, 600, 800)).toBe(1);
  });

  it('reduces the ratio so the bitmap stays under the pixel budget', () => {
    const dpr = effectiveDpr(2, 4000, 5000);
    expect(dpr).toBeLessThan(2);
    expect(4000 * 5000 * dpr * dpr).toBeLessThanOrEqual(MAX_BITMAP_PIXELS * 1.001);
    expect(effectiveDpr(2, 1044, 1477)).toBe(2);
  });
});

describe('pageRange', () => {
  it('expands the visible pages by the margin and clamps', () => {
    expect(pageRange([3], 24, 1)).toEqual({ from: 2, to: 4 });
    expect(pageRange([0, 1], 24, 1)).toEqual({ from: 0, to: 2 });
    expect(pageRange([23], 24, 2)).toEqual({ from: 21, to: 23 });
    expect(pageRange([0], 1, 1)).toEqual({ from: 0, to: 0 });
  });

  it('is undefined when nothing is visible', () => {
    expect(pageRange([], 24, 1)).toBeUndefined();
    expect(pageRange([2], 0, 1)).toBeUndefined();
  });
});

describe('renderOrder', () => {
  it('renders visible pages first, then the next page, then the previous', () => {
    expect(renderOrder([5, 6], { from: 4, to: 7 })).toEqual([5, 6, 7, 4]);
    expect(renderOrder([0], { from: 0, to: 1 })).toEqual([0, 1]);
    expect(renderOrder([], { from: 2, to: 4 })).toEqual([2, 3, 4]);
  });

  it('ignores visible indices outside the range', () => {
    expect(renderOrder([1, 9], { from: 0, to: 2 })).toEqual([1, 2, 0]);
  });
});

describe('bitmapBytes', () => {
  it('sums RGBA bytes of every canvas', () => {
    expect(bitmapBytes([{ width: 10, height: 10 }, { width: 0, height: 0 }])).toBe(400);
  });
});

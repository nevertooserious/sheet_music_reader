import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '../core/types';
import { noteStaffY, staffMiddleY } from './mockPage';

const box: LayoutBox = { page: 0, x: 60, y: 120, width: 100, height: 40 };

describe('noteStaffY', () => {
  it('puts the treble middle-line pitch (B4) on the middle line', () => {
    expect(noteStaffY(71, 'treble', box)).toBe(staffMiddleY(box));
    expect(staffMiddleY(box)).toBe(140);
  });

  it('moves one half line-gap per diatonic step and treats sharps as their natural letter', () => {
    expect(noteStaffY(72, 'treble', box)).toBe(136);
    expect(noteStaffY(74, 'treble', box)).toBe(132);
    expect(noteStaffY(78, 'treble', box)).toBe(noteStaffY(77, 'treble', box));
    expect(noteStaffY(67, 'treble', box)).toBe(148);
  });

  it('uses D3 as the bass middle line and puts G2 on the bottom line', () => {
    expect(noteStaffY(50, 'bass', box)).toBe(140);
    expect(noteStaffY(43, 'bass', box)).toBe(156);
    expect(noteStaffY(62, 'bass', box)).toBe(112);
  });
});

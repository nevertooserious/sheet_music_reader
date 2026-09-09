import type { ScoreParser } from '../core/contracts';

/**
 * Factory for the PDF → ScoreModel parser. Owned by the parsing builder.
 * This stub is replaced in wave 2.
 */
export function createParser(): ScoreParser {
  return {
    async parse() {
      throw new Error('parsing module not implemented');
    },
  };
}

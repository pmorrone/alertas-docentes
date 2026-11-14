import { z } from 'zod';
import { SHIFTS, normalizeText, type Shift } from '../collector/index.js';

/**
 * A teacher's search criteria, already normalized (accent-free lowercase text, deduplicated).
 * Build it with `createCriteria`; `matches` relies on that normalization.
 *
 * Every list is a filter that is only applied when non-empty: an empty list means
 * "no restriction". Within a list the values are OR-ed; the different filters are AND-ed.
 */
export interface Criteria {
  /** District names, e.g. "general pueyrredon". */
  districts: readonly string[];
  /** Level/modality names, e.g. "secundaria". */
  levels: readonly string[];
  /**
   * Areas/positions. Each entry is either an `areaincumbencia` code ("mcs") compared
   * exactly, or free text ("historia") compared as whole words against the position.
   */
  areas: readonly string[];
  shifts: readonly Shift[];
  onlySubstitutes: boolean;
}

const textList = z
  .array(z.string())
  .default([])
  .transform((values) => [...new Set(values.map(normalizeText).filter((v) => v !== ''))]);

export const criteriaSchema = z.object({
  districts: textList,
  levels: textList,
  areas: textList,
  shifts: z
    .array(z.enum(SHIFTS))
    .default([])
    .transform((values) => SHIFTS.filter((s) => values.includes(s))),
  onlySubstitutes: z.boolean().default(false),
});

/** Validates untrusted input (e.g. from the bot or the LLM) and normalizes it. */
export function createCriteria(input: z.input<typeof criteriaSchema>): Criteria {
  return criteriaSchema.parse(input);
}

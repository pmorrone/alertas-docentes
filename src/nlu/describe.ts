import { type Criteria } from '../matcher/index.js';
import type { Shift } from '../collector/index.js';
import type { Catalog } from './catalog.js';
import { keyOf, sentenceCase } from './text.js';

const SHIFT_NAMES: Record<Shift, string> = { M: 'Mañana', T: 'Tarde', N: 'Noche' };

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Human-readable (Spanish) one-line description, e.g. "Historia · Tandil · Mañana". */
export function describeCriteria(
  criteria: Criteria,
  catalog: Catalog,
  areaLabels: readonly string[] = [],
): string {
  const byCode = new Map(catalog.areas.map((a) => [a.code.toLowerCase(), a]));
  const districtNames = new Map(catalog.districts.map((d) => [d.key, d.name]));
  const levelNames = new Map(catalog.levels.map((l) => [l.key, l.name]));

  const areas = unique(
    areaLabels.length > 0
      ? [...areaLabels]
      : criteria.areas.map((term) => {
          const area = byCode.get(term);
          return sentenceCase(area ? area.description : term);
        }),
  );
  const levels = criteria.levels.map((l) => levelNames.get(keyOf(l)) ?? sentenceCase(l));
  const districts = criteria.districts.map((d) => districtNames.get(keyOf(d)) ?? sentenceCase(d));
  const shifts = criteria.shifts.length < 3 ? criteria.shifts.map((s) => SHIFT_NAMES[s]) : [];

  return [
    areas.join(', '),
    levels.join(', '),
    districts.join(', '),
    shifts.join(' y '),
    criteria.onlySubstitutes ? 'Solo suplencias' : '',
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

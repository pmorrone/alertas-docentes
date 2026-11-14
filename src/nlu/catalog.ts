import { z } from 'zod';
import { keyOf, tokenize } from './text.js';

export interface DistrictEntry {
  /** Display name, e.g. "La Plata". */
  name: string;
  /** Comparison key, e.g. "la plata". */
  key: string;
}

export interface LevelEntry {
  name: string;
  key: string;
}

export interface AreaEntry {
  /** `areaincumbencia` code, e.g. "HTR". */
  code: string;
  description: string;
  /** Tokens of the description, accent-free. */
  tokens: string[];
  key: string;
  historicalOffers: number;
}

export interface Catalog {
  districts: DistrictEntry[];
  levels: LevelEntry[];
  areas: AreaEntry[];
}

export const districtsAndLevelsSchema = z.object({
  distritos: z.array(z.object({ nombre: z.string(), solr: z.string() })).min(1),
  niveles: z.array(z.object({ nombre: z.string(), solr: z.string() })).min(1),
});

export const areasSchema = z.object({
  areas: z
    .array(
      z.object({
        codigo: z.string().min(1),
        descripcion: z.string(),
        ofertas_historicas: z.number().default(0),
      }),
    )
    .min(1),
});

export function buildCatalog(
  districtsAndLevels: z.input<typeof districtsAndLevelsSchema>,
  areas: z.input<typeof areasSchema>,
): Catalog {
  const dl = districtsAndLevelsSchema.parse(districtsAndLevels);
  const ar = areasSchema.parse(areas);
  const entry = (e: { nombre: string; solr: string }) => ({
    name: e.nombre.replace(/\s+/g, ' ').trim(),
    key: keyOf(e.solr),
  });
  return {
    districts: dl.distritos.map(entry),
    levels: dl.niveles.map(entry),
    areas: ar.areas.map((a) => ({
      code: a.codigo,
      description: a.descripcion,
      tokens: tokenize(a.descripcion),
      key: keyOf(a.descripcion),
      historicalOffers: a.ofertas_historicas,
    })),
  };
}

export const synonymsSchema = z.object({
  distritos: z.record(z.string(), z.string()).default({}),
  niveles: z.record(z.string(), z.string()).default({}),
  areas: z.record(z.string(), z.array(z.string()).min(1)).default({}),
});

export type Synonyms = z.output<typeof synonymsSchema>;

/** Lists synonym entries whose target does not exist in the catalog (empty when valid). */
export function validateSynonyms(catalog: Catalog, synonyms: Synonyms): string[] {
  const districtKeys = new Set(catalog.districts.map((d) => d.key));
  const levelKeys = new Set(catalog.levels.map((l) => l.key));
  const codes = new Set(catalog.areas.map((a) => a.code.toLowerCase()));
  const problems: string[] = [];

  for (const [alias, target] of Object.entries(synonyms.distritos)) {
    if (!districtKeys.has(keyOf(target))) problems.push(`distritos.${alias} -> "${target}"`);
  }
  for (const [alias, target] of Object.entries(synonyms.niveles)) {
    if (!levelKeys.has(keyOf(target))) problems.push(`niveles.${alias} -> "${target}"`);
  }
  for (const [alias, targets] of Object.entries(synonyms.areas)) {
    for (const code of targets) {
      if (!codes.has(code.toLowerCase())) problems.push(`areas.${alias} -> code "${code}"`);
    }
  }
  return problems;
}

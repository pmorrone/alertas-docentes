import { readFileSync } from 'node:fs';
import { buildCatalog, synonymsSchema, type Catalog, type Synonyms } from './catalog.js';
import { createInterpreter } from './interpreter.js';
import type { Interpreter } from './types.js';

// Resolved from this file so it works from src/ (tsx, tests) and from dist/ alike.
const ROOT = new URL('../../', import.meta.url);

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(new URL(relative, ROOT), 'utf8'));

export function loadCatalog(): Catalog {
  return buildCatalog(
    readJson('fixtures/catalogo-distritos-niveles.json') as never,
    readJson('fixtures/catalogo-areas.json') as never,
  );
}

export function loadSynonyms(): Synonyms {
  return synonymsSchema.parse(readJson('data/sinonimos.json'));
}

/** Builds the interpreter from the catalogs in `fixtures/` and `data/sinonimos.json`. */
export function loadInterpreter(): Interpreter {
  return createInterpreter({ catalog: loadCatalog(), synonyms: loadSynonyms() });
}

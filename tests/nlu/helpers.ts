import { loadCatalog, loadInterpreter, loadSynonyms } from '../../src/nlu/index.js';
import type { CreateIntent, Interpretation, Question } from '../../src/nlu/index.js';

/** Interpreter built from the real catalogs in fixtures/ and data/sinonimos.json. */
export const interpreter = loadInterpreter();
export const catalog = loadCatalog();
export const synonyms = loadSynonyms();

export function expectCreate(result: Interpretation): CreateIntent {
  if (result.kind !== 'create') throw new Error(`expected create, got ${JSON.stringify(result)}`);
  return result;
}

export function expectQuestion(result: Interpretation): Question {
  if (result.kind !== 'question')
    throw new Error(`expected question, got ${JSON.stringify(result)}`);
  return result;
}

/** Criteria sets compared without caring about order. */
export const sorted = (values: readonly string[]): string[] => [...values].sort();

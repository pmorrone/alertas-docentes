export { createInterpreter, type InterpreterConfig } from './interpreter.js';
export { loadInterpreter, loadCatalog, loadSynonyms } from './load.js';
export {
  buildCatalog,
  synonymsSchema,
  validateSynonyms,
  type Catalog,
  type Synonyms,
} from './catalog.js';
export { describeCriteria } from './describe.js';
export type * from './types.js';

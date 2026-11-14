import type { Shift } from '../collector/index.js';
import { createCriteria, type Criteria } from '../matcher/index.js';
import type { Catalog, Synonyms } from './catalog.js';
import { describeCriteria } from './describe.js';
import { closest, levenshtein } from './fuzzy.js';
import { containsRun, keyOf, sentenceCase, tokenize } from './text.js';
import type {
  CriteriaInput,
  DraftState,
  Interpretation,
  Interpreter,
  Issue,
  Question,
  QuestionOption,
} from './types.js';

export interface InterpreterConfig {
  catalog: Catalog;
  synonyms: Synonyms;
}

const words = (list: string): Set<string> => new Set(list.split(/\s+/).filter(Boolean));

const SHIFT_WORDS: Record<string, Shift> = {
  manana: 'M',
  matutino: 'M',
  matutina: 'M',
  tarde: 'T',
  noche: 'N',
  nocturno: 'N',
  nocturna: 'N',
};
/** "Vespertino" is evening in some schools and afternoon in others: ask. */
const EVENING_WORDS = words('vespertino vespertina');
const SUBSTITUTE_WORDS = words('suplencia suplencias suplente suplentes suplir');
/** Filters the user can ask for but alerts cannot express yet. */
const UNSUPPORTED_WORDS = words(
  'provisional provisionales titular titulares interino interina interinos',
);

const DELETE_WORDS = words(
  'borra borrar borrame borres elimina eliminar eliminame saca sacar quita quitar cancela cancelar anula anular',
);
const VIEW_WORDS = words('ver mostrame mostra muestrame listar lista listame');
const HELP_WORDS = words('ayuda ayudame help start comandos instrucciones');
const HELP_PHRASES = [
  'como funciona',
  'que podes hacer',
  'que haces',
  'como se usa',
  'no entiendo',
];
const CREATE_WORDS = words(
  'quiero queres quisiera necesito busco buscame busca buscar avisame avise avises avisas avisen avisar avisarme agrega agregar agregame crea crear creame nueva nuevo alerta alertas recibir recibo mandame enterarme pasame dame',
);
const ALL_WORDS = words('todas todos');

/** Asking for an alert wins over asking to look: "avisame si hay ofertas de historia". */
const ALERT_VERBS = words(
  'avisame avise avises avisas avisen avisar avisarme alerta alertas crear crea creame agrega agregar agregame nueva nuevo',
);
const OFFER_WORDS = words('oferta ofertas cargo cargos suplencia suplencias');
const SEARCH_PHRASES = [
  'que hay',
  'hay algo',
  'hay alguna',
  'hay ofertas',
  'hay cargos',
  'hay suplencias',
  'ofertas ahora',
  'ofertas hoy',
  'ahora hay',
  'hoy hay',
];

/** Words that carry no criteria and are removed entirely (they also separate phrases). */
const NOISE_WORDS = words(
  `aviso avisos cargo cargos hora horas modulo modulos materia materias trabajo trabajos laburo
   puesto puestos oferta ofertas profe profesor profesora docente hoy ahora favor porfa gracias
   hola buenas buen dia turno turnos todos todas cualquier cualquiera solo solamente tambien
   ademas zona distrito localidad partido nivel mi mis me te nos busquedas ya`,
);
/** Function words: ignored at the edges of a phrase but allowed inside ("practicas del lenguaje"). */
const STOP_WORDS = words(
  'de del la el los las un una unos unas en a al y o e u para por con sin que lo le les se es son hay algo esto esta ese esa si ni como cuando donde',
);
const CONNECTORS = words('y o e');

const MAX_PHRASE_TOKENS = 5;
const MAX_OPTIONS = 5;

interface Target {
  kind: 'district' | 'level';
  /** Catalog key, e.g. "general pueyrredon". */
  value: string;
}

type AreaOutcome =
  /** `exact`: matched a synonym or a whole area name (not just a part of one). */
  | { type: 'resolved'; codes: string[]; label: string; exact: boolean }
  | { type: 'ambiguous'; phrase: string; label: string; options: QuestionOption[] }
  | { type: 'unrecognized'; phrase: string };

interface ExtractedPatch {
  districts: string[];
  levels: string[];
  areas: string[];
  /** Readable names of the areas, for the confirmation message. */
  areaLabels: string[];
  shifts: Shift[];
  onlySubstitutes: boolean;
}

interface Extraction {
  patch: ExtractedPatch;
  issues: Issue[];
  notes: string[];
  /** Whether anything meaningful (district, level, area, shift, suplencia) was found. */
  recognized: boolean;
}

/** Creates the interpreter. Pure: no I/O, deterministic. */
export function createInterpreter({ catalog, synonyms }: InterpreterConfig): Interpreter {
  // ---- districts and levels: exact names, aliases and synonyms ------------------------
  const targets = new Map<string, Target[]>();
  const addTarget = (key: string, target: Target): void => {
    const list = targets.get(key) ?? [];
    if (!list.some((t) => t.kind === target.kind && t.value === target.value)) list.push(target);
    targets.set(key, list);
  };
  for (const d of catalog.districts) addTarget(d.key, { kind: 'district', value: d.key });
  for (const l of catalog.levels) addTarget(l.key, { kind: 'level', value: l.key });

  // "general pueyrredon" can also be said "pueyrredon"; only when the short form is unique.
  const honorifics = new Set(['general', 'coronel', 'presidente', 'capitan', 'almirante']);
  const aliasOwners = new Map<string, Set<string>>();
  for (const d of catalog.districts) {
    const [first, ...rest] = d.key.split(' ');
    const alias = rest.join(' ');
    if (first && honorifics.has(first) && alias.length >= 5) {
      aliasOwners.set(alias, (aliasOwners.get(alias) ?? new Set()).add(d.key));
    }
  }
  for (const [alias, owners] of aliasOwners) {
    if (owners.size === 1 && !targets.has(alias)) {
      addTarget(alias, { kind: 'district', value: [...owners][0] as string });
    }
  }
  for (const [alias, target] of Object.entries(synonyms.distritos)) {
    addTarget(keyOf(alias), { kind: 'district', value: keyOf(target) });
  }
  for (const [alias, target] of Object.entries(synonyms.niveles)) {
    addTarget(keyOf(alias), { kind: 'level', value: keyOf(target) });
  }
  const keysByTokenCount = new Map<number, string[]>();
  for (const key of targets.keys()) {
    const n = key.split(' ').length;
    keysByTokenCount.set(n, [...(keysByTokenCount.get(n) ?? []), key]);
  }

  // ---- areas ----------------------------------------------------------------------------
  const areaVocabulary = new Set<string>();
  const areasByKey = new Map<string, string[]>();
  for (const area of catalog.areas) {
    for (const token of area.tokens) areaVocabulary.add(token);
    areasByKey.set(area.key, [...(areasByKey.get(area.key) ?? []), area.code]);
  }
  const areaSynonyms = new Map(
    Object.entries(synonyms.areas).map(([alias, codes]) => [keyOf(alias), codes]),
  );
  for (const key of areaSynonyms.keys())
    for (const token of key.split(' ')) areaVocabulary.add(token);

  const knownWords = new Set<string>([
    ...areaVocabulary,
    ...STOP_WORDS,
    ...NOISE_WORDS,
    ...Object.keys(SHIFT_WORDS),
    ...EVENING_WORDS,
    ...SUBSTITUTE_WORDS,
    ...UNSUPPORTED_WORDS,
    ...DELETE_WORDS,
    ...VIEW_WORDS,
    ...HELP_WORDS,
    ...CREATE_WORDS,
  ]);

  const districtName = new Map(catalog.districts.map((d) => [d.key, d.name]));

  /** `words` are the user's own words (accents included) for the readable label. */
  function resolveArea(tokens: string[], words: string[], allowTypos = true): AreaOutcome {
    const key = tokens.join(' ');
    const label = sentenceCase(allowTypos ? words.join(' ') : key);

    const synonym = areaSynonyms.get(key);
    if (synonym) return { type: 'resolved', codes: synonym, label, exact: true };

    const exact = areasByKey.get(key);
    if (exact) return { type: 'resolved', codes: exact, label, exact: true };

    // Areas whose name contains the phrase, grouped by name (HTR and H.I are both "historia").
    const groups = new Map<string, { label: string; codes: string[]; offers: number }>();
    for (const area of catalog.areas) {
      if (!containsRun(area.tokens, tokens)) continue;
      const group = groups.get(area.key) ?? {
        label: sentenceCase(area.description),
        codes: [],
        offers: 0,
      };
      group.codes.push(area.code);
      group.offers += area.historicalOffers;
      groups.set(area.key, group);
    }
    if (groups.size === 1) {
      const only = [...groups.values()][0] as { label: string; codes: string[] };
      return { type: 'resolved', codes: only.codes, label: only.label, exact: false };
    }
    if (groups.size > 1) {
      const ranked = [...groups.values()].sort((a, b) => b.offers - a.offers);
      const options: QuestionOption[] = ranked.slice(0, MAX_OPTIONS).map((g) => ({
        label: g.label,
        patch: { areas: g.codes },
        areaLabels: [g.label],
      }));
      options.push({
        label: `Cualquiera que diga «${key}»`,
        patch: { areas: [key] },
        areaLabels: [label],
      });
      return { type: 'ambiguous', phrase: key, label, options };
    }

    if (allowTypos) {
      const fixed = tokens.map((token) => {
        if (areaVocabulary.has(token)) return token;
        const near = closest(token, areaVocabulary);
        return near.length === 1 ? (near[0] as string) : token;
      });
      if (fixed.join(' ') !== key) return resolveArea(fixed, words, false);
    }
    return { type: 'unrecognized', phrase: key };
  }

  /**
   * Resolves a run of leftover tokens into areas. Returns the outcomes plus the words that
   * had to be ignored (e.g. "avises" in "avises de matematica").
   */
  function resolveRun(
    run: string[],
    words: string[],
  ): { outcomes: AreaOutcome[]; ignored: string[] } {
    const whole = resolveArea(run, words);
    // A synonym or a whole area name wins ("lengua y literatura", "salud y adolescencia").
    if (whole.type !== 'unrecognized' && (whole.type === 'ambiguous' || whole.exact)) {
      return { outcomes: [whole], ignored: [] };
    }

    // "historia y geografia": two areas, as long as every piece makes sense on its own.
    if (run.some((t) => CONNECTORS.has(t))) {
      const pieces: { tokens: string[]; words: string[] }[] = [{ tokens: [], words: [] }];
      run.forEach((token, i) => {
        if (CONNECTORS.has(token)) pieces.push({ tokens: [], words: [] });
        else {
          const piece = pieces[pieces.length - 1] as { tokens: string[]; words: string[] };
          piece.tokens.push(token);
          piece.words.push(words[i] as string);
        }
      });
      const outcomes = pieces
        .filter((p) => p.tokens.length > 0)
        .map((p) => resolveArea(p.tokens, p.words));
      if (outcomes.length > 1 && outcomes.every((o) => o.type !== 'unrecognized')) {
        return { outcomes, ignored: [] };
      }
    }
    if (whole.type !== 'unrecognized') return { outcomes: [whole], ignored: [] };

    // Last resort: drop junk words at either end, keeping the longest part that resolves.
    let best: { outcome: AreaOutcome; from: number; to: number } | undefined;
    for (let from = 0; from < run.length; from++) {
      for (let to = run.length; to > from; to--) {
        if (from === 0 && to === run.length) continue;
        const inner = run.slice(from, to);
        if (
          STOP_WORDS.has(inner[0] as string) ||
          STOP_WORDS.has(inner[inner.length - 1] as string)
        ) {
          continue;
        }
        const outcome = resolveArea(inner, words.slice(from, to));
        if (outcome.type !== 'unrecognized' && (!best || to - from > best.to - best.from)) {
          best = { outcome, from, to };
        }
      }
    }
    if (!best) return { outcomes: [whole], ignored: [] };
    const ignored = [...words.slice(0, best.from), ...words.slice(best.to)].filter(
      (w) => !STOP_WORDS.has(keyOf(w)),
    );
    return { outcomes: [best.outcome], ignored };
  }

  function extract(
    tokens: string[],
    originals: string[],
    mode: 'create' | 'delete',
    /** False while answering a question: leftovers are then ignored instead of asked about. */
    askAboutUnknowns: boolean,
  ): Extraction {
    const used = tokens.map(() => false);
    const mark = (from: number, length: number): void => {
      for (let i = from; i < from + length; i++) used[i] = true;
    };
    const free = (from: number, length: number): boolean =>
      used.slice(from, from + length).every((u) => !u);

    const patch: ExtractedPatch = {
      districts: [],
      levels: [],
      areas: [],
      areaLabels: [],
      shifts: [],
      onlySubstitutes: false,
    };
    const issues: Issue[] = [];
    const notes: string[] = [];
    let recognized = false;

    const apply = (target: Target): void => {
      (target.kind === 'district' ? patch.districts : patch.levels).push(target.value);
      recognized = true;
    };

    // 1. Districts and levels: longest phrase first; exact match, then typo-tolerant.
    for (let length = Math.min(MAX_PHRASE_TOKENS, tokens.length); length >= 1; length--) {
      for (let i = 0; i + length <= tokens.length; i++) {
        if (!free(i, length)) continue;
        const window = tokens.slice(i, i + length);
        // "ciclo superior" is part of an area name, not the "superior" level.
        if (tokens[i - 1] === 'ciclo') continue;
        const key = window.join(' ');

        const exact = targets.get(key);
        if (exact) {
          exact.forEach(apply);
          mark(i, length);
          continue;
        }

        const edges = [window[0], window[length - 1]] as string[];
        const hasUnknown = window.some((t) => !knownWords.has(t) && !/\d/.test(t));
        if (!hasUnknown || edges.some((t) => STOP_WORDS.has(t) || NOISE_WORDS.has(t))) continue;
        // A single unknown word that is a typo of an area word is left for the area step.
        const near = closest(key, keysByTokenCount.get(length) ?? []);
        if (length === 1) {
          const nearArea = closest(key, areaVocabulary)[0];
          const nearTarget = near[0];
          if (
            nearArea !== undefined &&
            (nearTarget === undefined || levenshtein(key, nearArea) < levenshtein(key, nearTarget))
          ) {
            continue;
          }
        }
        const candidates = near.flatMap((k) => targets.get(k) ?? []);
        if (candidates.length === 1) {
          apply(candidates[0] as Target);
          mark(i, length);
        } else if (candidates.length > 1 && candidates.every((c) => c.kind === 'district')) {
          const options = candidates.slice(0, MAX_OPTIONS).map((c) => ({
            label: districtName.get(c.value) ?? sentenceCase(c.value),
            patch: { districts: [c.value] },
          }));
          issues.push({
            field: 'district',
            reason: 'ambiguous',
            text: `No estoy seguro de qué distrito es «${key}». ¿Cuál es?`,
            options,
          });
          recognized = true;
          mark(i, length);
        }
      }
    }

    // 2. Shifts, substitute flag, unsupported filters and noise words.
    tokens.forEach((token, i) => {
      if (used[i]) return;
      if (token in SHIFT_WORDS) {
        const shift = SHIFT_WORDS[token] as Shift;
        if (!patch.shifts.includes(shift)) patch.shifts.push(shift);
        recognized = true;
      } else if (EVENING_WORDS.has(token)) {
        issues.push({
          field: 'shift',
          reason: 'ambiguous',
          text: '«Vespertino» puede ser tarde o noche. ¿Cuál preferís?',
          options: [
            { label: 'Tarde', patch: { shifts: ['T'] } },
            { label: 'Noche', patch: { shifts: ['N'] } },
            { label: 'Tarde y noche', patch: { shifts: ['T', 'N'] } },
          ],
        });
        recognized = true;
      } else if (SUBSTITUTE_WORDS.has(token)) {
        patch.onlySubstitutes = true;
        recognized = true;
      } else if (UNSUPPORTED_WORDS.has(token)) {
        notes.push(
          `Todavía no puedo filtrar por «${token}»: te aviso de todas las ofertas que coincidan con el resto.`,
        );
      } else if (!(
        NOISE_WORDS.has(token) ||
        DELETE_WORDS.has(token) ||
        VIEW_WORDS.has(token) ||
        HELP_WORDS.has(token) ||
        CREATE_WORDS.has(token)
      )) {
        return;
      }
      used[i] = true;
    });

    // 3. Whatever is left, in runs, is the subject / position the teacher is after.
    let i = 0;
    while (i < tokens.length) {
      if (used[i]) {
        i++;
        continue;
      }
      let end = i;
      while (end < tokens.length && !used[end]) end++;
      const run = tokens.slice(i, end);
      const runWords = originals.slice(i, end);
      i = end;

      while (run.length > 0 && STOP_WORDS.has(run[0] as string)) {
        run.shift();
        runWords.shift();
      }
      while (run.length > 0 && STOP_WORDS.has(run[run.length - 1] as string)) {
        run.pop();
        runWords.pop();
      }
      if (run.length === 0) continue;

      const { outcomes, ignored } = resolveRun(run, runWords);
      if (ignored.length > 0 && mode === 'create') {
        notes.push(`No entendí «${ignored.join(' ')}» y lo ignoré.`);
      }
      for (const outcome of outcomes) {
        if (outcome.type === 'resolved') {
          patch.areas.push(...outcome.codes);
          patch.areaLabels.push(outcome.label);
          recognized = true;
        } else if (outcome.type === 'ambiguous') {
          recognized = true;
          if (mode === 'delete') {
            patch.areas.push(outcome.phrase);
            patch.areaLabels.push(outcome.label);
          } else {
            issues.push({
              field: 'area',
              reason: 'ambiguous',
              text: `«${outcome.phrase}» puede ser varias cosas. ¿Cuál buscás?`,
              options: outcome.options,
            });
          }
        } else if (mode === 'create' && askAboutUnknowns) {
          issues.push({
            field: 'area',
            reason: 'unrecognized',
            text: `No encontré «${outcome.phrase}» entre las materias o cargos. ¿Podés decirlo de otra forma?`,
            options: [],
          });
        }
      }
    }

    return { patch, issues, notes, recognized };
  }

  // ---- conversation state ---------------------------------------------------------------

  function merge(draft: Criteria, patch: CriteriaInput): Criteria {
    return createCriteria({
      districts: [...draft.districts, ...(patch.districts ?? [])],
      levels: [...draft.levels, ...(patch.levels ?? [])],
      areas: [...draft.areas, ...(patch.areas ?? [])],
      shifts: [...draft.shifts, ...(patch.shifts ?? [])],
      onlySubstitutes: draft.onlySubstitutes || patch.onlySubstitutes === true,
    });
  }

  const MISSING_DISTRICT: Issue = {
    field: 'district',
    reason: 'missing',
    text: '¿En qué distrito querés recibir los avisos? Podés escribirlo o mandarme un audio.',
    options: [],
  };
  const MISSING_TOPIC: Issue = {
    field: 'topic',
    reason: 'missing',
    text: '¿Qué materia, cargo o nivel buscás? Por ejemplo: «historia», «maestra de grado» o «primaria».',
    options: [],
  };

  const MISSING_SEARCH: Issue = {
    field: 'topic',
    reason: 'missing',
    text: '¿De qué querés ver ofertas? Decime una materia, un nivel o un distrito, por ejemplo «historia en Tandil».',
    options: [],
  };

  /** Asks the next pending question or, when nothing is left to settle, finishes. */
  function advance(state: DraftState): Interpretation {
    const [next, ...rest] = state.issues;
    if (next) {
      const question: Question = { ...next, kind: 'question', state: { ...state, issues: rest } };
      return question;
    }

    if (state.intent === 'delete') {
      return {
        kind: 'delete',
        filter: state.draft,
        summary: state.all
          ? 'Todas tus alertas'
          : describeCriteria(state.draft, catalog, state.areaLabels),
        all: state.all,
      };
    }

    if (state.intent === 'search') {
      const { districts, levels, areas } = state.draft;
      if (districts.length === 0 && levels.length === 0 && areas.length === 0) {
        return { ...MISSING_SEARCH, kind: 'question', state };
      }
      return {
        kind: 'search',
        criteria: state.draft,
        summary: describeCriteria(state.draft, catalog, state.areaLabels),
        notes: state.notes,
      };
    }

    const missing =
      state.draft.districts.length === 0
        ? MISSING_DISTRICT
        : state.draft.areas.length === 0 && state.draft.levels.length === 0
          ? MISSING_TOPIC
          : undefined;
    if (missing) return { ...missing, kind: 'question', state };

    return {
      kind: 'create',
      criteria: state.draft,
      summary: describeCriteria(state.draft, catalog, state.areaLabels),
      notes: state.notes,
    };
  }

  const hasPhrase = (tokens: string[], phrase: string): boolean =>
    containsRun(tokens, phrase.split(' '));

  /** "qué hay hoy en tandil", "mostrame ofertas de historia", "hay algo de inglés". */
  function wantsSearch(tokens: string[]): boolean {
    if (tokens.some((t) => ALERT_VERBS.has(t))) return false;
    return (
      SEARCH_PHRASES.some((phrase) => hasPhrase(tokens, phrase)) ||
      // "qué ofertas hay", "cuántas suplencias hay": the words are not next to each other.
      (tokens.includes('hay') && ['que', 'cuantas', 'cuantos'].some((t) => tokens.includes(t))) ||
      (tokens.some((t) => VIEW_WORDS.has(t)) && tokens.some((t) => OFFER_WORDS.has(t)))
    );
  }

  function interpret(text: string, previous?: DraftState): Interpretation {
    const tokens = tokenize(text);
    // The user's own words, aligned with the tokens, so labels keep their accents.
    const rawWords = text.match(/[\p{L}\p{N}]+/gu) ?? [];
    const originals = rawWords.length === tokens.length ? rawWords : tokens;
    if (tokens.length === 0) return previous ? advance(previous) : { kind: 'unknown' };

    if (!previous) {
      if (tokens.some((t) => DELETE_WORDS.has(t))) {
        // handled below as a delete intent
      } else if (wantsSearch(tokens)) {
        // handled below as a search intent
      } else if (
        tokens.some((t) => VIEW_WORDS.has(t)) ||
        (tokens.includes('mis') &&
          tokens.some((t) => ['alertas', 'avisos', 'busquedas'].includes(t))) ||
        hasPhrase(tokens, 'que alertas')
      ) {
        return { kind: 'view' };
      } else if (
        tokens.some((t) => HELP_WORDS.has(t)) ||
        HELP_PHRASES.some((phrase) => hasPhrase(tokens, phrase))
      ) {
        return { kind: 'help' };
      }
    }

    const intent =
      previous?.intent ??
      (tokens.some((t) => DELETE_WORDS.has(t))
        ? 'delete'
        : wantsSearch(tokens)
          ? 'search'
          : 'create');
    const extraction = extract(
      tokens,
      originals,
      intent === 'delete' ? 'delete' : 'create',
      previous === undefined,
    );

    if (!previous) {
      const asksToCreate = tokens.some((t) => CREATE_WORDS.has(t));
      if (!extraction.recognized && !asksToCreate && intent === 'create')
        return { kind: 'unknown' };
    }

    const base: DraftState = previous ?? {
      intent,
      draft: createCriteria({}),
      areaLabels: [],
      issues: [],
      notes: [],
      all: false,
    };
    return advance({
      intent: base.intent,
      draft: merge(base.draft, extraction.patch),
      areaLabels: [...new Set([...base.areaLabels, ...extraction.patch.areaLabels])],
      issues: [...base.issues, ...extraction.issues],
      notes: [...new Set([...base.notes, ...extraction.notes])],
      all: base.all || (base.intent === 'delete' && tokens.some((t) => ALL_WORDS.has(t))),
    });
  }

  function answer(question: Question, optionIndex: number): Interpretation {
    const option = question.options[optionIndex];
    if (!option)
      return advance({ ...question.state, issues: [question, ...question.state.issues] });
    const { state } = question;
    return advance({
      ...state,
      draft: merge(state.draft, option.patch),
      areaLabels: [...new Set([...state.areaLabels, ...(option.areaLabels ?? [])])],
    });
  }

  return { interpret, answer };
}

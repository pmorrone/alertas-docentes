import type { Criteria, createCriteria } from '../matcher/index.js';

/** Raw (not yet normalized) criteria, the input of `createCriteria`. */
export type CriteriaInput = Parameters<typeof createCriteria>[0];

export type QuestionField = 'district' | 'level' | 'area' | 'shift' | 'topic';

export interface QuestionOption {
  /** Text for the button (Spanish). */
  label: string;
  /** Criteria added to the draft when the user picks this option. */
  patch: CriteriaInput;
  /** Readable names for the areas in `patch`, used in the confirmation summary. */
  areaLabels?: string[];
}

/** Something the interpreter could not settle on its own. */
export interface Issue {
  field: QuestionField;
  reason: 'missing' | 'ambiguous' | 'unrecognized';
  /** The question to show the user (Spanish). */
  text: string;
  /** Buttons to offer. Empty when a free-text (or voice) answer is expected. */
  options: QuestionOption[];
}

/**
 * Everything needed to continue a half-finished interpretation. It is plain data, so the
 * bot can keep it in memory or serialize it between messages.
 */
export interface DraftState {
  intent: 'create' | 'delete';
  draft: Criteria;
  /** Readable names of the draft's areas ("Historia"), for the summary. */
  areaLabels: string[];
  /** Issues still to ask about, after the one currently being asked. */
  issues: Issue[];
  /** Things the user asked for that cannot be honored yet (Spanish). */
  notes: string[];
  /** Delete intent only: "borrá todas". */
  all: boolean;
}

export interface Question extends Issue {
  kind: 'question';
  state: DraftState;
}

export interface CreateIntent {
  kind: 'create';
  criteria: Criteria;
  /** Short description for the confirmation message, e.g. "Historia · Tandil · Mañana". */
  summary: string;
  notes: string[];
}

export interface DeleteIntent {
  kind: 'delete';
  /**
   * Describes which alert to delete ("la de geografía"). Empty when the user did not say:
   * the bot should then ask which one. Match it against saved alerts by overlap.
   */
  filter: Criteria;
  summary: string;
  /** "borrá todas mis alertas". */
  all: boolean;
}

export interface ViewIntent {
  kind: 'view';
}

export interface HelpIntent {
  kind: 'help';
}

/** Nothing recognizable: the bot should show the help message. */
export interface UnknownIntent {
  kind: 'unknown';
}

export type Interpretation =
  CreateIntent | DeleteIntent | ViewIntent | HelpIntent | UnknownIntent | Question;

export interface Interpreter {
  /**
   * Interprets a message. Pass the `state` of the last `Question` when the message is
   * the (free-text or voice) answer to it.
   */
  interpret(text: string, state?: DraftState): Interpretation;
  /** Applies the button the user tapped on a `Question`. */
  answer(question: Question, optionIndex: number): Interpretation;
}

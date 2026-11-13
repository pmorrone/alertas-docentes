export const SHIFTS = ['M', 'T', 'N'] as const;
export type Shift = (typeof SHIFTS)[number];

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * A published APD offer, normalized. Contains no personal data: the fields the API
 * exposes about the author, the replaced teacher or the winner are never mapped.
 */
export interface Offer {
  /** `iddetalle`: unique id of the offer, used for deduplication. */
  id: number;
  /** `idoferta`, shown on the website. */
  offerId: number | null;
  ige: number | null;
  /** Raw API status, e.g. "Publicada". */
  status: string;
  districtName: string;
  districtNumber: number | null;
  levelName: string;
  levelCode: string;
  /** `cargo`, e.g. "Maestro de Danza Primaria (MDP)". */
  position: string;
  areaDescription: string;
  positionDescription: string;
  /** `areaincumbencia`, uppercase code for exact matching, e.g. "MDP". */
  areaCode: string;
  /** Set of shift letters; "MT" becomes {M, T}. Empty when unknown. */
  shifts: ReadonlySet<Shift>;
  /** `supl_revista === "S"`. */
  isSubstitute: boolean;
  workday: string;
  modules: number | null;
  school: string;
  address: string;
  courseDivision: string;
  substituteFrom: Date | null;
  substituteTo: Date | null;
  takesOfficeAt: Date | null;
  publishedAt: Date;
  /** Closing time as an absolute instant (display in Argentina time). */
  closesAt: Date;
  /** Raw free-text schedule per weekday; days without schedule are omitted. */
  schedule: Partial<Record<Weekday, string>>;
  notes: string;
  /** Accent-free lowercase variants for comparing against user input. */
  normalized: {
    district: string;
    level: string;
    /** Position, area and position description, deduplicated and joined. */
    position: string;
  };
}

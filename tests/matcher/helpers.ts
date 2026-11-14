import { parseOffer, type Offer } from '../../src/collector/index.js';
import { makeDoc, type RawDoc } from '../collector/helpers.js';

/** Builds an Offer from the fixture doc with raw-field overrides (Solr field names). */
export function makeOffer(overrides: RawDoc = {}): Offer {
  const result = parseOffer(makeDoc(overrides));
  if (!result.ok) throw new Error(result.issues.join('; '));
  return result.offer;
}

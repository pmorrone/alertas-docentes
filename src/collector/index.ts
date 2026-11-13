export * from './offer.js';
export { parseOffer, type ParseOfferResult } from './schema.js';
export { normalizeText, cleanText } from './text.js';
export {
  SolrClient,
  SolrRequestError,
  buildSelectUrl,
  type CollectResult,
  type OfferFilters,
  type SolrClientOptions,
} from './solr-client.js';

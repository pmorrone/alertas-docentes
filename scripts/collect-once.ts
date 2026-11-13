import { parseArgs } from 'node:util';
import { SolrClient } from '../src/collector/index.js';

const { values } = parseArgs({
  options: {
    district: { type: 'string', multiple: true },
    level: { type: 'string', multiple: true },
  },
});

const filters = { districts: values.district ?? [], levels: values.level ?? [] };
const started = Date.now();
const { offers, numFound, skipped } = await new SolrClient().fetchPublishedOffers(filters);

console.log(`Filters: ${JSON.stringify(filters)}`);
console.log(`Solr numFound: ${numFound}`);
console.log(`Offers collected: ${offers.length} (skipped invalid: ${skipped})`);
console.log(`Substitute offers: ${offers.filter((o) => o.isSubstitute).length}`);
console.log(`Took ${Date.now() - started} ms`);

const sample = offers[0];
if (sample) {
  console.log(
    `Newest: #${sample.id} ${sample.position} | ${sample.districtName} | ${sample.levelName} | ` +
      `shifts ${[...sample.shifts].join('') || '-'} | ${sample.courseDivision}`,
  );
}

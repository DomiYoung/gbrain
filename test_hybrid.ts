import { BrainEngine } from './src/core/engine.ts';
import { hybridSearch } from './src/core/search/hybrid.ts';

const engine = await BrainEngine.connect();

console.log('Test 1: hybridSearch without sourceIds');
const result1 = await hybridSearch(engine, 'Lucky', { limit: 3 });
console.log(`  Found: ${result1.length} pages`);
result1.forEach(r => console.log(`    - ${r.slug} (${r.source_id})`));

console.log('\nTest 2: hybridSearch with sourceIds: ["__all__"]');
const result2 = await hybridSearch(engine, 'Lucky', { limit: 3, sourceIds: ['__all__'] });
console.log(`  Found: ${result2.length} pages`);
result2.forEach(r => console.log(`    - ${r.slug} (${r.source_id})`));

console.log('\nTest 3: hybridSearch with sourceId: "default"');
const result3 = await hybridSearch(engine, 'Lucky', { limit: 3, sourceId: 'default' });
console.log(`  Found: ${result3.length} pages`);
result3.forEach(r => console.log(`    - ${r.slug} (${r.source_id})`));

await engine.close();
process.exit(0);

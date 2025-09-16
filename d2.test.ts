import { encode } from './d2.ts';
import { readFileSync, writeFileSync } from 'node:fs';

const inputs = [
  'fixtures/baby-outputs-tree.json',
  'fixtures/outputs-tree.json',
  'fixtures/hof-prd-product-list-page-paths.arr.json',
  'fixtures/hof-prd-product-list-page-paths.obj.json',
];
let totalD2 = 0;
let totalJson = 0;
for (const input of inputs) {
  console.log(`\nProcessing ${input}...`);
  const doc = JSON.parse(readFileSync(input, 'utf-8'));
  const json = JSON.stringify(doc);

  // Find the best ratio by brute force trying different thresholds
  let bestConfig = null;
  let bestScore = Infinity;
  let bestRatio = Infinity;
  let bestLongestLine = Infinity;
  let bestDjson = '';
  for (const objectThreshold of [0, 1, 2, 3, 4]) {
    for (const arrayThreshold of [0, 1, 2, 3, 4]) {
      for (const stringThreshold of [0, 1, 2, 3, 4]) {
        const djson = encode(doc, {
          objectThreshold,
          arrayThreshold,
          stringThreshold,
        });
        const longestLine = djson
          .split('\n')
          .reduce((a, b) => Math.max(a, b.length), 0);
        const ratio = djson.length / json.length;
        const score = ratio * 100 + longestLine / 100;
        if (score < bestScore) {
          bestScore = score;
          bestRatio = ratio;
          bestLongestLine = longestLine;
          bestConfig = { objectThreshold, arrayThreshold, stringThreshold };
          bestDjson = djson;
          console.log(
            `  objectThreshold: ${bestConfig.objectThreshold}, arrayThreshold: ${bestConfig.arrayThreshold}, stringThreshold: ${bestConfig.stringThreshold}` +
              `\n  JSON: ${json.length} bytes, DJSON: ${bestDjson.length} bytes, ratio: ${(
                bestRatio * 100
              ).toFixed(
                2,
              )}%, longest line: ${bestLongestLine}, score: ${bestScore.toFixed(2)}`,
          );
        }
      }
    }
  }

  totalD2 += bestDjson.length;
  totalJson += json.length;
  writeFileSync(input.replace('.json', '.d2.jsonl'), bestDjson);
}
console.log(`Overall ratio: ${((totalD2 / totalJson) * 100).toFixed(2)}%`);

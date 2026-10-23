import { extract } from './source.mjs';

try {
  const result = await extract(process.argv.slice(2));
  console.log(result.names.join('\n'));
  console.error(`Excluded-composite (${result.composites.length}): ${result.composites.join(', ')}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

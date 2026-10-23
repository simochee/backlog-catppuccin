import { readFile } from 'node:fs/promises';
import { extract } from './source.mjs';

export function missingAssignments(names, source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const assigned = new Set([...withoutComments.matchAll(/(--[\w-]+)\s*:\s*[^;{}]+;/g)].map((match) => match[1]));
  return names.filter((name) => !assigned.has(name));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { names, composites, total } = await extract(process.argv.slice(2));
    const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
    const missing = missingAssignments(names, source);
    console.log(`Found ${total} color variables; ${names.length} assignable; ${missing.length} unassigned.`);
    console.log(`Excluded-composite (${composites.length}): ${composites.join(', ')}`);
    for (const name of missing) console.error(name);
    if (missing.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

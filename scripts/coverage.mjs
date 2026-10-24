import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { extract } from './source.mjs';

export function missingAssignments(names, source) {
  const withoutComments = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (token) => token.startsWith('/') ? ' ' : token);
  const assigned = new Set([...withoutComments.matchAll(/(--[\w-]+)\s*:\s*[^;{}]+;/g)].map((match) => match[1]));
  return names.filter((name) => !assigned.has(name));
}

export function coverageSets({ names, composites }) {
  return {
    legacy: names.filter((name) => !name.startsWith('--nuui-')),
    nu: [...new Set([...names, ...composites].filter((name) => name.startsWith('--nuui-')))].sort(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const extracted = await extract(process.argv.slice(2));
    const sets = coverageSets(extracted);
    for (const [label, file, names] of [
      ['Legacy', 'catppuccin.user.less', sets.legacy],
      ['New design add-on', 'catppuccin-nu.user.less', sets.nu],
    ]) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      const missing = missingAssignments(names, source);
      console.log(`${label}: ${names.length} assignable; ${missing.length} unassigned.`);
      for (const name of missing) console.error(name);
      if (missing.length) process.exitCode = 1;
    }
    console.log(`Excluded legacy composites: ${extracted.composites.filter((name) => !name.startsWith('--nuui-')).join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

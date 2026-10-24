import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { download, loadStylesheets, inspectCSS, discoveredColorNames } from './source.mjs';
import { compile, libraryURL, checkNuTokenTypes } from './compile.mjs';
import postcss from 'postcss';

export function missingAssignments(names, source) {
  const withoutComments = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (token) => token.startsWith('/') ? ' ' : token);
  const assigned = new Set([...withoutComments.matchAll(/(--[\w-]+)\s*:\s*[^;{}]+;/g)].map((match) => match[1]));
  return names.filter((name) => !assigned.has(name));
}

export function discoverCoverage(stylesheets) {
  if (!stylesheets.some(({ url }) => new URL(url).pathname.includes('/styles_nu-ui/'))) throw new Error('No styles_nu-ui/ bundles discovered for coverage and type parity');
  const discovered = inspectCSS(stylesheets.map(({ css }) => css).join('\n'));
  discoveredColorNames(discovered, { requireNu: true });
  return discovered;
}

export function coverageSets({ names, composites }) {
  return {
    legacy: names.filter((name) => !name.startsWith('--nuui-')),
    nu: [...new Set([...names, ...composites].filter((name) => name.startsWith('--nuui-')))].sort(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const discovered = discoverCoverage(await loadStylesheets(process.argv.slice(2)));
    const extracted = { ...discovered, names: discoveredColorNames(discovered, { requireNu: true }) };
    const sets = coverageSets(extracted);
    for (const [label, file, names] of [
      ['Legacy', 'catppuccin.user.less', sets.legacy],
      ['New design', 'catppuccin.user.less', sets.nu],
    ]) {
      const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
      const missing = missingAssignments(names, source);
      console.log(`${label}: ${names.length} assignable; ${missing.length} unassigned.`);
      for (const name of missing) console.error(name);
      if (missing.length) process.exitCode = 1;
    }
    const addon = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
    const library = await download(libraryURL);
    for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
      console.log(`${flavor}: ${checkNuTokenTypes(postcss.parse((await compile(flavor, addon, library)).css), discovered)}`);
    }
    if (!process.exitCode) console.log('Live coverage and type parity: PASS');
    console.log(`Excluded legacy composites: ${extracted.composites.filter((name) => !name.startsWith('--nuui-')).join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

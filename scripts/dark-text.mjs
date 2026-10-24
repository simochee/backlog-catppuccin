import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import postcss from 'postcss';
import { loadStylesheets } from './source.mjs';

export const blockStart = '    // BEGIN GENERATED DARK TEXT (npm run generate:dark-text)';
export const blockEnd = '    // END GENERATED DARK TEXT';
const baseColor = /^var\(\s*--backgroundColorSchemeBase\s*\)$/;
const primaryColor = /^var\(\s*--textColorPrimary\s*\)$/;
const accentColor = /^var\(\s*--(?:defaultColor(?:Main|Accent)|statusColor-[\w-]+|commonColor[\w-]+|[\w-]+ScaleAccent|[\w-]+ActionColor|brandColor[\w-]+)\s*\)$/;

export function findDarkText(stylesheets) {
  const records = new Map();
  for (const css of stylesheets) {
    postcss.parse(css, { from: undefined, map: false }).walkRules((rule) => {
      const context = [];
      for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
        if (parent.type !== 'atrule') return; // Nested selectors need expansion first.
        context.unshift([parent.name, parent.params]);
      }
      for (const original of postcss.list.comma(rule.selector)) {
        const dark = /^\.dark-mode\s+/.test(original);
        const selector = dark ? original.replace(/^\.dark-mode\s+/, '') : original;
        if (selector.includes('.dark-mode')) continue;
        const key = JSON.stringify([context, selector]);
        const record = records.get(key) || { selector };
        for (const decl of rule.nodes) {
          if (decl.type !== 'decl') continue;
          const value = decl.value.trim();
          if (decl.prop === 'color' && !dark && baseColor.test(value)) record.lightBase = true;
          if (decl.prop === 'color' && dark && primaryColor.test(value)) record.darkPrimary = true;
          if (decl.prop === 'color' && !dark) record.scaleText ||= value.match(/^var\(\s*(--[\w-]+)ScaleText\s*\)$/)?.[1];
          if (decl.prop === 'background-color' && accentColor.test(value)) {
            record.accent = true;
            record.scaleAccent ||= value.match(/^var\(\s*(--[\w-]+)ScaleAccent\s*\)$/)?.[1];
          }
        }
        records.set(key, record);
      }
    });
  }
  const a = new Set();
  const b = new Set();
  for (const { selector, lightBase, darkPrimary, accent } of records.values()) {
    if (lightBase && darkPrimary) a.add(selector);
    else if (darkPrimary && accent) b.add(selector);
  }
  // Titles explicitly reset their text color while sharing the card's surface.
  // Require an exact parent selector and matching scale tokens, not any ancestor.
  for (const [key, record] of records) {
    if (!record.darkPrimary || !record.scaleText || !record.selector.endsWith(' .title')) continue;
    const [context] = JSON.parse(key);
    const parentSelector = record.selector.slice(0, -' .title'.length);
    const parent = records.get(JSON.stringify([context, parentSelector]));
    if (parent?.darkPrimary && parent.accent && !parent.lightBase && parent.scaleAccent === record.scaleText) b.add(record.selector);
  }
  return { a: [...a].sort(), b: [...b].filter((selector) => !a.has(selector)).sort() };
}

export function renderDarkText({ a, b }) {
  const selectors = [...new Set([...a, ...b])].sort();
  if (!selectors.length) throw new Error('No dark-text selectors discovered');
  return `${blockStart}\n${selectors.map((selector, index) => `    ${selector}${index === selectors.length - 1 ? ' {' : ','}`).join('\n')}\n      color: var(--backgroundColorSchemeBase) !important;\n    }\n${blockEnd}`;
}

export function replaceDarkText(source, block) {
  const start = source.indexOf(blockStart);
  const end = source.indexOf(blockEnd, start);
  if (start < 0 || end < 0 || source.indexOf(blockStart, start + 1) >= 0 || source.indexOf(blockEnd, end + 1) >= 0) {
    throw new Error('Expected exactly one delimited dark-text block');
  }
  return source.slice(0, start) + block + source.slice(end + blockEnd.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const check = process.argv.includes('--check');
    const extras = process.argv.slice(2).filter((arg) => arg !== '--check');
    const stylesheets = await loadStylesheets(extras);
    const result = findDarkText(stylesheets.map(({ css }) => css));
    for (const pattern of ['a', 'b']) console.log(`Pattern ${pattern.toUpperCase()} (${result[pattern].length}):\n${result[pattern].join('\n')}`);
    const file = new URL('../catppuccin.user.less', import.meta.url);
    const source = await readFile(file, 'utf8');
    const updated = replaceDarkText(source, renderDarkText(result));
    if (check && source !== updated) throw new Error('Dark-text block is out of date; run npm run generate:dark-text with the same extra URLs');
    if (!check) await writeFile(file, updated);
    console.log(check ? 'Dark-text block: up to date' : 'Dark-text block: generated');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { pathToFileURL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { selectorSpecificity, compare } from '@csstools/selector-specificity';
import { loadStylesheets } from './source.mjs';

export const blockStart = '    // BEGIN GENERATED DARK TEXT (npm run generate:dark-text)';
export const blockEnd = '    // END GENERATED DARK TEXT';
const baseColor = /^var\(\s*--backgroundColorSchemeBase\s*\)$/;
const primaryColor = /^var\(\s*--textColorPrimary\s*\)$/;
const accentColor = /^var\(\s*--(?:defaultColor(?:Main|Accent)|statusColor-[\w-]+|commonColor[\w-]+|[\w-]+ScaleAccent|[\w-]+ActionColor|brandColor[\w-]+)\s*\)$/;

function normalizeSelector(selector) {
  try {
    return selectorParser().processSync(selector, { lossless: false });
  } catch {
    // Unsupported syntax must not make the advisory conflict report fatal.
    return selector;
  }
}

export function findDarkText(stylesheets) {
  const records = new Map();
  const nonDarkColors = new Set();
  for (const css of stylesheets) {
    postcss.parse(css, { from: undefined, map: false }).walkRules((rule) => {
      const context = [];
      for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
        if (parent.type !== 'atrule') return; // Nested selectors need expansion first.
        context.unshift([parent.name, parent.params]);
      }
      for (const input of postcss.list.comma(rule.selector)) {
        const original = normalizeSelector(input);
        const dark = /^\.dark-mode\s+/.test(original);
        const selector = dark ? original.replace(/^\.dark-mode\s+/, '') : original;
        if (selector.includes('.dark-mode')) continue;
        const key = JSON.stringify([context, selector]);
        const record = records.get(key) || { selector, context, darkRules: new Map() };
        for (const decl of rule.nodes) {
          if (decl.type !== 'decl') continue;
          const value = decl.value.trim();
          if (decl.prop === 'color' && !dark && baseColor.test(value)) record.lightBase = true;
          if (decl.prop === 'color' && dark && primaryColor.test(value)) {
            record.darkPrimary = true;
            record.darkRules.set(original, Boolean(decl.important) || record.darkRules.get(original) || false);
          }
          if (decl.prop === 'color' && !dark) nonDarkColors.add(original);
          if (decl.prop === 'color' && !dark) record.scaleText ||= value.match(/^var\(\s*(--[\w-]+)ScaleText\s*\)$/)?.[1];
          if ((decl.prop === 'background-color' && accentColor.test(value)) ||
              (decl.prop === 'background' && [...value.matchAll(/var\([^()]*\)/g)].some(([reference]) => accentColor.test(reference)))) {
            record.accent = true;
            record.scaleAccent ||= value.match(/var\(\s*(--[\w-]+)ScaleAccent\s*\)/)?.[1];
          }
        }
        records.set(key, record);
      }
    });
  }
  const a = new Set();
  const b = new Set();
  for (const [key, { lightBase, darkPrimary, accent }] of records) {
    if (lightBase && darkPrimary) a.add(key);
    else if (darkPrimary && accent) b.add(key);
  }
  // Titles explicitly reset their text color while sharing the card's surface.
  // Require an exact parent selector and matching scale tokens, not any ancestor.
  for (const [key, record] of records) {
    if (!record.darkPrimary || !record.scaleText || !record.selector.endsWith(' .title')) continue;
    const [context] = JSON.parse(key);
    const parentSelector = record.selector.slice(0, -' .title'.length);
    const parent = records.get(JSON.stringify([context, parentSelector]));
    if (parent?.darkPrimary && parent.accent && !parent.lightBase && parent.scaleAccent === record.scaleText) b.add(key);
  }
  const overrides = [...records]
    .filter(([key]) => a.has(key) || b.has(key))
    .flatMap(([, { context, darkRules }]) => [...darkRules].map(([selector, important]) => ({ selector, important, context })))
    .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
  const metadata = new Map();
  const inspect = (selector) => {
    if (!metadata.has(selector)) {
      try {
        const ast = selectorParser().astSync(selector);
        const blocks = new Set();
        // Conservative BEM overlap includes descendants; state/modifier classes
        // alone do not identify a component block.
        ast.walkClasses(({ value }) => {
          if (!/^(?:-|is_|has_)/.test(value) && value !== 'dark-mode') blocks.add(value.split(/__|--/)[0]);
        });
        metadata.set(selector, { blocks, blockList: [...blocks], specificity: selectorSpecificity(ast) });
      } catch (error) {
        console.error(`Warning: skipped selector in conflict report: ${selector}: ${error.message}`);
        metadata.set(selector, null);
      }
    }
    return metadata.get(selector);
  };
  const candidates = [...nonDarkColors].sort().map((selector) => ({ selector, inspection: inspect(selector) }))
    .filter(({ inspection }) => inspection);
  const generatedSelectors = overrides.map(({ selector }) => ({ selector, inspection: inspect(selector) }))
    .filter(({ inspection }) => inspection);
  const conflicts = [];
  for (const { selector, inspection: generated } of generatedSelectors) {
    for (const { selector: candidate, inspection: other } of candidates) {
      if (compare(other.specificity, generated.specificity) >= 0 &&
          other.blockList.some((block) => generated.blocks.has(block))) {
        conflicts.push({ generated: selector, selector: candidate });
      }
    }
  }
  const selectors = (keys) => [...new Set([...keys].map((key) => records.get(key).selector))].sort();
  const aSelectors = selectors(a);
  return { a: aSelectors, b: selectors(b).filter((selector) => !aSelectors.includes(selector)), overrides, conflicts };
}

export function renderDarkText({ overrides }) {
  if (!overrides.length) throw new Error('No dark-text selectors discovered');
  const groups = new Map();
  for (const { selector, important, context } of overrides) {
    const key = JSON.stringify([context, important]);
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(selector);
  }
  const rules = [...groups].map(([key, selectors]) => {
    const [context, important] = JSON.parse(key);
    let rule = `${[...selectors].sort().map((selector) => `    ${selector}`).join(',\n')} {\n      color: var(--backgroundColorSchemeBase)${important ? ' !important' : ''};\n    }`;
    for (const [name, params] of [...context].reverse()) rule = `    @${name} ${params} {\n${rule}\n    }`;
    return rule;
  });
  return `${blockStart}\n${rules.join('\n')}\n${blockEnd}`;
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
    console.log(`Potential non-dark color conflicts (${result.conflicts.length}; review only):`);
    for (const conflict of result.conflicts) console.log(`${conflict.generated} <- ${conflict.selector}`);
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

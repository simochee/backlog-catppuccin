import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';
import colorNames from 'color-name';
import { loadStylesheets, download } from './source.mjs';
import { compile } from './compile.mjs';

const properties = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?))?-color|outline-color|fill|stroke)$/i;
const vendor = /(?:tooltipster|introjs|photoswipe|smartbanner|prettify)/i;
const normalize = (selector) => selectorParser().processSync(selector, { lossless: false });

function context(rule) {
  const result = [];
  for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
    if (parent.type !== 'atrule') return null;
    if (parent.name !== '-moz-document') result.unshift(`${parent.name} ${parent.params}`);
  }
  return result;
}

function literalKind(value) {
  let literal = false;
  let gradient = false;
  valueParser(value).walk((node) => {
    if (node.type === 'function') {
      if (/^url$/i.test(node.value)) return false;
      if (/gradient$/i.test(node.value)) gradient = true;
      if (/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i.test(node.value) &&
          !/\bvar\(/i.test(valueParser.stringify(node))) literal = true;
    }
    if (node.type === 'word' && (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(node.value) ||
        Object.hasOwn(colorNames, node.value.toLowerCase()) || /^transparent$/i.test(node.value))) literal = true;
  });
  return literal ? (gradient ? 'gradient' : 'solid') : null;
}

function overrideIndex(css) {
  const overrides = [];
  postcss.parse(css, { from: undefined, map: false }).walkRules((rule) => {
    const conditions = context(rule);
    if (!conditions) return;
    for (let selector of postcss.list.comma(rule.selector)) {
      selector = selector.replace(/^:root(?::root){4}(\.dark-mode)?\s+/, (_, dark) => dark ? '.dark-mode ' : '');
      for (const decl of rule.nodes) {
        if (decl.type !== 'decl' || !properties.test(decl.prop)) continue;
        overrides.push({ selector: normalize(selector), property: decl.prop, important: Boolean(decl.important), conditions });
      }
    }
  });
  return overrides;
}

function coversProperty(override, property) {
  return override === property || (override === 'background' && /^background-/.test(property)) ||
    (override === 'border-color' && /^border-(?:top|right|bottom|left)-color$/.test(property));
}

export function findLiterals(stylesheets, overrideCSS = '') {
  const overrides = overrideIndex(overrideCSS);
  const output = [];
  for (const { url, css } of stylesheets) {
    if (vendor.test(new URL(url).pathname)) continue;
    const groups = new Map();
    postcss.parse(css, { from: undefined, map: false }).walkRules((rule) => {
      const conditions = context(rule);
      if (!conditions) return;
      for (const input of postcss.list.comma(rule.selector)) {
        const selector = normalize(input);
        for (const decl of rule.nodes) {
          if (decl.type !== 'decl' || !properties.test(decl.prop)) continue;
          const kind = literalKind(decl.value);
          if (!kind) continue;
          if (overrides.some((override) => (override.selector === selector ||
              (!override.selector.startsWith('.dark-mode ') && selector === `.dark-mode ${override.selector}`)) &&
              coversProperty(override.property, decl.prop) && (!decl.important || override.important) &&
              override.conditions.every((condition, index) => conditions[index] === condition))) continue;
          if (!groups.has(selector)) groups.set(selector, new Map());
          groups.get(selector).set(`${decl.prop}:${kind}`, { property: decl.prop, kind });
        }
      }
    });
    if (groups.size) output.push({ stylesheet: new URL(url).pathname, selectors: [...groups].sort(([a], [b]) => a.localeCompare(b))
      .map(([selector, declarations]) => ({ selector, declarations: [...declarations.values()] })) });
  }
  return output;
}

export function rankSelectors(report, limit = 30) {
  const blocks = new Map();
  const records = report.flatMap(({ selectors }) => selectors.map(({ selector }) => {
    let block = selector;
    selectorParser((root) => root.walkClasses(({ value }) => {
      if (!/^(?:-|is[_-]|has[_-]|Page--)/.test(value) && value !== 'dark-mode') block = value.split(/__|--/)[0];
    })).processSync(selector);
    blocks.set(block, (blocks.get(block) || 0) + 1);
    return { selector, block };
  }));
  return [...new Map(records.map((record) => [record.selector, { ...record, count: blocks.get(record.block) }])).values()]
    .sort((a, b) => b.count - a.count || a.selector.localeCompare(b.selector)).slice(0, limit);
}

export function renderLiterals(report) {
  const lines = [];
  let selectors = 0;
  let declarations = 0;
  for (const group of report) {
    lines.push(`Stylesheet: ${group.stylesheet}`);
    for (const entry of group.selectors) {
      selectors++;
      lines.push(`  ${entry.selector}`);
      for (const { property, kind } of entry.declarations) {
        declarations++;
        lines.push(`    ${property}: ${kind}`);
      }
    }
  }
  lines.push(`Summary: ${report.length} stylesheets; ${selectors} selector groups; ${declarations} property/kind entries.`);
  lines.push('Top 30 selectors by component block frequency (selector groups across stylesheets):');
  for (const { selector, block, count } of rankSelectors(report)) lines.push(`  ${count}\t${block}\t${selector}`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const stylesheets = await loadStylesheets(process.argv.slice(2));
    const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
    const library = await download('https://userstyles.catppuccin.com/lib/std/v1.less');
    const { css } = await compile('latte', source, library, 'mocha');
    console.log(renderLiterals(findLiterals(stylesheets, css)));
  } catch {
    console.error('Literal report failed; check stylesheet availability and userstyle syntax.');
    process.exitCode = 1;
  }
}

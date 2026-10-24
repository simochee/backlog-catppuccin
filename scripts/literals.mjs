import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import valueParser from 'postcss-value-parser';
import colorNames from 'color-name';
import { loadStylesheets, download } from './source.mjs';
import { compile, libraryURL } from './compile.mjs';

const properties = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block(?:-start|-end)?|inline(?:-start|-end)?))?(?:-color)?|outline(?:-color)?|(?:box|text)-shadow|text-decoration(?:-color)?|caret-color|accent-color|column-rule(?:-color)?|fill|stroke)$/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const conditionalRules = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style', 'document', '-moz-document']);
const vendor = /(?:tooltipster|introjs|photoswipe|smartbanner|prettify)/i;
const normalize = (selector) => selectorParser().processSync(selector, { lossless: false });

function context(rule) {
  const result = [];
  for (let parent = rule.parent; parent?.type !== 'root'; parent = parent.parent) {
    if (parent.type !== 'atrule' || !conditionalRules.has(parent.name.toLowerCase())) return null;
    if (parent.name !== '-moz-document') result.unshift(`${parent.name} ${parent.params}`);
  }
  return result;
}

function literalKind(value, property) {
  let literal = false;
  let gradient = false;
  valueParser(value).walk((node) => {
    if (node.type === 'function') {
      if (/^url$/i.test(node.value)) return false;
      if (/gradient$/i.test(node.value)) gradient = true;
      if (/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i.test(node.value) &&
          !/\bvar\(/i.test(valueParser.stringify(node.nodes).split('/')[0].split(',').slice(0, 3).join(','))) literal = true;
    }
    if (node.type === 'word' && (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(node.value) ||
        Object.hasOwn(colorNames, node.value.toLowerCase()) || /^transparent$/i.test(node.value))) literal = true;
  });
  return literal ? (/^(?:box|text)-shadow$/i.test(property) ? 'shadow' : gradient ? 'gradient' : 'solid') : null;
}

function overrideIndex(css) {
  const overrides = new Map();
  postcss.parse(css, { from: undefined, map: false }).walkRules((rule) => {
    const conditions = context(rule);
    if (!conditions) return;
    for (let selector of postcss.list.comma(rule.selector)) {
      selector = selector.replace(/^:root(?::root){4}(\.dark-mode)?\s+/, (_, dark) => dark ? '.dark-mode ' : '');
      const key = normalize(selector);
      for (const decl of rule.nodes) {
        if (decl.type !== 'decl' || !properties.test(decl.prop)) continue;
        if (!overrides.has(key)) overrides.set(key, []);
        overrides.get(key).push({ property: decl.prop, important: Boolean(decl.important), conditions });
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
        const candidates = [...(overrides.get(selector) || []),
          ...(selector.startsWith('.dark-mode ') ? overrides.get(selector.slice(11)) || [] : [])];
        for (const decl of rule.nodes) {
          if (decl.type !== 'decl' || !properties.test(decl.prop)) continue;
          const kind = literalKind(decl.value, decl.prop);
          if (!kind) continue;
          if (candidates.some((override) =>
              coversProperty(override.property, decl.prop) && (!decl.important || override.important) &&
              override.conditions.every((condition, index) => conditions[index] === condition))) continue;
          if (!groups.has(selector)) groups.set(selector, new Map());
          groups.get(selector).set(`${decl.prop}:${kind}`, { property: decl.prop, kind });
        }
      }
    });
    if (groups.size) output.push({ stylesheet: new URL(url).pathname, selectors: [...groups].sort(([a], [b]) => compare(a, b))
      .map(([selector, declarations]) => ({ selector, declarations: [...declarations.values()] })) });
  }
  return output;
}

export function rankSelectors(report, limit = 30) {
  const blocks = new Map();
  const records = report.flatMap(({ selectors }) => selectors.map(({ selector }) => {
    let block = selector;
    const subject = selectorParser().astSync(selector).first;
    const nodes = subject.nodes;
    const start = nodes.findLastIndex((node) => node.type === 'combinator') + 1;
    for (const node of nodes.slice(start)) {
      if (node.type === 'class' && !/^(?:-|is[_-]|has[_-]|Page--)/.test(node.value) && node.value !== 'dark-mode') {
        block = node.value.split(/__|--/)[0];
      }
    }
    blocks.set(block, (blocks.get(block) || 0) + 1);
    return { selector, block };
  }));
  return [...new Map(records.map((record) => [record.selector, { ...record, count: blocks.get(record.block) }])).values()]
    .sort((a, b) => b.count - a.count || compare(a.selector, b.selector)).slice(0, limit);
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
  let stage = 'load stylesheets';
  try {
    const stylesheets = await loadStylesheets(process.argv.slice(2));
    stage = 'read userstyle';
    const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
    stage = 'download library';
    const library = await download(libraryURL);
    stage = 'compile userstyle';
    const { css } = await compile('latte', source, library, 'mocha');
    stage = 'analyze literals';
    console.log(renderLiterals(findLiterals(stylesheets, css)));
  } catch (error) {
    console.error(`Literal report failed (${stage}): ${error.message}`);
    process.exitCode = 1;
  }
}

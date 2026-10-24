import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import less from 'less';
import postcss from 'postcss';
import { download } from './source.mjs';
import expectedOrder from '../test/fixtures/neutral-order.json' with { type: 'json' };

const libraryURL = 'https://userstyles.catppuccin.com/lib/std/v1.less';
const isRGB = (name) => /-rgb$/.test(name) || name === '--rgb-accent';
export async function compile(flavor, source, library, darkFlavor = flavor, accentColor = 'mauve') {
  const importLine = `@import "${libraryURL}";`;
  if (!source.includes(importLine)) throw new Error('Catppuccin library @import line not found');
  const local = source.replace(importLine, () => library);
  return less.render(local, {
    javascriptEnabled: false,
    globalVars: { lightFlavor: flavor, darkFlavor, accentColor },
  });
}

export function parseColor(value, property) {
  const input = value?.trim() || '';
  const hex = input.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3');
  if (/^#[\da-f]{6}$/i.test(hex)) {
    return hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
  }
  const functional = input.match(/^(rgb|rgba)\(([^)]+)\)$/i);
  if (functional) {
    const parts = functional[2].split(',').map((part) => part.trim());
    if (parts.length === (functional[1].toLowerCase() === 'rgba' ? 4 : 3) &&
        parts.every((part) => /^(?:\d*\.)?\d+$/.test(part))) {
      const channels = parts.slice(0, 3).map(Number);
      if (channels.every((channel) => channel >= 0 && channel <= 255) &&
          (parts.length === 3 || Number(parts[3]) <= 1)) return channels;
    }
  }
  throw new Error(`Invalid color: ${property} (${value})`);
}

export function checkRGBCounterpart(decl) {
  if (!isRGB(decl.prop)) return;
  if (!/^\d+,\s*\d+,\s*\d+$/.test(decl.value)) {
    throw new Error(`Invalid RGB triplet: ${decl.prop}`);
  }
  const colorName = decl.prop === '--rgb-accent' ? '--defaultColorAccent' : decl.prop.slice(0, -4);
  const counterpart = decl.parent.nodes.find((node) => node.prop === colorName);
  const channels = parseColor(counterpart?.value, colorName);
  if (channels.some((channel, index) => channel !== Number(decl.value.split(',')[index]))) {
    throw new Error(`RGB triplet differs from color: ${decl.prop} / ${colorName}`);
  }
}

export function checkNeutralOrder(css, flavor) {
  const spec = expectedOrder[flavor === 'latte' ? 'latte' : 'dark'];
  const names = spec.order.flat();
  let checked = 0;
  css.walkRules((rule) => {
    const values = new Map(rule.nodes.filter((node) => node.type === 'decl')
      .map((decl) => [decl.prop, decl.value]));
    if (!values.has('--backgroundColorSchemeBase')) return;
    const levels = new Map(names.map((name) => {
      const channels = parseColor(values.get(name), name);
      return [name, (Math.max(...channels) + Math.min(...channels)) / 510];
    }));
    const ordered = spec.direction === 'descending' ? names : names.toReversed();
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (levels.get(current) > levels.get(previous)) {
        throw new Error(`${flavor} neutral order: ${previous} / ${current} (${rule.selector})`);
      }
    }
    for (const [left, right] of spec.distinct) {
      const a = parseColor(values.get(left), left);
      const b = parseColor(values.get(right), right);
      if (a.every((channel, index) => channel === b[index])) {
        throw new Error(`${flavor} states must differ: ${left} / ${right} (${rule.selector})`);
      }
    }
    checked++;
  });
  if (!checked) throw new Error(`Missing neutral background: --backgroundColorSchemeBase (${flavor})`);
  return `${flavor} neutral ordering: PASS (${spec.direction}, ${checked} rules)`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
    const library = await download(libraryURL);
    for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
      const result = await compile(flavor, source, library);
      const css = postcss.parse(result.css, { from: undefined, map: false });
      let count = 0;
      css.walkDecls(/^--/, (decl) => {
        count++;
        checkRGBCounterpart(decl);
      });
      if (!count) throw new Error('Compiled output has no assignments');
      const ordering = checkNeutralOrder(css, flavor);
      checkOverrides(css);
      console.log(`${flavor}: PASS (${count} custom-property assignments)`);
      console.log(ordering);
    }
    const mixed = postcss.parse((await compile('latte', source, library, 'mocha', 'green')).css, { from: undefined, map: false });
    const palettes = {};
    mixed.walkDecls('--backgroundColorBase', (decl) => {
      if (decl.parent.selector.includes('body')) return;
      palettes[decl.parent.selector.includes('.dark-mode') ? 'dark' : 'light'] = decl.value;
    });
    if (!palettes.light || !palettes.dark || palettes.light === palettes.dark) throw new Error('Flavor switching failed');
    checkOverrides(mixed);
    console.log('Independent light/dark switching and scoped color overrides: PASS');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export function checkOverrides(css) {
  css.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) return;
    const selectors = postcss.list.comma(decl.parent.selector);
    const darkText = decl.prop === 'color' &&
      selectors.every((selector) => selector.startsWith('.dark-mode '));
    const subtask = decl.prop === 'color' && !decl.important &&
      decl.parent.selector === '.dark-mode .pill--square.-subtasking' && decl.value === 'var(--textColorWeak)';
    const board = decl.prop === 'background-color' &&
      selectors.length === 1 && selectors[0] === ':root:not(.dark-mode) body.Page--view-kanban .card';
    const flavoredScope = /^:root(?::root){4}(?:\.dark-mode)?(?: body)? /;
    const cta = decl.prop === 'background-image' && selectors.every((selector) =>
      flavoredScope.test(selector) && selector.replace(flavoredScope, '') === '.upgrade-bar.generic-cta-bar') &&
      /^linear-gradient\(45deg, #[\da-f]+, #[\da-f]+\)$/.test(decl.value);
    const choice = decl.prop === 'border-color' && selectors.every((selector) =>
      flavoredScope.test(selector) && selector.replace(flavoredScope, '') === '.na-choice-box.is_active') &&
      /^#[\da-f]+$/.test(decl.value);
    if (!cta && !choice && !subtask && (decl.value !== 'var(--backgroundColorSchemeBase)' || !(darkText || board))) {
      throw new Error(`Unexpected color override: ${decl.parent.selector} / ${decl.prop}`);
    }
  });
}

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import less from 'less';
import postcss from 'postcss';
import { download } from './source.mjs';
import expectedOrder from '../test/fixtures/neutral-order.json' with { type: 'json' };

export const libraryURL = 'https://userstyles.catppuccin.com/lib/std/v1.less';
const isRGB = (name) => /-rgb$/.test(name) || name === '--rgb-accent';
const sidebarProperties = new Map([
  ['.project-nav__back', ['background-color']],
  ['.project-nav-list__link', ['color']],
  ['.project-nav-list__icon.icon', ['color', 'fill']],
  ['.project-nav-list__text', ['color']],
  ['.project-nav-list__link:is(.is_active, :hover, :focus)', ['color', 'background-color']],
  ['.project-nav-list__link:is(.is_active, :hover, :focus) .project-nav-list__text', ['color']],
  ['.project-nav-list__link#navi-document .project-nav-list__beta', ['color', 'outline-color', 'background-color']],
  ['.project-nav-list__link#navi-document:is(.is_active, :hover, :focus) .project-nav-list__beta', ['color', 'outline-color', 'background-color']],
  ['.project-nav-ai-pr', ['color', 'background-color']],
  ['.project-nav-ai-pr__open-new-tab-icon.icon', ['color']],
  ['.project-nav-ai-pr__icon.icon', ['fill']],
  ['.project-nav-ai-pr:is(:hover, :focus)', ['color', 'background']],
  ['.project-nav-ai-pr:is(:hover, :focus) .project-nav-ai-pr__icon.icon', ['background-color']],
  ['.trigger-icon .trigger-icon__inner .trigger-icon__line', ['background-color']],
  ['.trigger-icon .trigger-icon__inner::before', ['background-color']],
  ['.trigger-icon .trigger-icon__inner::after', ['background-color']],
]);

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

const flavoredScope = ':root(?::root){4}(?:\\.dark-mode)?(?: body)? ';
const channel = '[+-]?(?:\\d*\\.)?\\d+%?';
const color = `(?:#(?:[\\da-f]{3}|[\\da-f]{4}|[\\da-f]{6}|[\\da-f]{8})|(?:rgb|rgba|hsl|hsla)\\(\\s*${channel}(?:\\s*,\\s*|\\s+)${channel}(?:\\s*,\\s*|\\s+)${channel}(?:\\s*[,/]\\s*${channel})?\\s*\\))`;
const escapeSelector = (selector) => selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenOverrides = [
  ...['.global-nav .icon-button.add-item-link', '.global-nav .icon-button.add-item-link:is(:hover, :focus)']
    .map((selector) => [flavoredScope, selector, 'background-color', '--defaultColorAccent', true]),
  [flavoredScope, '.global-nav .icon-button.add-item-link svg.icon', 'fill', '--backgroundColorSchemeBase', true],
  ...['color', 'border-color'].map((property) => [flavoredScope, '.upgrade-info__button', property, '--defaultColorAccent', false]),
  [flavoredScope, '.upgrade-info:hover .upgrade-info__button', 'background-color', '--defaultColorAccent', false],
  [flavoredScope, '.upgrade-info:hover .upgrade-info__button', 'color', '--backgroundColorSchemeBase', false],
  ...['.Page--edit-wiki', '.Page--find-wiki', '.Page--view-wiki', '[class^=Page--wiki]'].flatMap((page) => {
    const card = `${page} .card.-wiki-migration.is_not-yet`;
    const light = ':root:root:root:root:root:not(.dark-mode) ';
    return [
      [escapeSelector('.dark-mode '), `${card} .wiki-migration-image svg path`, 'fill', '--backgroundColorSchemeBase', false],
      [escapeSelector('.dark-mode '), `${card} .button`, 'border-color', '--backgroundColorSchemeBase', false],
      [escapeSelector(light), `${card} .wiki-migration-image svg path`, 'fill', '--warningColorScaleText', false],
      ...['background-color', 'border-color'].map((property) => [escapeSelector(light), `${card} .button`, property, '--warningColorScaleAccent', false]),
      [escapeSelector(light), `${card} .button`, 'color', '--backgroundColorSchemeBase', false],
    ];
  }),
];
const overrideAllowlist = [
  ...tokenOverrides.map(([scope, selector, property, token, important]) => ({
    selector: new RegExp(`^${scope}${escapeSelector(selector)}$`),
    property,
    value: new RegExp(`^var\\(${token}\\)$`),
    important,
  })),
  { selector: /^\.dark-mode .+$/, property: 'color', value: /^var\(--backgroundColorSchemeBase\)$/ },
  { selector: /^\.dark-mode \.pill--square\.-subtasking$/, property: 'color', value: /^var\(--textColorWeak\)$/, important: false },
  { selector: /^:root:not\(\.dark-mode\) body\.Page--view-kanban \.card$/, property: 'background-color', value: /^var\(--backgroundColorSchemeBase\)$/ },
  { selector: new RegExp(`^${flavoredScope}\\.upgrade-bar\\.generic-cta-bar$`), property: 'background-image', value: new RegExp(`^linear-gradient\\(45deg, ${color}, ${color}\\)$`, 'i') },
  { selector: new RegExp(`^${flavoredScope}\\.na-choice-box\\.is_active$`), property: 'border-color', value: new RegExp(`^${color}$`, 'i') },
  ...[...sidebarProperties].flatMap(([selector, properties]) => properties.map((property) => ({
    selector: new RegExp(`^${flavoredScope}${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    property,
    value: new RegExp(`^${color}$`, 'i'),
  }))),
];

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
    if (!selectors.every((selector) => overrideAllowlist.some((entry) => entry.property === decl.prop &&
        entry.value.test(decl.value) && (entry.important === undefined || entry.important === Boolean(decl.important)) &&
        entry.selector.test(selector)))) {
      throw new Error(`Unexpected color override: ${decl.parent.selector} / ${decl.prop}`);
    }
  });
}

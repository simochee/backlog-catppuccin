import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import less from 'less';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { download, loadStylesheets, inspectCSS } from './source.mjs';
import { escapeSelector, errorPageGuard, legacyGuard, nuGuard, errorPageScope, darkScope, rootTokenScope, rootOverrideScope, nuTokenScope } from './guards.mjs';
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

export { errorPageGuard, errorPageGuardPattern, errorPageScope, darkScope, rootTokenScope, rootOverrideScope } from './guards.mjs';
const flavoredScope = `${escapeSelector(rootOverrideScope)}(?:\\.dark-mode)?(?: body)? `;
const channel = '[+-]?(?:\\d*\\.)?\\d+%?';
const color = `(?:#(?:[\\da-f]{3}|[\\da-f]{4}|[\\da-f]{6}|[\\da-f]{8})|(?:rgb|rgba|hsl|hsla)\\(\\s*${channel}(?:\\s*,\\s*|\\s+)${channel}(?:\\s*,\\s*|\\s+)${channel}(?:\\s*[,/]\\s*${channel})?\\s*\\))`;
const flavoredOverrideScope = { pattern: flavoredScope };
const literalScope = (literal) => ({ literal });
const override = (scope, selector, property, token, important = false) =>
  ({ scope, selector, property, token, important });
export const tokenOverrides = [
  override(flavoredOverrideScope, '.global-nav .icon-button.add-item-link', 'background-color', '--defaultColorAccent', true),
  override(flavoredOverrideScope, '.global-nav .icon-button.add-item-link:is(:hover, :focus)', 'background-color', '--headerAddButtonHoverBG', true),
  override(flavoredOverrideScope, '.global-nav .icon-button.add-item-link svg.icon', 'fill', '--backgroundColorSchemeBase', true),
  ...['color', 'border-color'].map((property) => override(flavoredOverrideScope, '.upgrade-info__button', property, '--defaultColorAccent')),
  ...[':hover', ':focus-within'].flatMap((state) => [
    override(flavoredOverrideScope, `.upgrade-info${state} .upgrade-info__button`, 'background-color', '--defaultColorAccent'),
    override(flavoredOverrideScope, `.upgrade-info${state} .upgrade-info__button`, 'color', '--backgroundColorSchemeBase'),
  ]),
  ...['.Page--edit-wiki', '.Page--find-wiki', '.Page--view-wiki', '[class^=Page--wiki]'].flatMap((page) =>
    [['is_not-yet', 'warning'], ['is_done', 'success']].flatMap(([state, scale]) => {
      const card = `${page} .card.-wiki-migration.${state}`;
      const light = literalScope(`${rootOverrideScope}:not(.dark-mode) `);
      const dark = literalScope(`${rootOverrideScope}.dark-mode `);
      const accent = `--${scale}ColorScaleAccent`;
      return [
        override(dark, `${card} a`, 'color', '--backgroundColorSchemeBase'),
        override(dark, `${card} .button`, 'border-color', '--backgroundColorSchemeBase'),
        override(light, card, 'border-color', accent),
        ...(state === 'is_not-yet' ? [
          override(dark, `${card} .wiki-migration-image svg path`, 'fill', '--backgroundColorSchemeBase'),
          override(light, `${card} .wiki-migration-image svg path`, 'fill', `--${scale}ColorScaleText`),
          ...['background-color', 'border-color'].map((property) => override(light, `${card} .button`, property, accent)),
          override(light, `${card} .button`, 'color', '--backgroundColorSchemeBase'),
          ...[':hover', ':focus', ':focus-visible'].flatMap((interaction) => [
            override(light, `${card} .button${interaction}`, 'background-color', '--backgroundColorSchemeBase'),
            ...['border-color', 'color', 'outline-color'].map((property) => override(light, `${card} .button${interaction}`, property, accent)),
          ]),
        ] : []),
      ];
    })),
];
export const scopePattern = (scope) => {
  if (Object.keys(scope).length !== 1) throw new Error('Scope must be a pattern or literal');
  if (typeof scope.pattern === 'string') return scope.pattern;
  if (typeof scope.literal === 'string') return escapeSelector(scope.literal);
  throw new Error('Scope must be a pattern or literal');
};
const overrideAllowlist = [
  ...['.button--primary.is_disabled', '.button--primary[disabled]'].map((selector) => ({
    selector: new RegExp(`^${escapeSelector(`${darkScope} ${selector}`)}$`),
    property: 'background-color',
    value: new RegExp(`^${color}$`, 'i'),
    important: false,
  })),
  ...tokenOverrides.map(({ scope, selector, property, token, important }) => ({
    selector: new RegExp(`^${scopePattern(scope)}${escapeSelector(selector)}$`),
    property,
    value: new RegExp(`^var\\(${token}\\)$`),
    important,
  })),
  { selector: new RegExp(`^${escapeSelector(`${darkScope} `)}.+$`), property: 'color', value: /^var\(--backgroundColorSchemeBase\)$/ },
  { selector: new RegExp(`^${escapeSelector(`${darkScope} .pill--square.-subtasking`)}$`), property: 'color', value: /^var\(--textColorWeak\)$/, important: false },
  { selector: new RegExp(`^${escapeSelector(`${errorPageScope}:not(.dark-mode) body.Page--view-kanban .card`)}$`), property: 'background-color', value: /^var\(--backgroundColorSchemeBase\)$/ },
  { selector: new RegExp(`^${flavoredScope}${escapeSelector('.upgrade-bar.generic-cta-bar')}$`), property: 'background-image', value: new RegExp(`^linear-gradient\\(45deg, ${color}, ${color}\\)$`, 'i') },
  { selector: new RegExp(`^${flavoredScope}${escapeSelector('.na-choice-box.is_active')}$`), property: 'border-color', value: new RegExp(`^${color}$`, 'i') },
  ...[...sidebarProperties].flatMap(([selector, properties]) => properties.map((property) => ({
    selector: new RegExp(`^${flavoredScope}${escapeSelector(selector)}$`),
    property,
    value: new RegExp(`^${color}$`, 'i'),
  }))),
];

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

const nodeShape = (node) => [node.type, node.type === 'combinator' ? node.value.trim() : node.value,
  node.namespace, node.nodes?.map(nodeShape)];
const guardShape = (guard) => JSON.stringify(nodeShape(selectorParser().astSync(guard, { lossless: false }).first.first));

export function checkErrorPageExclusion(css, addon = false) {
  css.walkRules((rule) => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && /^(?:-\w+-)?keyframes$/i.test(parent.name)) return;
    }
    const ast = selectorParser().astSync(rule.selector);
    for (const selector of ast.nodes) {
      const end = selector.nodes.findIndex((node) => node.type === 'combinator');
      const compound = selector.nodes.slice(0, end < 0 ? undefined : end);
      const anchored = compound.some((node) =>
        (node.type === 'pseudo' && node.value === ':root') || (node.type === 'class' && node.value === 'dark-mode'));
      const tokenSelector = new RegExp(`^${escapeSelector(rootTokenScope)}(?:\\.dark-mode)?(?: body)?(?: (?:\\[data-tooltip\\]|\\.message-tip|\\.simptip-(?:success|info|danger|error|warning)))?$`);
      const rootTokens = tokenSelector.test(selector.toString().trim()) && rule.nodes.every((node) =>
        node.type === 'comment' || (node.type === 'decl' && node.prop.startsWith('--')));
      const expected = addon ? nuGuard : rootTokens ? errorPageGuard : legacyGuard;
      if (!anchored || !compound.some((node) => JSON.stringify(nodeShape(node)) === guardShape(expected))) {
        throw new Error(`Missing error-page guard or design guard: ${selector}`);
      }
    }
  });
}

const luminance = (channels) => channels.map((channel) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);

export function checkDisabledContrast(css, flavor) {
  if (flavor === 'latte') return;
  const labels = [];
  const backgrounds = new Map();
  css.walkRules((rule) => {
    for (const selector of postcss.list.comma(rule.selector)) {
      for (const decl of rule.nodes) {
        if (decl.prop === '--textColorWeak' && selector === `${rootTokenScope}.dark-mode`) labels.push(decl.value);
        for (const state of ['.is_disabled', '[disabled]']) {
          if (decl.prop === 'background-color' && selector === `${darkScope} .button--primary${state}`) {
            backgrounds.set(state, decl.value);
          }
        }
      }
    }
  });
  if (!labels.length || backgrounds.size !== 2) throw new Error(`${flavor} missing disabled primary label/background`);
  const ratios = labels.flatMap((label) => [...backgrounds.values()].map((background) => {
    return contrastRatio(label, background);
  }));
  const ratio = Math.min(...ratios);
  if (ratio < 3) throw new Error(`${flavor} disabled primary contrast: ${ratio.toFixed(2)}:1 < 3:1`);
  return `${flavor} disabled primary contrast: PASS (${ratio.toFixed(2)}:1 >= 3:1)`;
}

export function contrastRatio(a, b) {
  const left = luminance(parseColor(a, 'foreground'));
  const right = luminance(parseColor(b, 'background'));
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

export const markerNames = ['pink', 'bordeaux', 'red', 'beige', 'orange', 'yellow', 'lime', 'green', 'cyan', 'blue', 'purple', 'magenta', 'grey'];
export function nuContrastPairs() {
  const pairs = [];
  for (const content of ['text', 'icon']) {
    for (const role of ['primary', 'danger', 'warning', 'success', 'info']) {
      pairs.push([`${content}-on-${role}`, `bg-${role}-default`]);
    }
    for (const role of ['primary', 'danger']) {
      for (const state of ['hover', 'active']) pairs.push([`${content}-on-${role}`, `bg-${role}-${state}`]);
    }
    for (const marker of markerNames) {
      for (const state of ['default', 'shape']) {
        for (const kind of ['default', 'inverted']) pairs.push([`${content}-on-marker-${kind}`, `bg-marker-${marker}-${state}`]);
      }
      for (const state of ['subtle', 'highlight']) pairs.push([`${content}-marker-${marker}`, `bg-marker-${marker}-${state}`]);
    }
    pairs.push([`${content}-on-theme-nav`, 'bg-theme-nav'], [`${content}-on-ghost`, 'bg-ghost-hover'],
      [`${content}-on-ghost`, 'bg-ghost-active'], [`${content}-default`, 'bg-default'],
      [`${content}-inverted`, 'bg-inverted']);
    for (const role of ['danger', 'warning', 'success', 'info']) {
      pairs.push([`${content}-${role}`, `bg-${role}-banner`], [`${content}-${role}`, `bg-${role}-subtle`]);
    }
  }
  return pairs;
}

export function checkNuTokenTypes(css, discovered) {
  const images = new Set(discovered.images);
  const colors = new Set(discovered.names.filter((name) => !discovered.composites.includes(name)));
  let checked = 0;
  css.walkDecls(/^--nuui-/, (decl) => {
    if (!images.has(decl.prop) && !colors.has(decl.prop)) return;
    const alias = decl.value.match(/^var\((--[\w-]+)\)$/)?.[1];
    const image = alias ? images.has(alias) : /[\w-]+-gradient\s*\(/i.test(decl.value);
    if (images.has(decl.prop) !== image) throw new Error(`Token type mismatch: ${decl.prop} must be ${images.has(decl.prop) ? 'an image' : 'a color'}`);
    if (!image && !(alias && colors.has(alias))) parseColor(decl.value, decl.prop);
    checked++;
  });
  return `New design image/color type parity: PASS (${[...images].filter((name) => name.startsWith('--nuui-')).length} discovered image tokens; ${checked} assignments)`;
}

export const nuComponentTokens = {
  '.project-nav-list': {
    '--nuui-bg-ghost-inverted-hover': '--nuui-bg-ghost-hover',
    '--nuui-bg-ghost-inverted-active': '--nuui-bg-ghost-active',
  },
  '.card.-wiki-migration.is_not-yet': {
    '--nuui-text-on-marker-inverted': '--nuui-text-warning',
    '--nuui-icon-on-marker-inverted': '--nuui-icon-warning',
    'border-color': '--nuui-border-warning-subtle',
  },
  '.card.-wiki-migration.is_not-yet .wiki-migration-image svg path': { fill: '--nuui-icon-warning' },
  '.card.-wiki-migration.is_not-yet .button': {
    'background-color': '--nuui-bg-warning-default', 'border-color': '--nuui-bg-warning-default', color: '--nuui-text-on-warning',
  },
  '.card.-wiki-migration.is_not-yet .button:is(:hover, :focus, :focus-visible)': {
    'background-color': '--nuui-bg-default', 'border-color': '--nuui-border-warning-subtle', color: '--nuui-text-warning',
  },
};

export function nuContrastFloor(flavor, foreground, background) {
  return flavor.split('/')[0] === 'latte' && /^(?:text|icon)-on-(?:primary|danger|warning|success|info)$/.test(foreground) &&
    /^bg-(?:primary|danger|warning|success|info)-(?:default|hover|active)$/.test(background) ? 2.5 : 3;
}

export function checkNuStyle(css, flavor, reportException = console.log) {
  checkErrorPageExclusion(css, true);
  let rules = 0;
  let minimum = Infinity;
  const exceptions = new Set();
  css.walkRules((rule) => {
    const component = Object.entries(nuComponentTokens).find(([selector]) => rule.selector === `${nuTokenScope} ${selector}`)?.[1];
    if (component) {
      if (rule.nodes.length !== Object.keys(component).length || rule.nodes.some((decl) => decl.type !== 'decl' || decl.important || decl.value !== `var(${component[decl.prop]})`)) throw new Error(`Unexpected add-on component: ${rule.selector}`);
      return;
    }
    const values = new Map(rule.nodes.filter((node) => node.type === 'decl').map((decl) => {
      if (!decl.prop.startsWith('--nuui-')) throw new Error(`Unexpected add-on declaration: ${decl.prop}`);
      return [decl.prop.slice(7), decl.value];
    }));
    for (const [foreground, background] of nuContrastPairs()) {
      const ratio = contrastRatio(values.get(foreground), values.get(background));
      minimum = Math.min(minimum, ratio);
      const floor = nuContrastFloor(flavor, foreground, background);
      if (ratio < floor) throw new Error(`${flavor} new design contrast: ${foreground} / ${background}: ${ratio.toFixed(2)}:1 < ${floor}:1`);
      if (ratio < 3) exceptions.add(`${flavor.includes('/') ? flavor : `${flavor}/mauve`} contrast exception: ${foreground} / ${background}: ${ratio.toFixed(3)}:1 >= 2.5:1`);
    }
    const order = ['bg-canvas-backdrop', 'bg-canvas-default', 'bg-default', 'bg-floating'];
    for (let index = 1; index < order.length; index++) {
      const before = luminance(parseColor(values.get(order[index - 1]), order[index - 1]));
      const after = luminance(parseColor(values.get(order[index]), order[index]));
      if (before > after) throw new Error(`${flavor} new design neutral order: ${order[index - 1]} / ${order[index]}`);
    }
    if (values.get('bg-ghost-hover') === values.get('bg-ghost-active')) throw new Error('New design hover/active surfaces must differ');
    rules++;
  });
  if (rules !== 4) throw new Error(`Expected four add-on root/body rules, got ${rules}`);
  for (const message of exceptions) reportException(message);
  return `${flavor} new design neutral ordering and contrast: PASS (${rules} rules; minimum ${minimum.toFixed(2)}:1; ${exceptions.size} Latte solid exceptions)`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
    const library = await download(libraryURL);
    const discovered = inspectCSS((await loadStylesheets()).map(({ css }) => css).join('\n'));
    const addon = await readFile(new URL('../catppuccin-nu.user.less', import.meta.url), 'utf8');
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
      checkErrorPageExclusion(css);
      const contrast = checkDisabledContrast(css, flavor);
      if (contrast) console.log(contrast);
      console.log(`${flavor}: PASS (${count} custom-property assignments)`);
      console.log(ordering);
    }
    for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
      const css = postcss.parse((await compile(flavor, addon, library)).css);
      console.log(checkNuTokenTypes(css, discovered));
      console.log(checkNuStyle(css, flavor));
      console.log(`${flavor} add-on: PASS`);
    }
    const accents = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'blue', 'sapphire', 'sky', 'lavender', 'subtext0'];
    for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
      for (const accent of accents.filter((accent) => accent !== 'mauve')) {
        const addonCSS = postcss.parse((await compile(flavor, addon, library, flavor, accent)).css);
        checkNuTokenTypes(addonCSS, discovered);
        checkNuStyle(addonCSS, `${flavor}/${accent}`);
        const mainCSS = postcss.parse((await compile(flavor, source, library, flavor, accent)).css);
        checkNeutralOrder(mainCSS, flavor);
        checkOverrides(mainCSS);
        checkErrorPageExclusion(mainCSS);
        checkDisabledContrast(mainCSS, flavor);
      }
    }
    console.log('Both files compile; add-on contrast across all 15 accent choices and four flavors: PASS');
    const mixedNu = postcss.parse((await compile('latte', addon, library, 'mocha', 'green')).css);
    const nuValues = new Map();
    mixedNu.walkRules((rule) => nuValues.set(rule.selector, rule.nodes.filter((decl) => decl.prop === '--nuui-bg-default').at(-1)?.value));
    if (nuValues.get(nuTokenScope) === nuValues.get(`${nuTokenScope}.dark-mode`)) throw new Error('Add-on flavor switching failed');
    const mixed = postcss.parse((await compile('latte', source, library, 'mocha', 'green')).css, { from: undefined, map: false });
    const palettes = {};
    mixed.walkDecls('--backgroundColorBase', (decl) => {
      if (!selectorParser().astSync(decl.parent.selector).nodes.every((selector) =>
        !selector.nodes.some((node) => node.type === 'combinator'))) return;
      palettes[decl.parent.selector.includes('.dark-mode') ? 'dark' : 'light'] = decl.value;
    });
    if (!palettes.light || !palettes.dark || palettes.light === palettes.dark) throw new Error('Flavor switching failed');
    console.log('Independent light/dark switching and scoped color overrides: PASS');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

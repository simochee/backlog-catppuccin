import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import less from 'less';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { loadPinnedLibrary, checkPalette } from './palette.mjs';
import { discoveredColorNames } from './source.mjs';
import nuTokenTypes from '../test/fixtures/nu-token-types.json' with { type: 'json' };
import { paletteAllowlist } from './style-policy.mjs';
import { escapeSelector, errorPageGuard, legacyGuard, newDesignGuard, legacyScope, legacyDarkScope, sharedTokenScope, legacyOverrideScope, newDesignTokenScope } from './guards.mjs';
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

export { errorPageGuard, errorPageGuardPattern, legacyScope, legacyDarkScope, sharedTokenScope, legacyOverrideScope } from './guards.mjs';
const flavoredScope = `${escapeSelector(legacyOverrideScope)}(?:\\.dark-mode)?(?: body)? `;
const channel = '[+-]?(?:\\d*\\.)?\\d+%?';
const color = `(?:#(?:[\\da-f]{3}|[\\da-f]{4}|[\\da-f]{6}|[\\da-f]{8})|(?:rgb|rgba|hsl|hsla)\\(\\s*${channel}(?:\\s*,\\s*|\\s+)${channel}(?:\\s*,\\s*|\\s+)${channel}(?:\\s*[,/]\\s*${channel})?\\s*\\))`;
const flavoredOverrideScope = { pattern: flavoredScope };
const literalScope = (literal) => ({ literal });
const override = (scope, selector, property, token, important = false) =>
  ({ scope, selector, property, token, important });
export const tokenOverrides = [
  override(flavoredOverrideScope, '.button--primary', 'color', '--onAccentText'),
  override(flavoredOverrideScope, '.global-nav .icon-button.add-item-link', 'background-color', '--defaultColorAccent', true),
  override(flavoredOverrideScope, '.global-nav .icon-button.add-item-link:is(:hover, :focus)', 'background-color', '--headerAddButtonHoverBG', true),
  override(flavoredOverrideScope, '.global-nav .icon-button.add-item-link svg.icon', 'fill', '--onAccentText', true),
  ...['color', 'border-color'].map((property) => override(flavoredOverrideScope, '.upgrade-info__button', property, '--defaultColorAccent')),
  ...[':hover', ':focus-within'].flatMap((state) => [
    override(flavoredOverrideScope, `.upgrade-info${state} .upgrade-info__button`, 'background-color', '--defaultColorAccent'),
    override(flavoredOverrideScope, `.upgrade-info${state} .upgrade-info__button`, 'color', '--onAccentText'),
  ]),
  ...['.Page--edit-wiki', '.Page--find-wiki', '.Page--view-wiki', '[class^=Page--wiki]'].flatMap((page) =>
    [['is_not-yet', 'warning'], ['is_done', 'success']].flatMap(([state, scale]) => {
      const card = `${page} .card.-wiki-migration.${state}`;
      const light = literalScope(`${legacyOverrideScope}:not(.dark-mode) `);
      const dark = literalScope(`${legacyOverrideScope}.dark-mode `);
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
export const sharedVisualProperties = new Map([
  ['::selection', ['background-color']],
  ...['.button--default', '.card--default', '.global-header'].map((selector) => [selector, ['background-color']]),
  ...['input', 'textarea'].map((selector) => [selector, ['caret-color', 'background-color']]),
  ...['[contenteditable]', '.CodeMirror', '.ace_editor'].map((selector) => [selector, ['caret-color']]),
  ...['.prettyprint', '.prettyprint.prettyprinted', '.loom code.prettyprint'].map((selector) => [selector, ['color', 'background-color', 'border-color']]),
  ...['kwd', 'str', 'atv', 'typ', 'atn', 'com', 'pun', 'opn', 'clo', 'pln', 'lit', 'tag', 'dec', 'var', 'fun'].map((name) => [`.prettyprint .${name}`, ['color']]),
  ['.prettyprint .linenums', ['color']],
  ['.prettyprint .linenums li:nth-child(even)', ['background-color']],
  ...['.Code-table .Code-table_content_separator', '.Code-table .Code-table_content_separator td', '.Code-split-table .Line-src.separator'].map((selector) => [selector, ['color', 'background-color']]),
  ['.code-view__header', ['color']],
  ['.Code-table .Line-number span', ['color']],
  ...['.pill--default', '.pill-inline-list__item-link', '.tab-buttons__pill', '.wiki-tag-list__count', '.filter-nav.-wiki-tag .filter-nav__link', '.pill--default:hover', '.pill-inline-list__item-link:hover', '.filter-nav.-wiki-tag .filter-nav__link:is(:hover, :focus, .is_active)'].map((selector) => [selector, ['background-color', 'color']]),
  ['.filter-nav.-wiki-tag .filter-nav__link .filter-nav__num', ['color']],
]);
const sharedVisualSelector = (selector) => ['', '.dark-mode'].some((mode) =>
  [...sharedVisualProperties.keys()].some((suffix) => selector === `${sharedTokenScope}${mode} ${suffix}`));
const overrideAllowlist = [
  ...[...sharedVisualProperties].flatMap(([selector, properties]) => properties.map((property) => ({
    selector: new RegExp(`^${escapeSelector(sharedTokenScope)}(?:\\.dark-mode)? ${escapeSelector(selector)}$`),
    property, value: new RegExp(`^${color}$`, 'i'), important: false,
  }))),
  ...['.button--primary.is_disabled', '.button--primary[disabled]'].map((selector) => ({
    selector: new RegExp(`^${escapeSelector(`${legacyDarkScope} ${selector}`)}$`),
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
  { selector: new RegExp(`^${escapeSelector(`${legacyDarkScope} `)}.+$`), property: 'color', value: /^var\(--backgroundColorSchemeBase\)$/ },
  { selector: new RegExp(`^${escapeSelector(`${legacyDarkScope} .pill--square.-subtasking`)}$`), property: 'color', value: /^var\(--textColorWeak\)$/, important: false },
  { selector: new RegExp(`^${escapeSelector(`${legacyScope}:not(.dark-mode) body.Page--view-kanban .card`)}$`), property: 'background-color', value: /^var\(--backgroundColorSchemeBase\)$/ },
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

const tokenSelector = new RegExp(`^${escapeSelector(sharedTokenScope)}(?:\\.dark-mode)?(?: body)?(?: (?:\\[data-tooltip\\]|\\.message-tip|\\.simptip-(?:success|info|danger|error|warning)))?$`);
const guardShapes = new Map([errorPageGuard, legacyGuard, newDesignGuard].map((guard) => [guard, guardShape(guard)]));
const keyframesPattern = /^(?:-\w+-)?keyframes$/i;

export function checkErrorPageExclusion(css, addon = false) {
  css.walkRules((rule) => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && keyframesPattern.test(parent.name)) return;
    }
    const ast = selectorParser().astSync(rule.selector);
    for (const selector of ast.nodes) {
      const end = selector.nodes.findIndex((node) => node.type === 'combinator');
      const compound = selector.nodes.slice(0, end < 0 ? undefined : end);
      const anchored = compound.some((node) =>
        (node.type === 'pseudo' && node.value === ':root') || (node.type === 'class' && node.value === 'dark-mode'));
      const rootTokens = tokenSelector.test(selector.toString().trim()) && rule.nodes.every((node) =>
        node.type === 'comment' || (node.type === 'decl' && node.prop.startsWith('--')));
      const expected = addon ? newDesignGuard : rootTokens || sharedVisualSelector(selector.toString().trim()) ? errorPageGuard : legacyGuard;
      if (!anchored || !compound.some((node) => JSON.stringify(nodeShape(node)) === guardShapes.get(expected))) {
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
        if (decl.prop === '--textColorWeak' && selector === `${sharedTokenScope}.dark-mode`) labels.push(decl.value);
        for (const state of ['.is_disabled', '[disabled]']) {
          if (decl.prop === 'background-color' && selector === `${legacyDarkScope} .button--primary${state}`) {
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

export function compositeColor(value, backdrop) {
  const rgb = parseColor(value, 'composited color');
  const alpha = value.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/i)?.[1];
  return alpha === undefined ? rgb : rgb.map((channel, index) => channel * Number(alpha) + backdrop[index] * (1 - Number(alpha)));
}
export function contrastRatio(a, b, backdrop = '#eff1f5') {
  const background = compositeColor(b, parseColor(backdrop, 'backdrop'));
  const left = luminance(compositeColor(a, background));
  const right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}

export const tooltipVariants = ['success', 'info', 'danger', 'error', 'warning'];
export function checkTooltipContrast(css, flavor, reportException = console.log, modeFlavors) {
  const checked = new Set();
  let minimum = Infinity;
  const exceptions = new Set();
  css.walkRules((rule) => {
    const values = new Map(rule.nodes.filter((node) => node.type === 'decl').map((decl) => [decl.prop, decl.value]));
    for (const selector of postcss.list.comma(rule.selector)) {
      const mode = selector.includes('.dark-mode') ? '.dark-mode' : '';
      const root = `${sharedTokenScope}${mode}`;
      const variant = tooltipVariants.find((name) => selector === `${root} .simptip-${name}`);
      if (selector !== root && !variant) continue;
      const actualFlavor = modeFlavors?.[mode ? 'dark' : 'light'] || flavor.split('/')[0];
      const label = `${flavor} tooltip mode=${mode || 'light'} variant=${variant || 'default'} selector=${selector}`;
      if (checked.has(`${mode}/${variant || 'default'}`)) throw new Error(`${label}: duplicate root block`);
      if (!values.has('--tooltip-text-color') || !values.has('--tooltip-base-color')) throw new Error(`${label}: missing tooltip foreground or base color`);
      const foreground = values.get('--tooltip-text-color');
      const background = values.get('--tooltip-base-color');
      const ratio = contrastRatio(foreground, background);
      const floor = actualFlavor === 'latte' && variant === 'success' ? 2.5 : 3;
      if (ratio < floor) throw new Error(`${label} contrast: ${ratio.toFixed(3)}:1 < ${floor}:1`);
      if (ratio < 3) exceptions.add(`${flavor} contrast exception: tooltip ${variant}: ${foreground} / ${background}: ${ratio.toFixed(3)}:1 >= 2.5:1`);
      if (values.get('--tooltipBaseColor') !== background) throw new Error('Tooltip background aliases must agree');
      checked.add(`${mode}/${variant || 'default'}`);
      minimum = Math.min(minimum, ratio);
    }
  });
  if (checked.size !== 2 * (tooltipVariants.length + 1)) throw new Error('Missing default or variant tooltip contrast pairs');
  for (const message of exceptions) reportException(message);
  return `${flavor} tooltip contrast: PASS (${checked.size} pairs; minimum ${minimum.toFixed(3)}:1; ${exceptions.size} Latte solid exceptions)`;
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
      [`${content}-on-ghost`, 'bg-ghost-active'], [`${content}-on-ghost`, 'bg-ghost-pressed'], [`${content}-default`, 'bg-default'],
      [`${content}-inverted`, 'bg-inverted']);
    for (const role of ['danger', 'warning', 'success', 'info']) {
      pairs.push([`${content}-${role}`, `bg-${role}-banner`], [`${content}-${role}`, `bg-${role}-subtle`]);
    }
  }
  return pairs;
}

const allNuContrastPairs = nuContrastPairs();
const accentNuContrastPairs = allNuContrastPairs.filter(([foreground]) => foreground.endsWith('-on-primary'));

export function checkNuTokenTypes(css, discovered) {
  const colors = new Set(discoveredColorNames(discovered, { requireNu: true }));
  const images = new Set(discovered.images);
  let checked = 0;
  css.walkDecls(/^--nuui-/, (decl) => {
    if (!images.has(decl.prop) && !colors.has(decl.prop)) return;
    const alias = decl.value.match(/^var\((--[\w-]+)\)$/)?.[1];
    const image = alias ? images.has(alias) : /[\w-]+-gradient\s*\(/i.test(decl.value);
    if (images.has(decl.prop) !== image) throw new Error(`Token type mismatch: ${decl.prop} must be ${images.has(decl.prop) ? 'an image' : 'a color'}`);
    if (!image && !(alias && colors.has(alias))) parseColor(decl.value, decl.prop);
    checked++;
  });
  if (!checked) throw new Error('No --nuui-* assignments checked for type parity');
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

export const nuDistinctSurfaces = [
  ...['bg-canvas-backdrop', 'bg-canvas-default', 'bg-default', 'bg-floating', 'bg-subtle', 'bg-row-header', 'bg-ghost-active'].map((surface) => ['bg-ghost-hover', surface]),
  ...['bg-floating', 'bg-subtle'].map((surface) => ['bg-disabled', surface]),
  ['bg-ghost-active', 'bg-ghost-pressed'], ['bg-ghost-hover', 'bg-disabled'],
  ['bg-ghost-active', 'bg-disabled'], ['bg-ghost-pressed', 'bg-disabled'],
];

export function checkNuStyle(css, flavor, reportException = console.log, accentOnly = false, modeFlavors) {
  if (!accentOnly) checkErrorPageExclusion(css, true);
  let rules = 0;
  let minimum = Infinity;
  const exceptions = new Set();
  css.walkRules((rule) => {
    const component = Object.entries(nuComponentTokens).find(([selector]) => rule.selector === `${newDesignTokenScope} ${selector}`)?.[1];
    if (component) {
      if (accentOnly) return;
      if (rule.nodes.length !== Object.keys(component).length || rule.nodes.some((decl) => decl.type !== 'decl' || decl.important || decl.value !== `var(${component[decl.prop]})`)) throw new Error(`Unexpected add-on component: ${rule.selector}`);
      return;
    }
    const values = new Map(rule.nodes.filter((node) => node.type === 'decl').map((decl) => {
      if (!decl.prop.startsWith('--nuui-')) throw new Error(`Unexpected add-on declaration: ${decl.prop}`);
      return [decl.prop.slice(7), decl.value];
    }));
    const actualFlavor = modeFlavors?.[rule.selector.includes('.dark-mode') ? 'dark' : 'light'] || flavor.split('/')[0];
    for (const [foreground, background] of accentOnly ? accentNuContrastPairs : allNuContrastPairs) {
      const ratio = contrastRatio(values.get(foreground), values.get(background), values.get('bg-default'));
      minimum = Math.min(minimum, ratio);
      const floor = nuContrastFloor(actualFlavor, foreground, background);
      if (ratio < floor) throw new Error(`${flavor} new design contrast: ${foreground} / ${background}: ${ratio.toFixed(2)}:1 < ${floor}:1`);
      if (ratio < 3) exceptions.add(`${flavor.includes('/') ? flavor : `${flavor}/mauve`} contrast exception: ${foreground} / ${background}: ${ratio.toFixed(3)}:1 >= 2.5:1`);
    }
    if (accentOnly) { rules++; return; }
    const order = ['bg-canvas-backdrop', 'bg-canvas-default', 'bg-default'];
    for (let index = 1; index < order.length; index++) {
      const before = luminance(parseColor(values.get(order[index - 1]), order[index - 1]));
      const after = luminance(parseColor(values.get(order[index]), order[index]));
      if (before > after) throw new Error(`${flavor} new design neutral order: ${order[index - 1]} / ${order[index]}`);
    }
    for (const [left, right] of nuDistinctSurfaces) {
      const a = parseColor(values.get(left), left);
      const b = parseColor(values.get(right), right);
      if (a.every((channel, index) => channel === b[index])) throw new Error(`New design surfaces must differ: ${left} / ${right}`);
    }
    rules++;
  });
  if (rules !== 4) throw new Error(`Expected four add-on root/body rules, got ${rules}`);
  for (const message of exceptions) reportException(message);
  return `${flavor} new design neutral ordering and contrast: PASS (${rules} rules; minimum ${minimum.toFixed(2)}:1; ${exceptions.size} Latte solid exceptions)`;
}

export function checkDerivedSource(source) {
  const clean = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (token) => token.startsWith('/') ? ' ' : token);
  if (/@inkWeight\b/.test(clean)) throw new Error('Blanket colored-ink mixing is forbidden');
  const neutralOrder = ['crust', 'mantle', 'base', 'surface0', 'surface1', 'surface2', 'overlay0', 'overlay1', 'overlay2', 'subtext0', 'subtext1', 'text'];
  for (const match of clean.matchAll(/\bmix\(\s*@([\w]+)\s*,\s*@([\w]+)\s*,/g)) {
    const left = neutralOrder.indexOf(match[1]);
    const right = neutralOrder.indexOf(match[2]);
    if (left < 0 || right < 0 || Math.abs(left - right) !== 1) throw new Error(`Opaque mix requires adjacent neutral steps or a reviewed exception: ${match[0]}`);
  }
  for (const match of clean.matchAll(/\b(?:darken|lighten)\([^,]+,\s*([\d.]+)%/g)) {
    if (Number(match[1]) > 20) throw new Error(`Ink correction exceeds 20%: ${match[0]}`);
  }
  for (const match of clean.matchAll(/#state\([^;]+;\s*([\d.]+)%/g)) {
    if (Number(match[1]) > 10) throw new Error(`Interaction correction exceeds 10%: ${match[0]}`);
  }
  for (const match of clean.matchAll(/(?:--[\w-]+|background(?:-color)?|color|fill|stroke|border-color|outline-color|caret-color)\s*:\s*([^;{}]+)/g)) {
    if (/#[\da-f]{3,8}\b|\b(?:white|black)\b|\brgba?\(\s*\d/i.test(match[1])) throw new Error(`Literal color outside the palette library: ${match[0]}`);
  }
  return 'source derivation bounds and color-literal scan: PASS';
}

export const accents = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'blue', 'sapphire', 'sky', 'lavender', 'subtext0'];
export async function validateStyles({ sources, library, report = console.log, render = compile }) {
  const failures = [];
  const checked = async (label, action) => {
    try { const message = await action(); if (message) report(`${label}: ${message}`); }
    catch (error) { failures.push(`${label}: ${error.message}`); }
  };
  for (const [file, source] of Object.entries(sources)) await checked(`${file} source policy`, () => checkDerivedSource(source));
  for (const [light, dark] of [
    ...['latte', 'frappe', 'macchiato', 'mocha'].map((flavor) => [flavor, flavor]),
    ['latte', 'mocha'], ['mocha', 'latte'],
  ]) {
    for (const accent of accents) {
      const modes = { light, dark };
      const label = `${light === dark ? light : `${light}+${dark}`}/${accent}`;
      for (const [file, source] of Object.entries(sources)) {
        const addon = file.includes('-nu');
        await checked(`${file} ${label} compile`, async () => {
          const css = postcss.parse((await render(light, source, library, dark, accent)).css);
          const scope = `${file} ${label}`;
          await checked(`${scope} guards`, () => checkErrorPageExclusion(css, addon));
          if (addon) {
            await checked(`${scope} type parity`, () => checkNuTokenTypes(css, nuTokenTypes));
            await checked(`${scope} surfaces/contrast`, () => checkNuStyle(css, label, report, false, modes));
            if (css.toString().includes('--tooltip-text-color:')) await checked(`${scope} tooltips`, () => checkTooltipContrast(css, label, report, modes));
            await checked(`${scope} ink deviations`, () => checkOnAccentInk(css, modes, report, label));
          } else {
            await checked(`${scope} overrides`, () => checkOverrides(css));
            await checked(`${scope} RGB`, () => css.walkDecls(/^--/, checkRGBCounterpart) && undefined);
            await checked(`${scope} tooltips`, () => checkTooltipContrast(css, label, report, modes));
            await checked(`${scope} disabled`, () => checkDisabledContrast(css, dark));
            await checked(`${scope} primary contrast`, () => checkMainContrast(css, modes, report, label));
            for (const [mode, flavor] of Object.entries(modes)) {
              const subset = css.clone();
              subset.walkRules((rule) => { if (rule.selector.includes('.dark-mode') !== (mode === 'dark')) rule.remove(); });
              await checked(`${scope} ${mode} surfaces`, () => checkNeutralOrder(subset, flavor));
            }
          }
          for (const [mode, flavor] of Object.entries(modes)) {
            const subset = css.clone();
            subset.walkRules((rule) => { if (rule.selector.includes('.dark-mode') !== (mode === 'dark')) rule.remove(); });
            await checked(`${scope} ${mode} ΔE`, () => checkPalette(subset, flavor, { allowlist: paletteAllowlist }));
          }
          if (accent === 'mauve' && light === dark) report(`${light}${addon ? ' add-on' : ''}: PASS`);
        });
      }
    }
  }
  if (failures.length) throw new Error(`${failures.length} validation failures:\n${failures.join('\n')}`);
  report('Both userstyles: all 15 accents × four flavors plus latte/mocha and mocha/latte mixed modes; sequential compilation, guards, source derivation bounds/literals, main override allowlist/RGB/neutral ordering/disabled and primary contrast/tooltips, add-on type parity/distinct surfaces/contrast/ink deviations, and all compiled colors ΔE: PASS');
}

export function checkMainContrast(css, modes, report = console.log, label = '') {
  let count = 0;
  css.walkRules((rule) => {
    const values = new Map(rule.nodes.filter((n) => n.type === 'decl').map((n) => [n.prop, n.value]));
    if (!values.has('--onAccentText')) return;
    const flavor = modes[rule.selector.includes('.dark-mode') ? 'dark' : 'light'];
    const ink = values.get('--onAccentText');
    const base = values.get('--backgroundColorSchemeBase');
    for (const token of ['--defaultColorAccent', '--headerAddButtonHoverBG']) {
      const background = values.get(token);
      const ratio = contrastRatio(ink, background);
      const floor = flavor === 'latte' ? 2.5 : 3;
      if (ratio < floor) throw new Error(`${label} main ${token}: ${ratio.toFixed(3)}:1 < ${floor}:1`);
      if (ratio < 3) report(`${label} contrast exception: main ${token}: ${ratio.toFixed(3)}:1 >= 2.5:1 [${rule.selector}]`);
      if (ink !== base) report(`${label} main on-accent ink deviation: ${token}: base ${base} / ${background}; using ${ink} (${ratio.toFixed(3)}:1) [${rule.selector}]`);
      count++;
    }
  });
  if (!count) throw new Error('Missing main on-accent contrast pairs');
  return `${count} main primary contrast pairs`;
}

export function checkOnAccentInk(css, modes, report = console.log, label = '') {
  let deviations = 0;
  css.walkRules((rule) => {
    const values = new Map(rule.nodes.filter((n) => n.type === 'decl').map((n) => [n.prop.slice(7), n.value]));
    if (!values.has('bg-primary-default')) return;
    const flavor = modes[rule.selector.includes('.dark-mode') ? 'dark' : 'light'];
    // Base is the default ink, even if another palette ink has greater contrast.
    for (const role of ['primary', 'danger', 'warning', 'success', 'info']) {
      const ink = values.get(`text-on-${role}`);
      const base = values.get('bg-default');
      if (ink === base) continue;
      const background = values.get(`bg-${role}-default`);
      if (contrastRatio(base, background) >= 3) throw new Error(`${flavor} ${role}: base ink already meets 3:1`);
      report(`${label} on-accent ink deviation: ${role}: base ${base} / ${background} below 3:1; using ${ink} (${contrastRatio(ink, background).toFixed(3)}:1) [${rule.selector}]`);
      deviations++;
    }
  });
  return `${deviations} on-accent ink deviations listed`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sources = Object.fromEntries(await Promise.all(['catppuccin.user.less', 'catppuccin-nu.user.less'].map(async (file) =>
      [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])));
    await validateStyles({ sources, library: await loadPinnedLibrary() });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

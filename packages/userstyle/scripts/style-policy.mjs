import { readFile } from 'node:fs/promises';
import less from 'less';
import { loadPalettes, parsePaletteColor } from './palette.mjs';
import { sharedTokenScope } from './guards.mjs';

const palettes = await loadPalettes();
const source = await readFile(new URL('../../../catppuccin.user.less', import.meta.url), 'utf8');
const entries = [...source.matchAll(/@ink-([\w-]+):\s*([^;]+);/g)];
const amounts = new Map(
  entries.map(([, key, value]) => {
    if (!/^(?:\d*\.)?\d+%$/.test(value) || parseFloat(value) > 20)
      throw new Error(`Ink correction requires 0–20%: ${key}`);
    return [key, value];
  }),
);
const expected = new Map();
for (const [key, amount] of amounts) {
  const hue = key.slice(key.lastIndexOf('-') + 1);
  const { css } = await less.render(`a {color: darken(${palettes.latte[hue]}, ${amount});}`);
  expected.set(key, css.match(/color: ([^;]+)/)[1]);
}
const markers = {
  beige: 'rosewater',
  blue: 'blue',
  bordeaux: 'maroon',
  cyan: 'teal',
  green: 'green',
  grey: 'subtext0',
  lime: 'green',
  magenta: 'pink',
  orange: 'peach',
  pink: 'pink',
  purple: 'mauve',
  red: 'red',
  yellow: 'yellow',
};
const syntax = {
  str: 'green',
  atv: 'green',
  typ: 'yellow',
  atn: 'yellow',
  lit: 'peach',
  dec: 'rosewater',
};
function target(decl, flavor) {
  const marker = decl.prop.match(/^--nuui-(?:text|icon)-marker-(.+)$/)?.[1];
  if (marker) return ['tint', markers[marker]];
  const role = decl.prop.match(
    /^--nuui-(?:text|icon)-(danger|info|success|warning|link|primary)$/,
  )?.[1];
  if (role) {
    const accent = decl.parent.nodes.find((node) => node.prop === '--nuui-bg-primary-shape')?.value;
    const hue =
      { danger: 'red', info: 'blue', success: 'green', warning: 'yellow' }[role] ||
      Object.keys(palettes[flavor]).find((name) => palettes[flavor][name] === accent);
    return ['tint', hue];
  }
  if (
    [
      '--commonColorYellow',
      '--filesActionColor',
      '--statusColor-5',
      '--warningColorScaleAccent',
    ].includes(decl.prop)
  )
    return ['fill', 'yellow'];
  if (decl.prop === '--commonColorPink') return ['fill', 'pink'];
  if (
    ['--defaultColorAccent', '--defaultColorMain', '--nuui-bg-primary-default'].includes(decl.prop)
  ) {
    const accent = decl.parent.nodes.find(
      (node) =>
        node.prop ===
        (decl.prop.startsWith('--nuui-') ? '--nuui-bg-primary-shape' : '--defaultColorLink'),
    )?.value;
    return [
      'fill',
      Object.keys(palettes[flavor]).find((name) => palettes[flavor][name] === accent),
    ];
  }
  if (decl.prop === '--warningColorScaleText') return ['warning', 'yellow'];
  if (decl.prop === '--successColorScaleText') return ['success', 'green'];
  if (decl.prop !== 'color' || !decl.parent.selector?.startsWith(sharedTokenScope)) return;
  const token = decl.parent.selector.match(/ \.prettyprint \.(\w+)$/)?.[1];
  if (syntax[token]) return ['surface', syntax[token]];
  if (decl.parent.selector.endsWith(' .code-view__header')) return ['mantle', 'pink'];
  if (
    decl.parent.selector.includes('.Code-table_content_separator') ||
    decl.parent.selector.endsWith(' .Code-split-table .Line-src.separator')
  )
    return ['surface', 'peach'];
}
const lightness = (rgb) => (Math.max(...rgb) + Math.min(...rgb)) / 510;
const lightnessRounding = 100 / 510;
export function checkCompiledInk(css, flavor) {
  css.walkDecls((decl) => {
    const correction = target(decl, flavor);
    if (!correction) return;
    const [role, hue] = correction;
    if (!hue) throw new Error(`Unknown source hue: ${decl.prop}`);
    const actual = parsePaletteColor(decl.value);
    const original = parsePaletteColor(palettes[flavor][hue]);
    const delta = (lightness(original) - lightness(actual)) * 100;
    if (delta < -lightnessRounding || delta > 20 + lightnessRounding)
      throw new Error(`Compiled ink correction exceeds 0–20%: ${decl.prop} (${delta.toFixed(3)}%)`);
    const color = flavor === 'latte' ? expected.get(`${role}-${hue}`) : palettes[flavor][hue];
    if (!color || actual.some((v, i) => v !== parsePaletteColor(color)[i]))
      throw new Error(`Unexpected compiled ink correction: ${decl.prop} / ${role}-${hue}`);
  });
}
export function compiledInkAllowlist(css, flavor) {
  checkCompiledInk(css, flavor);
  const entries = [];
  css.walkDecls((decl) => {
    const correction = target(decl, flavor);
    if (flavor !== 'latte' || !correction) return;
    const key = correction.join('-');
    entries.push({
      flavor,
      property: decl.prop,
      selector: decl.parent.selector,
      color: decl.value,
      reason: `Latte ${key} ink correction ${amounts.get(key)} for its hosting surfaces.`,
    });
  });
  return entries;
}

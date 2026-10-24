import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import colorNames from 'color-name';

// Public Catppuccin std/v1.less, fetched 2026-10-25. No application CSS is vendored.
export const libraryURL = 'https://userstyles.catppuccin.com/lib/std/v1.less';
export const librarySHA256 = '9a340a8173d3bacf2ece233b34f8fdb856b12c28ae1d8f5e6e8e80aef0e98378';
export const flavors = ['latte', 'frappe', 'macchiato', 'mocha'];
export const maxPaletteDistance = 12;
export async function loadPinnedLibrary() {
  const library = await readFile(new URL('../test/fixtures/catppuccin-library.less', import.meta.url), 'utf8');
  if (createHash('sha256').update(library).digest('hex') !== librarySHA256) throw new Error('Pinned Catppuccin library SHA-256 mismatch');
  return library;
}

export function palettesFromLibrary(library) {
  // Only the first map contains colors; the subsequent filter map has the same flavor keys.
  const map = library.slice(library.indexOf('@catppuccin: {'), library.indexOf('@catppuccin-filters:'));
  return Object.fromEntries(flavors.map((flavor) => {
    const body = map.match(new RegExp(`@${flavor}:\\s*\\{([^}]+)\\}`))?.[1];
    const entries = [...(body || '').matchAll(/@([\w]+):\s*(#[\da-f]{6})\s*;/gi)].map(([, name, color]) => [name, color]);
    if (entries.length !== 26) throw new Error(`Expected 26 Catppuccin colors for ${flavor}`);
    return [flavor, Object.fromEntries(entries)];
  }));
}
let pinnedPalettes;
export async function loadPalettes() {
  return pinnedPalettes ??= palettesFromLibrary(await loadPinnedLibrary());
}

const numeric = /^[+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?$/i;
function number(value, scale = 1) {
  const percent = value.endsWith('%');
  const raw = percent ? value.slice(0, -1) : value;
  if (!numeric.test(raw)) throw new Error(`Invalid color channel: ${value}`);
  return Number(raw) * (percent ? scale / 100 : 1);
}
const clamp = (value, max = 1) => Math.min(max, Math.max(0, value));

// Returns unpremultiplied sRGB channels. Alpha never changes distance to the palette.
export function parsePaletteColor(input) {
  const value = input.trim().toLowerCase();
  if (Object.hasOwn(colorNames, value)) return [...colorNames[value]];
  if (value === 'transparent') return [0, 0, 0];
  if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/.test(value)) {
    const hex = value.slice(1);
    return (hex.length <= 4 ? hex.slice(0, 3).split('').map((v) => v + v) : hex.slice(0, 6).match(/../g)).map((v) => parseInt(v, 16));
  }
  const match = value.match(/^(rgba?|hsla?|hwb)\((.*)\)$/);
  if (!match) throw new Error(`Unsupported color: ${input}`);
  const parts = match[2].replace(/(?:,|\/)\s*(?:var|env)\(.+\)\s*$/, '').trim().split(/\s*[,/]\s*|\s+/);
  if (![3, 4].includes(parts.length)) throw new Error(`Invalid color: ${input}`);
  if (parts.length === 4) number(parts[3]);
  if (match[1].startsWith('rgb')) return parts.slice(0, 3).map((v) => clamp(number(v, 255), 255));
  const hue = parts[0].match(/^([+-]?(?:\d*\.)?\d+)(deg|grad|rad|turn)?$/);
  if (!hue || !parts.slice(1, 3).every((v) => v.endsWith('%'))) throw new Error(`Invalid color: ${input}`);
  const h = ((Number(hue[1]) * ({ deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 }[hue[2] || 'deg']) % 360) + 360) % 360 / 60;
  let a = clamp(number(parts[1], 1));
  let b = clamp(number(parts[2], 1));
  const c = match[1] === 'hwb' ? 1 : (1 - Math.abs(2 * b - 1)) * a;
  const x = c * (1 - Math.abs(h % 2 - 1));
  const channels = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h)];
  if (match[1] === 'hwb') return channels.map((v) => (a + b >= 1 ? a / (a + b) : v * (1 - a - b) + a) * 255);
  return channels.map((v) => (v + b - c / 2) * 255);
}

// IEC sRGB -> XYZ D65 -> CIELAB, with D65 reference white (95.047,100,108.883).
export function rgbToLab(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const xyz = [(r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883];
  const [x, y, z] = xyz.map((v) => v > (6 / 29) ** 3 ? Math.cbrt(v) : v / (3 * (6 / 29) ** 2) + 4 / 29);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const deltaE76 = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const paletteLabs = new WeakMap();
function preparedPalette(palette) {
  if (!paletteLabs.has(palette)) paletteLabs.set(palette, Object.entries(palette).map(([name, color]) => {
    const channels = parsePaletteColor(color);
    return { name, color, channels, lab: rgbToLab(channels) };
  }));
  return paletteLabs.get(palette);
}
export function nearestPaletteColor(color, palette) {
  const rgb = Array.isArray(color) ? color : parsePaletteColor(color);
  const lab = rgbToLab(rgb);
  let nearest;
  for (const { name, color: value, channels, lab: paletteLab } of preparedPalette(palette)) {
    const distance = deltaE76(lab, paletteLab);
    if (!nearest || distance < nearest.distance) nearest = { name, color: value, distance, exact: rgb.every((v, i) => Math.abs(v - channels[i]) < 1e-9) };
  }
  if (!nearest) throw new Error('Empty palette');
  return nearest;
}

const colorFunction = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)$/i;
function colorAlpha(input) {
  const value = input.trim().toLowerCase();
  if (value === 'transparent') return 0;
  if (/^#[\da-f]{4}$/.test(value)) return parseInt(value[4].repeat(2), 16) / 255;
  if (/^#[\da-f]{8}$/.test(value)) return parseInt(value.slice(-2), 16) / 255;
  const body = value.match(/^[\w]+\((.*)\)$/)?.[1];
  const alpha = body?.includes('/') ? body.slice(body.indexOf('/') + 1).trim() : body?.split(',').length === 4 ? body.split(',')[3].trim() : undefined;
  return alpha === undefined ? 1 : /^(?:var|env)\(/.test(alpha) ? alpha : clamp(number(alpha));
}
export function declarationColors(decl) {
  if (/^--/.test(decl.prop) && /(?:-rgb|^--rgb-accent)$/.test(decl.prop)) {
    return [{ color: `rgb(${decl.value})`, rgb: parsePaletteColor(`rgb(${decl.value})`) }];
  }
  const colors = [];
  valueParser(decl.value).walk((node) => {
    if (node.type === 'function') {
      if (/^(?:url|env)$/i.test(node.value)) return false;
      if (colorFunction.test(node.value)) {
        const color = valueParser.stringify(node);
        // A variable color is checked where its literal is assigned, including var() fallbacks below.
        try {
          colors.push({ color, rgb: parsePaletteColor(color) });
          return false;
        } catch (error) {
          if (!/\b(?:var|env)\(/i.test(color)) throw error;
        }
      }
    }
    if (node.type === 'word' && (node.value.startsWith('#') || Object.hasOwn(colorNames, node.value.toLowerCase()) || node.value.toLowerCase() === 'transparent')) {
      colors.push({ color: node.value, rgb: parsePaletteColor(node.value) });
    }
  });
  return colors;
}

/** Count literal occurrences, not distinct values or declarations. No default exceptions. */
export async function analyzePalette(css, flavor, { allowlist = [], palette } = {}) {
  palette ??= (await loadPalettes())[flavor];
  if (!palette) throw new Error(`Unknown palette flavor: ${flavor}`);
  for (const entry of allowlist) {
    if (!entry.property || !flavors.includes(entry.flavor) || typeof entry.reason !== 'string' || !entry.reason.trim()) throw new Error('Palette allowlist requires property, flavor and nonempty reason');
    if (entry.color) parsePaletteColor(entry.color);
  }
  const report = { flavor, total: 0, exact: 0, small: 0, allowlisted: 0, failed: 0, reasons: {}, colors: [] };
  const root = typeof css === 'string' ? postcss.parse(css) : css;
  root.walkDecls((decl) => {
    for (const { color, rgb } of declarationColors(decl)) {
      const nearest = nearestPaletteColor(rgb, palette);
      const entry = allowlist.find((item) => item.property === decl.prop && item.flavor === flavor &&
        (!item.selector || item.selector === decl.parent.selector) &&
        (!item.color || (colorAlpha(item.color) === colorAlpha(color) &&
          parsePaletteColor(item.color).every((v, i) => Math.abs(v - rgb[i]) < 1e-9))));
      const category = nearest.exact ? 'exact' : nearest.distance <= maxPaletteDistance ? 'small' : entry ? 'allowlisted' : 'failed';
      report.total++;
      report[category]++;
      if (category === 'allowlisted') Object.defineProperty(report.reasons, entry.reason, {
        value: (Object.hasOwn(report.reasons, entry.reason) ? report.reasons[entry.reason] : 0) + 1,
        writable: true, configurable: true, enumerable: true,
      });
      report.colors.push({ property: decl.prop, selector: decl.parent.selector, color, rgb, nearest, category,
        ...(category === 'allowlisted' ? { reason: entry.reason } : {}) });
    }
  });
  return report;
}
export function formatPaletteSummary(report) {
  return `${report.flavor} palette: ${report.failed ? 'FAIL' : 'PASS'} (${report.total} colors; exact=${report.exact}; small<=12=${report.small}; allowlisted=${report.allowlisted}; failed=${report.failed}; reasons=${JSON.stringify(report.reasons)})`;
}
export async function checkPalette(css, flavor, options) {
  const report = await analyzePalette(css, flavor, options);
  if (report.failed) {
    const details = report.colors.filter((item) => item.category === 'failed').map((item) =>
      `${item.property}: ${item.color} -> ${item.nearest.name} ${item.nearest.color} (CIE76=${item.nearest.distance.toFixed(3)}) [${item.selector}]`);
    const error = new Error(`${formatPaletteSummary(report)}\n${details.join('\n')}`);
    error.report = report;
    throw error;
  }
  return formatPaletteSummary(report);
}

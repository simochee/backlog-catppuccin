import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import less from 'less';
import { loadPinnedLibrary, loadPalettes, palettesFromLibrary, parsePaletteColor, rgbToLab,
  deltaE76, nearestPaletteColor, declarationColors, analyzePalette, checkPalette, formatPaletteSummary } from '../scripts/palette.mjs';

const near = (actual, expected, tolerance = 0.001) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < tolerance, `${v} vs ${expected[i]}`));

test('pinned public library loads and compiles entirely offline', async () => {
  const library = await loadPinnedLibrary();
  const palettes = await loadPalettes();
  assert.deepEqual(Object.keys(palettes), ['latte', 'frappe', 'macchiato', 'mocha']);
  assert.equal(palettes.mocha.base, '#1e1e2e');
  assert.equal(palettes.latte.mauve, '#8839ef');
  for (const [flavor, palette] of Object.entries(palettes)) {
    assert.equal(Object.keys(palette).length, 26);
    const { css } = await less.render(`${library}\na { color: @catppuccin[@${flavor}][@base]; }`, { javascriptEnabled: false });
    assert.match(css, new RegExp(palette.base));
  }
  assert.throws(() => palettesFromLibrary(''), /Expected 26/);
});

test('sRGB conversion matches reference CIELAB D65 primaries', () => {
  near(rgbToLab([0, 0, 0]), [0, 0, 0]);
  near(rgbToLab([255, 255, 255]), [100, 0, 0]);
  near(rgbToLab([255, 0, 0]), [53.2408, 80.0925, 67.2032]);
  near(rgbToLab([0, 255, 0]), [87.7347, -86.1827, 83.1793]);
  near(rgbToLab([0, 0, 255]), [32.297, 79.1875, -107.8602]);
  assert.equal(deltaE76([1, 2, 3], [4, 6, 3]), 5);
});

test('hex, names, legacy and modern alpha colors preserve unpremultiplied base', () => {
  for (const color of ['#abc', '#abcd', '#aabbcc', '#aabbcc00', 'rgb(170,187,204)', 'rgba(170,187,204,0)', 'rgb(170 187 204 / 12%)']) {
    assert.deepEqual(parsePaletteColor(color), [170, 187, 204]);
  }
  near(parsePaletteColor('rgb(100% 0% 50% / 0)'), [255, 0, 127.5]);
  for (const color of ['red', 'hsl(0,100%,50%)', 'hsla(360,100%,50%,0)', 'hsl(1turn 100% 50% / 0)', 'hwb(0 0% 0% / 0)']) {
    near(parsePaletteColor(color), [255, 0, 0]);
  }
  near(parsePaletteColor('hwb(0 100% 100%)'), [127.5, 127.5, 127.5]);
  assert.deepEqual(parsePaletteColor('transparent'), [0, 0, 0]);
  for (const invalid of ['#ggg', 'rgb(a b c)', 'rgb(1 2)', 'hsl(0 1 1)', 'lab(1 2 3)']) assert.throws(() => parsePaletteColor(invalid));
});

test('nearest palette minimizes CIE76 across every swatch', async () => {
  const palette = (await loadPalettes()).mocha;
  for (const [name, color] of Object.entries(palette)) {
    const nearest = nearestPaletteColor(color, palette);
    assert.equal(nearest.name, name);
    assert.equal(nearest.distance, 0);
    assert.equal(nearest.exact, true);
  }
  const nearest = nearestPaletteColor('#1f1f2f', palette);
  assert.equal(nearest.name, 'base');
  assert.ok(nearest.distance > 0 && nearest.distance < 12);
  assert.throws(() => nearestPaletteColor('#000', {}), /Empty palette/);
});

test('counts every gradient stop, shadow, fallback, named color and RGB token occurrence', async () => {
  const report = await analyzePalette(`a {
    --base: #1e1e2e;
    --base-rgb: 30, 30, 46;
    --rgb-accent: 203, 166, 247;
    background: linear-gradient(45deg, #1e1e2e80, rgba(203,166,247,0.2));
    box-shadow: 0 0 1px #1e1e2e, 0 1px rgba(203,166,247,0);
    color: var(--fallback, #1e1e2e);
    border-color: red;
    background-image: url('red.png');
    content: 'red #f00';
    --length: 12px;
  }`, 'mocha');
  assert.equal(report.total, 9);
  assert.equal(report.exact, 8);
  assert.equal(report.failed, 1);
  assert.equal(report.total, report.exact + report.small + report.allowlisted + report.failed);
  assert.equal(report.colors.filter((v) => v.property === 'box-shadow').length, 2);
  assert.equal(report.colors.find((v) => v.color.startsWith('rgba') && v.color.endsWith(',0)')).nearest.exact, true);
});

test('unsupported literal color spaces fail loudly rather than disappear from counts', async () => {
  await assert.rejects(analyzePalette('a{color:oklch(50% 0.1 100)}', 'mocha'), /Unsupported color/);
  await assert.rejects(analyzePalette('a{--bad-rgb: 1,2}', 'mocha'), /Invalid color/);
  assert.deepEqual(declarationColors({ prop: 'color', value: 'currentColor' }), []);
});

test('small differences enforce the CIE76 cutoff around 12', async () => {
  // L*=12 is above the cube-root transition. Grayscale sRGB has a*=b*=0,
  // apart from the rounding of the standard matrix coefficients.
  const valueAt = (l) => 255 * (1.055 * (((l + 16) / 116) ** 3) ** (1 / 2.4) - 0.055);
  const palette = { black: '#000' };
  const below = valueAt(11.999);
  const above = valueAt(12.001);
  const report = await analyzePalette(`a{color:rgb(${below} ${below} ${below});background:rgb(${above} ${above} ${above})}`, 'mocha', { palette });
  assert.equal(report.small, 1);
  assert.equal(report.failed, 1);
});

test('literal base channels still count when alpha is a variable', async () => {
  const report = await analyzePalette('a{color:rgb(30 30 46 / var(--alpha));box-shadow:0 0 rgba(203,166,247,var(--alpha));background:rgb(var(--channels) / 0.5)}', 'mocha');
  assert.equal(report.total, 2);
  assert.equal(report.exact, 2);
});

test('explicit allowlist is property/flavor/color scoped and counts reasons', async () => {
  const css = 'a{color:#f00;background:#f00}b{color:#00f}';
  const allowlist = [{ property: 'color', flavor: 'mocha', color: '#ff0000', reason: 'Required measured contrast' }];
  const report = await analyzePalette(css, 'mocha', { allowlist });
  assert.equal(report.allowlisted, 1);
  assert.equal(report.failed, 2);
  assert.deepEqual(report.reasons, { 'Required measured contrast': 1 });
  assert.equal((await analyzePalette(css, 'latte', { allowlist })).allowlisted, 0);
  assert.equal((await analyzePalette('a{color:rgba(255,0,0,0.5)}', 'mocha', { allowlist })).allowlisted, 0);
  assert.equal((await analyzePalette('b{color:red}', 'mocha', { allowlist: [{ ...allowlist[0], selector: 'a' }] })).allowlisted, 0);
  for (const entry of [{ property: 'color', flavor: 'mocha' }, { property: 'color', reason: 'why' }, { flavor: 'mocha', reason: 'why' }, { property: 'color', flavor: 'mocha', reason: ' ' }]) {
    await assert.rejects(analyzePalette(css, 'mocha', { allowlist: [entry] }), /allowlist requires/);
  }
});

test('checker reports counts, nearest color, measured failure and diagnostic data', async () => {
  assert.match(await checkPalette('a{color:#1e1e2e;background:#1f1f2f}', 'mocha'), /PASS.*exact=1; small<=12=1; allowlisted=0; failed=0/);
  await assert.rejects(checkPalette('a{color:#f00}', 'mocha'), (error) => {
    assert.match(error.message, /mocha palette: FAIL.*failed=1/);
    assert.match(error.message, /color: #f00 -> .*CIE76=/);
    assert.equal(error.report.total, 1);
    assert.match(formatPaletteSummary(error.report), /FAIL/);
    return true;
  });
  await assert.rejects(analyzePalette('a{}', 'unknown'), /Unknown palette flavor/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import less from 'less';
import { compile, contrastRatio, compositeColor, checkTooltipContrast, sharedTokenScope, validateStyles, accents, checkDerivedSource } from '../scripts/compile.mjs';
import { loadPinnedLibrary, loadPalettes } from '../scripts/palette.mjs';

const library = await loadPinnedLibrary();
const palettes = await loadPalettes();
const sources = Object.fromEntries(await Promise.all(['catppuccin.user.less', 'catppuccin-nu.user.less'].map(async (file) => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])));

test('contrast composites translucent foregrounds and backgrounds over their real backdrop', () => {
  assert.deepEqual(compositeColor('rgba(200, 100, 0, 0.25)', [100, 100, 100]), [125, 100, 75]);
  assert.equal(contrastRatio('#000', 'rgba(255, 255, 255, 0.5)', '#000'), contrastRatio('#000', 'rgb(127.5,127.5,127.5)'));
  assert.equal(contrastRatio('rgba(0,0,0,0)', '#fff'), 1);
});

test('tooltip diagnostics identify missing colors and duplicate mode/variant blocks', () => {
  for (const suffix of ['', '.dark-mode', ' .simptip-warning', '.dark-mode .simptip-success']) {
    const selector = sharedTokenScope + suffix;
    assert.throws(() => checkTooltipContrast(postcss.parse(`${selector} {--tooltip-base-color:#fff}`), 'latte'), (error) =>
      error.message.includes('latte') && error.message.includes('mode=') && error.message.includes('variant=') && error.message.includes(selector) && error.message.includes('missing'));
  }
  const rule = `${sharedTokenScope} {--tooltip-base-color:#fff;--tooltipBaseColor:#fff;--tooltip-text-color:#111}`;
  assert.throws(() => checkTooltipContrast(postcss.parse(rule + rule), 'mocha'), /mocha.*mode=light.*variant=default.*duplicate/);
});

test('accent sweeps visit both files sequentially in every flavor and both mixed directions, collecting failures', async () => {
  const calls = [];
  let active = 0;
  await assert.rejects(validateStyles({ sources, library, report() {}, async render(light, source, lib, dark, accent) {
    assert.equal(active++, 0);
    calls.push([light, dark, accent, source]);
    await Promise.resolve();
    active--;
    throw new Error(`fixture ${calls.length}`);
  } }), /180 validation failures:[\s\S]*fixture 1[\s\S]*fixture 180/);
  assert.equal(calls.length, 6 * accents.length * 2);
  assert.deepEqual(calls.slice(0, 4).map(([l,d,a,s]) => [l,d,a,s === sources['catppuccin.user.less']]), [
    ['latte','latte','rosewater',true], ['latte','latte','rosewater',false],
    ['latte','latte','flamingo',true], ['latte','latte','flamingo',false],
  ]);
  assert.ok(calls.some(([l,d]) => l === 'latte' && d === 'mocha'));
  assert.ok(calls.some(([l,d]) => l === 'mocha' && d === 'latte'));
});

const rgb = (hex) => hex.slice(1).match(/../g).map((v) => parseInt(v,16));
const colorString = (channels) => `rgb(${channels.join(',')})`;
const darken = (color, amount) => less.functions.functionRegistry.get('darken')(new less.tree.Color(rgb(color)), new less.tree.Dimension(amount, '%')).rgb.map(Math.round);
for (const flavor of ['latte','frappe','macchiato','mocha']) {
  test(`${flavor} selection, cursor, diff and syntax roles preserve the guide and ink floor`, async () => {
    const p = palettes[flavor];
    const css = postcss.parse((await compile(flavor, sources['catppuccin.user.less'], library)).css);
    const values = new Map();
    css.walkDecls((decl) => { for (const selector of postcss.list.comma(decl.parent.selector)) values.set(`${selector}|${decl.prop}`, decl.value); });
    const root = sharedTokenScope;
    const token = (name) => values.get(`${root}|${name}`);
    const rule = (selector, prop = 'color') => values.get(`${root} ${selector}|${prop}`);
    assert.equal(token('--diffColorChangedText'), p.blue);
    assert.match(token('--diffColorChangedBase'), /rgba\(.+, 0.2\)/);
    assert.deepEqual(compositeColor(rule('::selection','background-color'), [0,0,0]), rgb(p.overlay2).map((v) => v*.25));
    assert.equal(rule('::selection'), undefined);
    assert.equal(rule('textarea','caret-color'), p.rosewater);
    const roles = {kwd:'mauve',str:'green',atv:'green',typ:'yellow',atn:'yellow',lit:'peach',dec:'rosewater',fun:'blue',tag:'mauve'};
    for (const [cls,hue] of Object.entries(roles)) {
      const actual = rule(`.prettyprint .${cls}`);
      if (actual === p[hue]) { assert.ok(contrastRatio(actual,p.surface0) >= 3); continue; }
      assert.equal(flavor,'latte');
      const steps = Array.from({length:201},(_,i)=>i/10);
      const minimum = steps.find((amount) => contrastRatio(colorString(darken(p[hue],amount)),p.surface0) >= 3);
      assert.deepEqual(rgb(actual), darken(p[hue],minimum));
      assert.ok(minimum <= 20);
    }
  });
}


test('source checks reject opaque hue mixtures, large corrections, blanket ink and raw colors', () => {
  for (const source of ['--tint: mix(@red, @base, 20%);', '--ink: darken(@yellow, 21%);', '--hover: #state(@red; 11%);', '@inkWeight: 40%;', '--color: #ff0000;', 'color: rgb(1, 2, 3);']) {
    assert.throws(() => checkDerivedSource(source));
  }
  assert.match(checkDerivedSource('--neutral: mix(@surface0, @surface1, 50%); --tint: fade(@green, 20%);'), /PASS/);
});

test('Latte marker inks use the first passing 0.1% correction and dark hues stay palette-exact', async () => {
  const markers = { beige:'rosewater', blue:'blue', bordeaux:'maroon', cyan:'teal', green:'green', lime:'green', magenta:'pink', orange:'peach', pink:'pink', purple:'mauve', red:'red', yellow:'yellow' };
  for (const flavor of ['latte','frappe','macchiato','mocha']) {
    const css = postcss.parse((await compile(flavor, sources['catppuccin-nu.user.less'], library)).css);
    let root;
    css.walkRules((rule) => { if (!root && rule.nodes.some((decl) => decl.prop === '--nuui-bg-default')) root = rule; });
    const values = new Map(root.nodes.map((decl) => [decl.prop, decl.value]));
    const p = palettes[flavor];
    for (const [marker, hue] of Object.entries(markers)) {
      const actual = values.get(`--nuui-text-marker-${marker}`);
      if (flavor !== 'latte') { assert.equal(actual, p[hue]); continue; }
      const background = colorString(rgb(p[hue]).map((v,i) => Math.round(v*.22 + rgb(p.base)[i]*.78)));
      const amount = Array.from({length:201},(_,i)=>i/10).find((amount) => contrastRatio(colorString(darken(p[hue],amount)), background) >= 3 && contrastRatio(colorString(darken(p[hue],amount)),p.base) >= 3);
      assert.ok(amount !== undefined && amount <= 20);
      assert.deepEqual(rgb(actual), darken(p[hue],amount));
    }
  }
});

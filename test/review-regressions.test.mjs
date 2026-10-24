import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import less from 'less';
import postcss from 'postcss';
import { compile, checkMainContrast, checkNuStyle, checkErrorPageExclusion, checkSharedAllowlist, checkSharedContrast, checkOverrides, styleSubsets, contrastRatio, nuContrastPairs } from '../scripts/compile.mjs';
import { checkCompiledInk, compiledInkAllowlist } from '../scripts/style-policy.mjs';
import { loadPinnedLibrary, loadPalettes } from '../scripts/palette.mjs';
import { legacyOverrideScope, newDesignTokenScope, sharedTokenScope, newDesignGuard, legacyGuard, errorPageGuard } from '../scripts/guards.mjs';

const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
const library = await loadPinnedLibrary();
const palettes = await loadPalettes();
const compiled = new Map();
for (const flavor of Object.keys(palettes)) compiled.set(flavor, postcss.parse((await compile(flavor, source, library)).css));
const rootValues = (rule) => new Map(rule.nodes.filter((node) => node.type === 'decl').map((decl) => [decl.prop, decl.value]));

for (const [flavor, css] of compiled) {
  test(`${flavor} keeps base ink and paints isolated input and card surfaces`, () => {
    let root;
    css.walkRules((rule) => { if (rule.selector === sharedTokenScope) root = rule; });
    const values = rootValues(root);
    assert.equal(values.get('--backgroundColorSchemeBase'), palettes[flavor].base);
    const { legacy } = styleSubsets(css);
    let inputs = 0;
    let cards = 0;
    legacy.walkRules((rule) => {
      if (rule.selector.includes('.input-text:not(')) {
        assert.equal(rule.first.value, flavor === 'latte' ? palettes[flavor].mantle : palettes[flavor].surface0);
        assert.ok(rule.selector.startsWith(legacyOverrideScope));
        inputs++;
      }
      if (rule.selector.endsWith(' body.Page--view-kanban .card')) {
        assert.equal(rule.first.value, 'var(--backgroundColorPrimary)');
        cards++;
      }
    });
    assert.equal(inputs, 4);
    assert.equal(cards, 1);
  });

  test(`${flavor} measures every tint pair against all emitted hosting surfaces`, () => {
    const nu = styleSubsets(css).nu;
    nu.walkRules((rule) => {
      const values = rootValues(rule);
      if (!values.has('--nuui-bg-default')) return;
      for (const [ink, background] of nuContrastPairs()) {
        if (!values.get(`--nuui-${background}`).startsWith('rgba(')) continue;
        for (const surface of ['bg-default', 'bg-subtle', 'bg-floating']) {
          const ratio = contrastRatio(values.get(`--nuui-${ink}`), values.get(`--nuui-${background}`), values.get(`--nuui-${surface}`));
          assert.ok(ratio >= 3, `${ink} / ${background} over ${surface}: ${ratio}`);
        }
      }
    });
  });
}

test('remapping emitted on-accent ink cannot pass using the source palette base', () => {
  const css = compiled.get('frappe').clone();
  assert.doesNotThrow(() => checkMainContrast(css, { light: 'frappe', dark: 'frappe' }, () => {}));
  css.walkDecls('--backgroundColorSchemeBase', (decl) => { decl.value = palettes.frappe.red; });
  assert.throws(() => checkMainContrast(css, { light: 'frappe', dark: 'frappe' }, () => {}), /base ink.*< 3:1/);
});

test('raised-surface remaps are checked independently of the default surface', () => {
  for (const surface of ['bg-subtle', 'bg-floating']) {
    const nu = styleSubsets(compiled.get('frappe')).nu;
    nu.walkDecls(`--nuui-${surface}`, (decl) => { decl.value = palettes.frappe.red; });
    assert.throws(() => checkNuStyle(nu, 'frappe', () => {}), new RegExp(`over ${surface}`));
  }
});

test('legacy and new-design guard validation reject guards from the other section', () => {
  for (const guard of [errorPageGuard, legacyGuard]) {
    assert.throws(() => checkErrorPageExclusion(postcss.parse(`:root${guard} {--nuui-bg-default:red}`), 'new'), /design guard/);
  }
  assert.throws(() => checkErrorPageExclusion(postcss.parse(`:root${newDesignGuard} .button {color:red}`), 'legacy'), /design guard/);
  const wrongNew = postcss.parse(`${newDesignTokenScope.replace(newDesignGuard, legacyGuard)} {--nuui-bg-default:red}`);
  assert.throws(() => checkErrorPageExclusion(styleSubsets(wrongNew).nu, 'new'), /design guard/);
  assert.throws(() => checkErrorPageExclusion(wrongNew, true), /Unknown design section/);
});

test('compiled ink checks reject excess corrections regardless of helper names', async () => {
  for (const transform of ['darken', 'lighten']) for (const amount of ['20.1%', '-1%', '10']) {
    const input = `@import "https://userstyles.catppuccin.com/lib/std/v1.less";
      @indirect: ${amount}; #renamed(@shade; @weight) {color:${transform}(@shade,@weight);}
      a {#renamed(#aabbcc; @indirect);}`;
    await assert.rejects(compile('latte', input, library), /requires 0–20%/);
  }
  for (const amount of [21, 40]) {
    const css = compiled.get('latte').clone();
    const changed = (await less.render(`a{color:darken(${palettes.latte.pink},${amount}%);}`)).css.match(/color: ([^;]+)/)[1];
    css.walkDecls('--nuui-text-marker-pink', (decl) => { decl.value = changed; });
    assert.throws(() => checkCompiledInk(css, 'latte'), /Compiled ink correction exceeds/);
    assert.throws(() => compiledInkAllowlist(css, 'latte'), /Compiled ink correction exceeds/);
  }
});

test('selectorless at-rule declarations do not enter rule-only checks', () => {
  const css = compiled.get('mocha').clone();
  css.append(postcss.parse('@font-face {font-family:example;src:url(example.woff2);font-weight:400}').first);
  assert.doesNotThrow(() => checkSharedAllowlist(css));
  assert.doesNotThrow(() => checkSharedContrast(css, {light:'mocha', dark:'mocha'}));
  assert.doesNotThrow(() => checkOverrides(css));
});

test('Latte fill corrections are the first 0.1% step reaching the label floor', async () => {
  const p = palettes.latte;
  const latte = postcss.parse((await compile('latte', source, library, 'latte', 'rosewater')).css);
  let root;
  latte.walkRules((rule) => { if (rule.selector === sharedTokenScope) root = rule; });
  const values = rootValues(root);
  for (const [hue, property] of [['yellow','--commonColorYellow'], ['pink','--commonColorPink'], ['rosewater','--defaultColorAccent']]) {
    const amount = Number(source.match(new RegExp(`@ink-fill-${hue}: ([\\d.]+)%`))[1]);
    assert.ok(contrastRatio(p.base, values.get(property), p.base) >= 2.5);
    const previous = (await less.render(`a{color:darken(${p[hue]},${amount - 0.1}%);}`)).css.match(/color: ([^;]+)/)[1];
    assert.ok(contrastRatio(p.base, previous, p.base) < 2.5);
  }
});

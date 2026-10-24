import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { compile, checkMainContrast, contrastRatio, accents } from '../scripts/compile.mjs';
import { sharedTokenScope, newDesignTokenScope } from '../scripts/guards.mjs';
import { source, library, palettes, compiled, rootValues } from './helpers/compiled-style.mjs';

test('remapping emitted on-accent ink cannot pass using the source palette base', () => {
  const css = compiled.get('frappe').clone();
  assert.doesNotThrow(() => checkMainContrast(css, { light: 'frappe', dark: 'frappe' }, () => {}));
  css.walkDecls('--backgroundColorSchemeBase', (decl) => { decl.value = palettes.frappe.red; });
  assert.throws(() => checkMainContrast(css, { light: 'frappe', dark: 'frappe' }, () => {}), /base ink.*< 3:1/);
});


test('all accents use one emitted fill and choose ink against that fill in both designs', async () => {
  for (const flavor of Object.keys(palettes)) for (const accent of accents) {
    const css = postcss.parse((await compile(flavor, source, library, flavor, accent)).css);
    let legacy;
    let nu;
    css.walkRules((rule) => {
      if (rule.selector === sharedTokenScope) legacy = rootValues(rule);
      if (rule.selector === newDesignTokenScope) nu = rootValues(rule);
    });
    const fill = legacy.get('--defaultColorAccent');
    assert.equal(legacy.get('--defaultColorMain'), fill);
    assert.equal(nu.get('--nuui-bg-primary-default'), fill);
    const baseRatio = contrastRatio(palettes[flavor].base, fill, palettes[flavor].base);
    const textRatio = contrastRatio(palettes[flavor].text, fill, palettes[flavor].base);
    const ink = baseRatio >= 3 || baseRatio >= textRatio ? palettes[flavor].base : palettes[flavor].text;
    assert.equal(legacy.get('--onAccentText'), ink, `${flavor}/${accent}`);
    assert.equal(nu.get('--nuui-text-on-primary'), ink, `${flavor}/${accent}`);
    assert.ok(contrastRatio(ink, fill, palettes[flavor].base) >= (flavor === 'latte' ? 2.5 : 3));
  }
});

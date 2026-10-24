import test from 'node:test';
import assert from 'node:assert/strict';
import { checkNuStyle, styleSubsets, contrastRatio, nuContrastPairs } from '../scripts/compile.mjs';
import { palettes, compiled, rootValues } from './helpers/compiled-style.mjs';

for (const [flavor, css] of compiled) {
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

test('raised-surface remaps are checked independently of the default surface', () => {
  for (const surface of ['bg-subtle', 'bg-floating']) {
    const nu = styleSubsets(compiled.get('frappe')).nu;
    nu.walkDecls(`--nuui-${surface}`, (decl) => { decl.value = palettes.frappe.red; });
    assert.throws(() => checkNuStyle(nu, 'frappe', () => {}), new RegExp(`over ${surface}`));
  }
});

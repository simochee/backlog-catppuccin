import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { styleSubsets } from '../scripts/compile.mjs';
import { legacyOverrideScope, sharedTokenScope } from '../scripts/guards.mjs';
import { palettes, compiled, rootValues } from './helpers/compiled-style.mjs';

for (const [flavor, css] of compiled) {
  test(`${flavor} gives controls the same raised surface in every state while keeping base ink and card surfaces`, () => {
    let root;
    css.walkRules((rule) => { if (rule.selector === sharedTokenScope) root = rule; });
    const values = rootValues(root);
    assert.equal(values.get('--backgroundColorSchemeBase'), palettes[flavor].base);
    const { legacy } = styleSubsets(css);
    let inputs = 0;
    let cards = 0;
    legacy.walkRules((rule) => {
      const selectors = postcss.list.comma(rule.selector);
      if (selectors.some((selector) => selector.endsWith(' .input-text'))) {
        const surface = flavor === 'latte' ? palettes[flavor].mantle : palettes[flavor].surface0;
        assert.equal(rule.first.value, surface);
        for (const control of ['.input-text', '.input-password', '.textarea', '.selectbox', '.selectbox__item', '.search-box__input']) {
          for (const state of ['', ':focus', '.is_error', '.errInput', '.is_disabled', '[disabled]', '[readonly]']) {
            const target = selectors.find((selector) => selector.endsWith(' .input-text')).replace(/ \.input-text$/, ` ${control}`);
            assert.ok(selectors.includes(target), `${control}${state} must inherit the unconditional surface`);
          }
        }
        assert.ok(selectors.every((selector) => selector.startsWith(legacyOverrideScope)));
        inputs++;
      }
      if (rule.selector.endsWith(' body.Page--view-kanban .card')) {
        assert.equal(rule.first.value, 'var(--backgroundColorSchemeBase)');
        cards++;
      }
    });
    assert.equal(inputs, 4);
    assert.equal(cards, 1);
  });

}

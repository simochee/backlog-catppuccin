import test from 'node:test';
import assert from 'node:assert/strict';
import less from 'less';
import postcss from 'postcss';
import { compile, contrastRatio } from '../scripts/compile.mjs';
import { sharedTokenScope } from '../scripts/guards.mjs';
import { source, library, palettes, rootValues } from './helpers/compiled-style.mjs';

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

import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import less from 'less';
import { compile } from '../scripts/compile.mjs';
import { checkCompiledInk, compiledInkAllowlist } from '../scripts/style-policy.mjs';
import { library, palettes, compiled } from './helpers/compiled-style.mjs';

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

test('darken and lighten explain missing, unitless and non-percent amounts with the call and filename', async () => {
  for (const name of ['darken', 'lighten']) for (const amount of ['', ', 10', ', 10px', ', 10deg', ', red']) {
    const call = `${name}(#aabbcc${amount})`;
    await assert.rejects(compile('latte', `@import "https://userstyles.catppuccin.com/lib/std/v1.less"; a {color: ${call};}`, library), (error) => {
      assert.equal(error.type, 'Runtime');
      assert.ok(error.message.includes(`${name}(`));
      assert.match(error.message, /in input.*requires 0–20%/);
      assert.doesNotMatch(error.message, /TypeError/);
      return true;
    });
  }
});

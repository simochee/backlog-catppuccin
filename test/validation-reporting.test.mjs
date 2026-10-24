import test from 'node:test';
import assert from 'node:assert/strict';
import less from 'less';
import { validateStyles } from '../scripts/compile.mjs';
import { source, library, palettes, compiled } from './helpers/compiled-style.mjs';

test('a correction-cap failure suppresses dependent palette failures for that configuration', async () => {
  const css = compiled.get('latte').clone();
  const color = (await less.render(`a {color: darken(${palettes.latte.pink}, 40%);}`)).css.match(/color: ([^;]+)/)[1];
  css.walkDecls('--nuui-text-marker-pink', (decl) => { decl.value = color; });
  let calls = 0;
  await assert.rejects(validateStyles({ sources: { 'catppuccin.user.less': source }, library, report() {}, async render() {
    if (calls++) throw new Error('Skipped fixture');
    return { css: css.toString() };
  } }), (error) => {
    assert.match(error.message, /^90 validation failures:/);
    assert.match(error.message, /correction caps: Compiled ink correction exceeds/);
    assert.doesNotMatch(error.message, /ΔE/);
    return true;
  });
});

test('each passing compile configuration prints exactly one PASS summary', async () => {
  const messages = [];
  let calls = 0;
  await assert.rejects(validateStyles({ sources: { 'catppuccin.user.less': source }, library, report: (message) => messages.push(message), async render() {
    if (calls++) throw new Error('Skipped fixture');
    return { css: compiled.get('latte').toString() };
  } }), /^Error: 89 validation failures:/);
  assert.deepEqual(messages.filter((message) => message.includes('PASS')), ['catppuccin.user.less latte/rosewater: PASS']);
  assert.ok(messages.filter((message) => !message.includes('PASS')).every((message) => /exception|deviation/.test(message)));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { checkSharedAllowlist, checkSharedContrast, checkOverrides } from '../scripts/compile.mjs';
import { compiled } from './helpers/compiled-style.mjs';

test('selectorless at-rule declarations do not enter rule-only checks', () => {
  const css = compiled.get('mocha').clone();
  css.append(postcss.parse('@font-face {font-family:example;src:url(example.woff2);font-weight:400}').first);
  assert.doesNotThrow(() => checkSharedAllowlist(css));
  assert.doesNotThrow(() => checkSharedContrast(css, {light:'mocha', dark:'mocha'}));
  assert.doesNotThrow(() => checkOverrides(css));
});


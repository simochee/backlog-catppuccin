import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { checkErrorPageExclusion, styleSubsets } from '../scripts/compile.mjs';
import { newDesignTokenScope, newDesignGuard, legacyGuard, errorPageGuard } from '../scripts/guards.mjs';

test('legacy and new-design guard validation reject guards from the other section', () => {
  for (const guard of [errorPageGuard, legacyGuard]) {
    assert.throws(() => checkErrorPageExclusion(postcss.parse(`:root${guard} {--nuui-bg-default:red}`), 'new'), /design guard/);
  }
  assert.throws(() => checkErrorPageExclusion(postcss.parse(`:root${newDesignGuard} .button {color:red}`), 'legacy'), /design guard/);
  const wrongNew = postcss.parse(`${newDesignTokenScope.replace(newDesignGuard, legacyGuard)} {--nuui-bg-default:red}`);
  assert.throws(() => checkErrorPageExclusion(styleSubsets(wrongNew).nu, 'new'), /design guard/);
  assert.throws(() => checkErrorPageExclusion(wrongNew, true), /Unknown design section/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { selectorSpecificity, compare } from '@csstools/selector-specificity';
import selectorParser from 'postcss-selector-parser';
import { compile, legacyOverrideScope, sharedTokenScope, legacyDarkScope, legacyScope, checkErrorPageExclusion, checkOverrides, tokenOverrides, scopePattern } from '../scripts/compile.mjs';

const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
const library = `#lib() { .palette() {
  @base: #eeeeee; @mantle: #dddddd; @crust: #cccccc;
  @surface0: #bbbbbb; @surface1: #aaaaaa; @surface2: #999999;
  @text: #111111; @subtext1: #222222; @subtext0: #333333;
  @overlay0: #444444; @overlay1: #555555; @overlay2: #666666; @rosewater: #bb8888;
  @accent: #8833aa; @mauve: @accent; @sapphire: @accent; @teal: @accent;
  @green: @accent; @blue: @accent; @red: @accent; @peach: @accent;
  @yellow: @accent; @pink: @accent; @flamingo: @accent;
} }`;
const scope = legacyOverrideScope;
const flavoredScopes = ['', '.dark-mode'].flatMap((mode) =>
  ['', ' body'].map((body) => `${scope}${mode}${body} `));
const expected = tokenOverrides.flatMap(({ scope, selector, property, token, important }) =>
  (scope.literal === undefined ? flavoredScopes : [scope.literal])
    .map((prefix) => [`${prefix}${selector}`, property, token, important]));

for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
  test(`${flavor} compiled rules exclude error pages and preserve component tokens and disabled states`, async () => {
    const css = postcss.parse((await compile(flavor, source, library)).css);
    checkOverrides(css);
    checkErrorPageExclusion(css);
    const roots = [];
    css.walkRules((rule) => { if (rule.selector === sharedTokenScope) roots.push(rule); });
    assert.equal(roots[0].nodes.find((decl) => decl.prop === '--iconColorWeak').value, flavor === 'latte' ? '#333333' : '#444444');
    for (const state of ['.is_disabled', '[disabled]']) {
      const selector = `${legacyDarkScope} .button--primary${state}`;
      const declarations = [];
      css.walkRules((rule) => {
        if (postcss.list.comma(rule.selector).includes(selector)) declarations.push(...rule.nodes);
        assert.ok(!postcss.list.comma(rule.selector).includes(`${legacyScope} .button--primary${state}`));
      });
      assert.equal(declarations.length, 1);
      assert.equal(declarations[0].prop, 'background-color');
      assert.equal(declarations[0].value, '#aaaaaa');
      assert.equal(Boolean(declarations[0].important), false);
    }
    for (const [selector, property, token, important] of expected) {
      const found = [];
      css.walkRules((rule) => {
        if (postcss.list.comma(rule.selector).includes(selector)) {
          for (const decl of rule.nodes) if (decl.prop === property) found.push(decl);
        }
      });
      assert.equal(found.length, 1, `${selector} / ${property}`);
      assert.equal(found[0].value, `var(${token})`);
      assert.equal(Boolean(found[0].important), important);
    }
  });
}

test('each new allowlist entry enforces token, selector, property and importance', () => {
  for (const [selector, property, token, important] of expected) {
    const rule = (s = selector, p = property, value = `var(${token})`, priority = important) =>
      postcss.parse(`${s} {${p}:${value}${priority ? ' !important' : ''}}`);
    assert.doesNotThrow(() => checkOverrides(rule()));
    for (const css of [
      rule(selector, property, 'var(--textColorPrimary)'),
      rule(`${selector}, .unlisted`),
      rule(selector, 'stroke'),
      rule(selector, property, `var(${token})`, !important),
      rule(selector.replace('is_not-yet', 'is_unknown').replace('is_done', 'is_unknown').replace('upgrade-info', 'other-info').replace('add-item-link', 'other-link')),
    ]) {
      if (css.toString() === rule().toString()) continue;
      assert.throws(() => checkOverrides(css), /Unexpected color override/);
    }
  }
});

test('scope patterns distinguish raw patterns from escaped literals', () => {
  assert.equal(scopePattern({ pattern: 'raw.*' }), 'raw.*');
  assert.equal(scopePattern({ literal: '.literal:not(.dark-mode) ' }), '\\.literal:not\\(\\.dark-mode\\) ');
  for (const scope of [{}, { pattern: '', literal: '' }, { other: '' }]) {
    assert.throws(() => scopePattern(scope), /Scope must be a pattern or literal/);
  }
});

test('header interaction mix differs from rest and migration states outrank rest', async () => {
  const css = postcss.parse((await compile('latte', source, library)).css);
  const mixes = [];
  css.walkDecls('--headerAddButtonHoverBG', (decl) => mixes.push(decl.value));
  assert.equal(mixes.length, 4);
  assert.ok(mixes.every((value) => value !== '#8833aa'));
  const specificity = (selector) => selectorSpecificity(selectorParser().astSync(selector).first);
  for (const { scope, selector } of tokenOverrides.filter(({ selector }) => / \.button:(hover|focus)/.test(selector))) {
    const prefix = scope.literal;
    assert.ok(compare(specificity(prefix + selector), specificity(prefix + selector.replace(/:(hover|focus-visible|focus)$/, ''))) > 0);
  }
});

test('disabled primary allowlist enforces dark scope, state, background and importance', () => {
  for (const state of ['.is_disabled', '[disabled]']) {
    const selector = `${legacyDarkScope} .button--primary${state}`;
    assert.doesNotThrow(() => checkOverrides(postcss.parse(`${selector} {background-color:#abc}`)));
    for (const rule of [
      `${selector.replace('.dark-mode', '')} {background-color:#abc}`,
      `${selector.replace(state, ':hover')} {background-color:#abc}`,
      `${selector} {background-color:#abc!important}`,
      `${selector} {color:#abc}`,
      `${selector}, .button--primary${state} {background-color:#abc}`,
    ]) assert.throws(() => checkOverrides(postcss.parse(rule)), /Unexpected color override/);
  }
});

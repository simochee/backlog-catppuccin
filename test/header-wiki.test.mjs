import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { compile, checkOverrides } from '../scripts/compile.mjs';

const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
const library = `#lib() { .palette() {
  @base: #eeeeee; @mantle: #dddddd; @crust: #cccccc;
  @surface0: #bbbbbb; @surface1: #aaaaaa; @surface2: #999999;
  @text: #111111; @subtext1: #222222; @subtext0: #333333;
  @overlay0: #444444; @overlay1: #555555;
  @accent: #8833aa; @mauve: @accent; @sapphire: @accent; @teal: @accent;
  @green: @accent; @blue: @accent; @red: @accent; @peach: @accent;
  @yellow: @accent; @pink: @accent; @flamingo: @accent;
} }`;
const scope = ':root:root:root:root:root';
const pages = ['.Page--edit-wiki', '.Page--find-wiki', '.Page--view-wiki', '[class^=Page--wiki]'];
const card = ' .card.-wiki-migration.is_not-yet';
const expected = [];
for (const mode of ['', '.dark-mode']) {
  for (const body of ['', ' body']) {
    const prefix = `${scope}${mode}${body} `;
    for (const state of ['', ':is(:hover, :focus)']) {
      expected.push([`${prefix}.global-nav .icon-button.add-item-link${state}`, 'background-color', '--defaultColorAccent', true]);
    }
    expected.push(
      [`${prefix}.global-nav .icon-button.add-item-link svg.icon`, 'fill', '--backgroundColorSchemeBase', true],
      [`${prefix}.upgrade-info__button`, 'color', '--defaultColorAccent', false],
      [`${prefix}.upgrade-info__button`, 'border-color', '--defaultColorAccent', false],
      [`${prefix}.upgrade-info:hover .upgrade-info__button`, 'background-color', '--defaultColorAccent', false],
      [`${prefix}.upgrade-info:hover .upgrade-info__button`, 'color', '--backgroundColorSchemeBase', false],
    );
  }
}
for (const page of pages) {
  const light = `${scope}:not(.dark-mode) ${page}${card}`;
  const dark = `.dark-mode ${page}${card}`;
  expected.push(
    [`${dark} .wiki-migration-image svg path`, 'fill', '--backgroundColorSchemeBase', false],
    [`${dark} .button`, 'border-color', '--backgroundColorSchemeBase', false],
    [`${light} .wiki-migration-image svg path`, 'fill', '--warningColorScaleText', false],
    [`${light} .button`, 'background-color', '--warningColorScaleAccent', false],
    [`${light} .button`, 'border-color', '--warningColorScaleAccent', false],
    [`${light} .button`, 'color', '--backgroundColorSchemeBase', false],
  );
}

for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
  test(`${flavor} header and migration overrides retain tokens, appearance scope and importance`, async () => {
    const css = postcss.parse((await compile(flavor, source, library)).css);
    checkOverrides(css);
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
      rule(selector.replace('is_not-yet', 'is_done').replace('upgrade-info', 'other-info').replace('add-item-link', 'other-link')),
    ]) {
      if (css.toString() === rule().toString()) continue;
      assert.throws(() => checkOverrides(css), /Unexpected color override/);
    }
  }
});

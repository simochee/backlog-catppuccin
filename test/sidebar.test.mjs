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

for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
  test(`${flavor} sidebar uses recessed surfaces and readable states in both appearances`, async () => {
    const css = postcss.parse((await compile(flavor, source, library)).css);
    checkOverrides(css);
    for (const mode of ['', '.dark-mode']) {
      const scope = `:root:root:root:root:root:where(:not(:has(> body.Page--error)))${mode}`;
      const declaration = (selector, property, required = true) => {
        let found;
        css.walkRules((rule) => {
          if (postcss.list.comma(rule.selector).includes(`${scope} ${selector}`)) {
            for (const decl of rule.nodes) if (decl.prop === property) found = decl;
          }
        });
        if (required) assert.ok(found, `${mode} ${selector} / ${property}`);
        return found;
      };
      assert.equal(declaration('.project-nav__back', 'background-color').value, flavor === 'latte' ? '#cccccc' : '#dddddd');
      assert.equal(declaration('.project-nav-list__text', 'color').value, '#222222');
      for (const property of ['fill', 'color']) {
        const icon = declaration('.project-nav-list__icon.icon', property);
        assert.equal(icon.value, '#8833aa');
        assert.ok(icon.important);
      }
      const state = '.project-nav-list__link:is(.is_active, :hover, :focus)';
      assert.equal(declaration(state, 'background-color').value, '#bbbbbb');
      assert.equal(declaration(state, 'color').value, '#8833aa');
      assert.equal(declaration(`${state} .project-nav-list__text`, 'color').value, '#8833aa');
      for (const state of ['', ':is(.is_active, :hover, :focus)']) {
        const beta = `.project-nav-list__link#navi-document${state} .project-nav-list__beta`;
        assert.equal(declaration(beta, 'background-color').value, state ? '#aaaaaa' : '#bbbbbb');
        if (state) assert.notEqual(declaration(beta, 'background-color').value, declaration('.project-nav-list__link:is(.is_active, :hover, :focus)', 'background-color').value);
        for (const property of ['color', 'outline-color']) {
          const decl = declaration(beta, property);
          assert.equal(decl.value, state ? '#8833aa' : '#222222');
          assert.ok(decl.important);
        }
      }
      for (const suffix of [' .trigger-icon__line', '::before', '::after']) {
        assert.equal(declaration(`.trigger-icon .trigger-icon__inner${suffix}`, 'background-color').value, '#222222');
      }
      assert.equal(declaration('.project-nav-ai-pr', 'background-color').value, flavor === 'latte' ? '#cccccc' : '#dddddd');
      assert.equal(declaration('.project-nav-ai-pr:is(:hover, :focus)', 'background').value, '#bbbbbb');
      const aiIcon = '.project-nav-ai-pr:is(:hover, :focus) .project-nav-ai-pr__icon.icon';
      assert.equal(declaration(aiIcon, 'background-color').value, '#bbbbbb');
      for (const property of ['background', 'fill']) assert.equal(declaration(aiIcon, property, false), undefined);
      const root = css.nodes.flatMap((node) => node.nodes || []).find((rule) => rule.selector === scope);
      assert.equal(root.nodes.find((decl) => decl.prop === '--defaultColorMain').value, '#8833aa');
      assert.equal(root.nodes.find((decl) => decl.prop === '--defaultColorAccent').value, '#8833aa');
    }
  });
}

test('sidebar override validation rejects layout, unrelated selectors and missing flavor scope', () => {
  for (const rule of [
    ':root:root:root:root:root:where(:not(:has(> body.Page--error))) .project-nav__back {display:none}',
    ':root:root:root:root:root:where(:not(:has(> body.Page--error))) .project-nav-list__text {background-color:#abc}',
    ':root:root:root:root:root:where(:not(:has(> body.Page--error))) .project-nav-other {color:#abc}',
    '.project-nav-list__text {color:#abc}',
  ]) assert.throws(() => checkOverrides(postcss.parse(rule)), /Unexpected color override/);
});

test('mixed flavors give each sidebar its own recessed surface', async () => {
  const css = postcss.parse((await compile('latte', source, library, 'mocha')).css);
  checkOverrides(css);
  for (const [mode, expected] of [['', '#cccccc'], ['.dark-mode', '#dddddd']]) {
    const values = [];
    css.walkRules((rule) => {
      if (postcss.list.comma(rule.selector).includes(`:root:root:root:root:root:where(:not(:has(> body.Page--error)))${mode} .project-nav__back`)) {
        for (const decl of rule.nodes) if (decl.prop === 'background-color') values.push(decl.value);
      }
    });
    assert.deepEqual(values, [expected]);
  }
});

test('sidebar allowlist validates each selector in mixed comma lists', () => {
  const allowed = ':root:root:root:root:root:where(:not(:has(> body.Page--error))) .project-nav__back';
  const unlisted = ':root:root:root:root:root:where(:not(:has(> body.Page--error))) .project-nav-other';
  for (const selectors of [`${allowed}, ${unlisted}`, `${unlisted}, ${allowed}`, `${allowed}, .project-nav__back`]) {
    assert.throws(() => checkOverrides(postcss.parse(`${selectors} {background-color:#abc}`)), /Unexpected color override/);
  }
  const icon = ':root:root:root:root:root:where(:not(:has(> body.Page--error))) .project-nav-ai-pr:is(:hover, :focus) .project-nav-ai-pr__icon.icon';
  for (const property of ['background', 'fill']) {
    assert.throws(() => checkOverrides(postcss.parse(`${icon} {${property}:#abc}`)), /Unexpected color override/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { selectorSpecificity, compare } from '@csstools/selector-specificity';
import { findDarkText, renderDarkText, replaceDarkText, blockStart, blockEnd } from '../scripts/dark-text.mjs';
import { checkOverrides } from '../scripts/compile.mjs';

const patterns = (sheets) => { const { a, b } = findDarkText(sheets); return { a, b }; };
const primary = 'color: var(--textColorPrimary)';

test('pattern A pairs exact selectors across sheets, lists, states and important declarations', () => {
  const result = patterns([
    '.pill, .pager:hover { color: var(--backgroundColorSchemeBase); }',
    `.dark-mode .pill, .dark-mode .pager:hover { ${primary} !important; }`,
  ]);
  assert.deepEqual(result, { a: ['.pager:hover', '.pill'], b: [] });
});

test('pattern B accepts only the specified accent families and excludes A duplicates', () => {
  const variables = ['defaultColorMain', 'defaultColorAccent', 'statusColor-1', 'commonColorGreen', 'warningColorScaleAccent', 'wikiActionColor', 'brandColorBacklog'];
  const css = variables.map((token, index) => `.item${index} { background-color: var(--${token}); } .dark-mode .item${index} { ${primary}; }`).join('\n');
  assert.deepEqual(patterns([css]).b, variables.map((_, index) => `.item${index}`));
  assert.deepEqual(patterns([`.same {color:var(--backgroundColorSchemeBase)} .dark-mode .same {${primary}; background-color:var(--defaultColorMain)}`]), { a: ['.same'], b: [] });
});

test('pattern B includes titles only when exact parent and light text share the accent scale', () => {
  const result = patterns([`
    .dark-mode .card { ${primary}; background-color:var(--warningColorScaleAccent) }
    .card .title {color:var(--warningColorScaleText)}
    .dark-mode .card .title {${primary}}
    .card .nested .title {color:var(--warningColorScaleText)}
    .dark-mode .card .nested .title {${primary}}
    .other .title {color:var(--successColorScaleText)}
    .dark-mode .other {${primary}; background-color:var(--warningColorScaleAccent)}
    .dark-mode .other .title {${primary}}
  `]);
  assert.deepEqual(result, { a: [], b: ['.card', '.card .title', '.other'] });
});

test('near misses do not pair selectors, properties, modes, tokens or conditional contexts', () => {
  assert.deepEqual(patterns([`
    .plain {color:var(--backgroundColorSchemeBase)} .dark-mode .different {${primary}}
    .dark-mode .only-dark {color:var(--backgroundColorSchemeBase)} .dark-mode .only-dark {${primary}}
    .fallback {color:var(--backgroundColorSchemeBase, red)} .dark-mode .fallback {${primary}}
    .wrong {color:var(--backgroundColorSchemeBase)} .dark-mode .wrong {color:var(--textColorDefault)}
    .dark-mode .surface {${primary}; background-color:var(--backgroundColorBase)}
    .dark-mode .suffix {${primary}; background-color:var(--defaultColorMainInverse)}
    .dark-mode .function {${primary}; background-color:rgb(var(--commonColorGreen-rgb))}
    .dark-mode .shorthand {${primary}; background:var(--defaultColorAccent)}
    .dark-mode .nested-dark .dark-mode .item {${primary}; background-color:var(--defaultColorAccent)}
    @media (min-width:1px) {.media {color:var(--backgroundColorSchemeBase)}}
    @media (min-width:2px) {.dark-mode .media {${primary}}}
    .nested { .child { color:var(--backgroundColorSchemeBase) } }
  `]), { a: [], b: [] });
});

test('same conditional context matches and selector commas within functions remain intact', () => {
  const result = patterns([`@media (min-width:1px) { .pill:is(:hover, :focus) {color:var(--backgroundColorSchemeBase)} .dark-mode .pill:is(:hover, :focus) {${primary}} }`]);
  assert.deepEqual(result.a, ['.pill:is(:hover, :focus)']);
  const full = findDarkText([`@media (min-width:1px) { .pill {color:var(--backgroundColorSchemeBase)} .dark-mode .pill {${primary}} }`]);
  assert.match(renderDarkText(full), /@media \(min-width:1px\) \{[\s\S]*\.dark-mode \.pill/);
});

test('generated block is stable, deduplicated, and replacement leaves surrounding text alone', () => {
  const block = renderDarkText({ overrides: ['.z', '.a', '.z'].map((selector) => ({ selector: `.dark-mode ${selector}`, important: false, context: [] })) });
  assert.equal(block, `${blockStart}\n    .dark-mode .a,\n    .dark-mode .z {\n      color: var(--backgroundColorSchemeBase);\n    }\n${blockEnd}`);
  const source = `before\n${blockStart}\nold\n${blockEnd}\nafter`;
  const updated = replaceDarkText(source, block);
  assert.equal(updated, `before\n${block}\nafter`);
  assert.equal(replaceDarkText(updated, block), updated);
  assert.throws(() => replaceDarkText('', block), /exactly one/);
  assert.throws(() => replaceDarkText(source + block, block), /exactly one/);
  assert.throws(() => renderDarkText({ overrides: [] }), /No dark-text/);
});

test('compiled override validation enforces dark-only text and light-only board scope', () => {
  checkOverrides(postcss.parse('.dark-mode .pill--square.-subtasking {color:var(--textColorWeak)} .dark-mode .text {color:var(--backgroundColorSchemeBase)} .dark-mode .pill {color:var(--backgroundColorSchemeBase)!important} :root:not(.dark-mode) body.Page--view-kanban .card {background-color:var(--backgroundColorSchemeBase)}'));
  for (const css of ['.dark-mode .other {color:var(--textColorWeak)}', '.pill {color:var(--backgroundColorSchemeBase)!important}', ':root:root:root:root:root.dark-mode .pill {color:var(--backgroundColorSchemeBase)}', '.card {background-color:var(--backgroundColorSchemeBase)}']) {
    assert.throws(() => checkOverrides(postcss.parse(css)), /Unexpected color override/);
  }
});


test('site state specificity keeps winning and only site important declarations stay important', () => {
  const site = `.project-nav-list__text, .pill {color:var(--backgroundColorSchemeBase)}
    .dark-mode  .project-nav-list__text {${primary}}
    .dark-mode .project-nav-list__link:is(.is_active, :hover) .project-nav-list__text {${primary}}
    .dark-mode .pill {${primary} !important}`;
  const result = findDarkText([site]);
  const block = renderDarkText(result);
  assert.match(block, /\.dark-mode  \.project-nav-list__text/);
  const rules = [];
  postcss.parse(block.replaceAll(/^[ \t]*\/\/.*$/gm, '')).walkRules((rule) => rules.push(rule));
  const normal = rules.find((rule) => rule.selector.includes('project-nav-list__text'));
  assert.equal(Boolean(normal.first.important), false);
  assert.ok(rules.find((rule) => rule.selector === '.dark-mode .pill').first.important);
  assert.ok(!block.includes(':root'));
  // Calculate the cascade for the matching active/hover state, including source order.
  const matching = [];
  postcss.parse(`${site}\n${block.replaceAll(/^[ \t]*\/\/.*$/gm, '')}`).walkRules((rule) => {
    for (const selector of postcss.list.comma(rule.selector)) {
      if (selector.endsWith('.project-nav-list__text')) matching.push({ selector, decl: rule.first });
    }
  });
  matching.sort((x, y) => compare(selectorSpecificity(selectorParser().astSync(x.selector)), selectorSpecificity(selectorParser().astSync(y.selector))));
  assert.equal(matching.at(-1).decl.value, 'var(--textColorPrimary)');
});

test('conflict report includes equal and greater BEM variants, excluding dark and unrelated blocks', () => {
  const result = findDarkText([`.pill {color:var(--backgroundColorSchemeBase)}
    .dark-mode .pill {${primary}}
    .pill--square.-subtasking {color:var(--textColorWeak);background-color:transparent}
    .pill--square:where(.weak) {${primary}}
    #menu .pill__label {${primary}}
    .other.is_active {${primary}}
    .dark-mode .pill:hover {${primary}}`]);
  assert.deepEqual(result.conflicts.map(({selector}) => selector), ['#menu .pill__label', '.pill--square.-subtasking']);
});

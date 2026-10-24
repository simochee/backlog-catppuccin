import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { selectorSpecificity, compare } from '@csstools/selector-specificity';
import { findDarkText, renderDarkText, replaceDarkText, blockStart, blockEnd, guardDarkSelector } from '../scripts/dark-text.mjs';
import less from 'less';
import { newDesignMarker } from '../scripts/guards.mjs';
import { legacyDarkScope, legacyScope, checkOverrides } from '../scripts/compile.mjs';

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
    .dark-mode .shorthand {${primary}; background:var(--backgroundColorBase)}
    .dark-mode .nested-dark .dark-mode .item {${primary}; background-color:var(--defaultColorAccent)}
    @media (min-width:1px) {.media {color:var(--backgroundColorSchemeBase)}}
    @media (min-width:2px) {.dark-mode .media {${primary}}}
    .nested { .child { color:var(--backgroundColorSchemeBase) } }
  `]), { a: [], b: [] });
});

test('same conditional context matches and selector commas within functions remain intact', () => {
  const result = patterns([`@media (min-width:1px) { .pill:is(:hover, :focus) {color:var(--backgroundColorSchemeBase)} .dark-mode .pill:is(:hover, :focus) {${primary}} }`]);
  assert.deepEqual(result.a, ['.pill:is(:hover,:focus)']);
  const full = findDarkText([`@media (min-width:1px) { .pill {color:var(--backgroundColorSchemeBase)} .dark-mode .pill {${primary}} }`]);
  assert.match(renderDarkText(full), /@media \(min-width:1px\) \{[\s\S]*\.dark-mode:where\(.* \.pill/);
});

test('generated block is stable, deduplicated, and replacement leaves surrounding text alone', () => {
  const renderedScope = legacyDarkScope.replace(':has(> head > link[href*="/styles_nu-ui/"])', '@{newDesignMarker}');
  const block = renderDarkText({ overrides: ['.z', '.a', '.z'].map((selector) => ({ selector: `.dark-mode ${selector}`, important: false, context: [] })) });
  assert.equal(block, `${blockStart}\n    ${renderedScope} .a,\n    ${renderedScope} .z {\n      color: var(--backgroundColorSchemeBase);\n    }\n${blockEnd}`);
  const source = `before\n${blockStart}\nold\n${blockEnd}\nafter`;
  const updated = replaceDarkText(source, block);
  assert.equal(updated, `before\n${block}\nafter`);
  assert.equal(replaceDarkText(updated, block), updated);
  assert.throws(() => replaceDarkText('', block), /exactly one/);
  assert.throws(() => replaceDarkText(source + block, block), /exactly one/);
  assert.throws(() => renderDarkText({ overrides: [] }), /No dark-text/);
});

test('compiled override validation enforces dark-only text and light-only board scope', () => {
  checkOverrides(postcss.parse(`${legacyDarkScope} .pill--square.-subtasking {color:var(--textColorWeak)} ${legacyDarkScope} .text {color:var(--backgroundColorSchemeBase)} ${legacyDarkScope} .pill {color:var(--backgroundColorSchemeBase)!important} ${legacyScope}:not(.dark-mode) body.Page--view-kanban .card {background-color:var(--backgroundColorSchemeBase)}`));
  for (const css of ['.dark-mode .other {color:var(--textColorWeak)}', '.pill {color:var(--backgroundColorSchemeBase)!important}', ':root:root:root:root:root.dark-mode .pill {color:var(--backgroundColorSchemeBase)}', '.card {background-color:var(--backgroundColorSchemeBase)}']) {
    assert.throws(() => checkOverrides(postcss.parse(css)), /Unexpected color override/);
  }
});

test('project navigation subjects are excluded from both patterns across contexts', () => {
  const sidebar = ['.project-nav', '.project-nav__back', '.project-nav-list__text',
    '.project-nav-list__link#navi-document .project-nav-list__beta',
    '.project-nav-ai-pr:hover'];
  const css = sidebar.map((selector) => `${selector} {color:var(--backgroundColorSchemeBase);background:var(--defaultColorMain)}
    .dark-mode ${selector} {${primary} !important}`).join('\n');
  const result = findDarkText([`${css} @media print {${css}}
    .project-navigation {color:var(--backgroundColorSchemeBase)}
    .dark-mode .project-navigation {${primary}}`]);
  assert.deepEqual(result.a, ['.project-navigation']);
  assert.deepEqual(result.b, []);
  assert.equal(result.overrides.length, 1);
  assert.equal(result.overrides[0].selector, '.dark-mode .project-navigation');
});

test('accent descendants of project navigation are emitted and excluded subjects remain conflict candidates', () => {
  const result = findDarkText([`
    .dark-mode .project-nav .pill {${primary}; background-color:var(--defaultColorMain)}
    .pill.project-nav-list__text:hover {${primary}}
    .dark-mode .pill.project-nav-list__text:hover {${primary}; background-color:var(--defaultColorMain)}
  `]);
  assert.deepEqual(result.b, ['.project-nav .pill']);
  assert.deepEqual(result.overrides.map(({ selector }) => selector), ['.dark-mode .project-nav .pill']);
  assert.ok(result.conflicts.some(({ selector }) => selector === '.pill.project-nav-list__text:hover'));
});

test('sidebar exclusion identifies classes rather than similar names or attribute values', () => {
  const selectors = ['.project-navigation', '.project-navlist', '[data-label=".project-nav"]'];
  const css = selectors.map((selector) => `${selector} {color:var(--backgroundColorSchemeBase)}
    .dark-mode ${selector} {${primary}}`).join('\n');
  assert.deepEqual(patterns([css]), { a: selectors, b: [] });
});

test('generated selectors preserve site specificity, ancestor scope and importance', async () => {
  const result = findDarkText([`.menu__text, .pill {color:var(--backgroundColorSchemeBase)}
    .dark-mode .menu__text {${primary}}
    .dark-mode .pill {${primary} !important}`]);
  const block = renderDarkText(result);
  const { css } = await less.render(`@newDesignMarker: ~'${newDesignMarker}';\n${block}`);
  const rules = [];
  postcss.parse(css).walkRules((rule) => rules.push(rule));
  const specificity = (selector) => selectorSpecificity(selectorParser().astSync(selector).first);
  for (const { selector, important } of result.overrides) {
    const guarded = guardDarkSelector(selector);
    const rule = rules.find((rule) => rule.selector === guarded);
    assert.ok(rule, guarded);
    assert.equal(Boolean(rule.first.important), important);
    const before = specificity(selector);
    assert.deepEqual(specificity(guarded), before);
  }
  checkOverrides(postcss.parse(css));
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

test('override emission requires qualification in its own conditional context', () => {
  const result = findDarkText([`.pill {color:var(--backgroundColorSchemeBase)}
    .dark-mode .pill {${primary}}
    @media print {.dark-mode .pill {${primary} !important}}
    @supports (display:grid) {.dark-mode .pill {${primary};background:var(--defaultColorMain)}}`]);
  assert.deepEqual(result.overrides.map(({ context }) => context), [[['supports', '(display:grid)']], []]);
  assert.ok(!renderDarkText(result).includes('@media print'));
});

test('pairing and output normalize whitespace and combinators without altering attribute values', async () => {
  const result = findDarkText([`.list  > .item + .next ~ [title="two  words"] {color:var(--backgroundColorSchemeBase)}
    .dark-mode   .list>.item+.next~[title="two  words"] {${primary}}`]);
  assert.deepEqual(result.a, ['.list>.item+.next~[title="two  words"]']);
  assert.equal(result.overrides[0].selector, '.dark-mode .list>.item+.next~[title="two  words"]');
  checkOverrides(postcss.parse((await less.render(`@newDesignMarker: ~'${newDesignMarker}';\n${renderDarkText(result)}`)).css));
});

test('accent background shorthands qualify including additional background components', () => {
  const result = patterns([`.dark-mode .shorthand {${primary}; background:var(--defaultColorAccent)}
    .dark-mode .positioned {${primary}; background:var(--commonColorGreen) center / cover no-repeat}`]);
  assert.deepEqual(result, { a: [], b: ['.positioned', '.shorthand'] });
});

test('unsupported selectors warn once and do not stop generation or advisory conflicts', (t) => {
  const warnings = [];
  t.mock.method(console, 'error', (message) => warnings.push(message));
  const result = findDarkText([`.pill, .broken: {color:var(--backgroundColorSchemeBase)}
    .dark-mode .pill, .dark-mode .broken: {${primary}}
    #menu .pill__label {${primary}}`]);
  assert.ok(renderDarkText(result).includes(`${legacyDarkScope.replace(':has(> head > link[href*="/styles_nu-ui/"])', '@{newDesignMarker}')} .pill`));
  assert.ok(result.conflicts.some(({ selector }) => selector === '#menu .pill__label'));
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((warning) => warning.includes('skipped selector in conflict report')));
});

test('site state specificity keeps winning', async () => {
  const result = findDarkText([`.button--primary {color:var(--backgroundColorSchemeBase)}
    .dark-mode .button--primary {${primary}}
    .button--primary.is_disabled[disabled] {color:var(--textColorWeak)}`]);
  const css = postcss.parse((await less.render(`@newDesignMarker: ~'${newDesignMarker}';\n${renderDarkText(result)}`)).css);
  const generated = selectorParser().astSync(css.first.selector).first;
  const state = selectorParser().astSync('.button--primary.is_disabled[disabled]').first;
  assert.ok(compare(selectorSpecificity(state), selectorSpecificity(generated)) > 0);
  assert.ok(result.conflicts.some(({ selector }) => selector === state.toString()));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { findDarkText, renderDarkText, replaceDarkText, blockStart, blockEnd } from '../scripts/dark-text.mjs';
import { checkOverrides } from '../scripts/compile.mjs';

const primary = 'color: var(--textColorPrimary)';

test('pattern A pairs exact selectors across sheets, lists, states and important declarations', () => {
  const result = findDarkText([
    '.pill, .pager:hover { color: var(--backgroundColorSchemeBase); }',
    `.dark-mode .pill, .dark-mode .pager:hover { ${primary} !important; }`,
  ]);
  assert.deepEqual(result, { a: ['.pager:hover', '.pill'], b: [] });
});

test('pattern B accepts only the specified accent families and excludes A duplicates', () => {
  const variables = ['defaultColorMain', 'defaultColorAccent', 'statusColor-1', 'commonColorGreen', 'warningColorScaleAccent', 'wikiActionColor', 'brandColorBacklog'];
  const css = variables.map((token, index) => `.item${index} { background-color: var(--${token}); } .dark-mode .item${index} { ${primary}; }`).join('\n');
  assert.deepEqual(findDarkText([css]).b, variables.map((_, index) => `.item${index}`));
  assert.deepEqual(findDarkText([`.same {color:var(--backgroundColorSchemeBase)} .dark-mode .same {${primary}; background-color:var(--defaultColorMain)}`]), { a: ['.same'], b: [] });
});

test('pattern B includes titles only when exact parent and light text share the accent scale', () => {
  const result = findDarkText([`
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
  assert.deepEqual(findDarkText([`
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
  const result = findDarkText([`@media (min-width:1px) { .pill:is(:hover, :focus) {color:var(--backgroundColorSchemeBase)} .dark-mode .pill:is(:hover, :focus) {${primary}} }`]);
  assert.deepEqual(result.a, ['.pill:is(:hover, :focus)']);
});

test('generated block is stable, deduplicated, and replacement leaves surrounding text alone', () => {
  const block = renderDarkText({ a: ['.z', '.a'], b: ['.z'] });
  assert.equal(block, `${blockStart}\n    .a,\n    .z {\n      color: var(--backgroundColorSchemeBase) !important;\n    }\n${blockEnd}`);
  const source = `before\n${blockStart}\nold\n${blockEnd}\nafter`;
  const updated = replaceDarkText(source, block);
  assert.equal(updated, `before\n${block}\nafter`);
  assert.equal(replaceDarkText(updated, block), updated);
  assert.throws(() => replaceDarkText('', block), /exactly one/);
  assert.throws(() => replaceDarkText(source + block, block), /exactly one/);
  assert.throws(() => renderDarkText({ a: [], b: [] }), /No dark-text/);
});

test('compiled override validation enforces dark-only text and light-only board scope', () => {
  checkOverrides(postcss.parse(':root:root:root:root:root.dark-mode .pill {color:var(--backgroundColorSchemeBase)!important} :root:not(.dark-mode) body.Page--view-kanban .card {background-color:var(--backgroundColorSchemeBase)}'));
  for (const css of ['.pill {color:var(--backgroundColorSchemeBase)!important}', ':root:root:root:root:root.dark-mode .pill {color:var(--backgroundColorSchemeBase)}', '.card {background-color:var(--backgroundColorSchemeBase)}']) {
    assert.throws(() => checkOverrides(postcss.parse(css)), /Unexpected color override/);
  }
});

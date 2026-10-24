import test from 'node:test';
import assert from 'node:assert/strict';
import { findLiterals, renderLiterals, rankSelectors } from '../scripts/literals.mjs';

const fixture = `
  .widget, .widget__title { color: red; background-image: linear-gradient(45deg, blue, green); }
  .widget--selected { border-color: #123456; outline-color: hsl(0 0% 50%); }
  .icon { fill: rgb(1, 2, 3); stroke: transparent; }
  .tokens { color: var(--ink, red); background: url('/red'); fill: currentColor; stroke: rgba(var(--ink-rgb), .5); width: 3px; }
  .overridden { color: blue; border-left-color: green; background-image: linear-gradient(red, blue); }
  .dark-mode .overridden { color: red; }
  .important { color: red !important; }
  @media print { .conditional { color: blue; } }
  .conditional { color: red; }
`;
const overrides = `
  :root:root:root:root:root .overridden { color: var(--ink); border-color: var(--accent); background-image: none; }
  .important { color: var(--ink); }
  @media print { .conditional { color: var(--ink); } }
`;

test('reports only literal color properties and excludes covered properties and vendor bundles', () => {
  const sources = [{ url: 'https://assets.backlog.com/styles/Common.css', css: fixture },
    ...['tooltipster', 'introjs', 'photoswipe', 'smartbanner', 'prettify'].map((name) => ({ url: `https://assets.backlog.com/${name}.css`, css: '.vendor {color:red}' }))];
  const report = findLiterals(sources, overrides);
  assert.equal(report.length, 1);
  assert.deepEqual(report[0].selectors.map(({ selector }) => selector),
    ['.conditional', '.icon', '.important', '.tokens', '.widget', '.widget__title', '.widget--selected']);
  assert.deepEqual(report[0].selectors.find(({ selector }) => selector === '.widget').declarations,
    [{ property: 'color', kind: 'solid' }, { property: 'background-image', kind: 'gradient' }]);
  const rendered = renderLiterals(report);
  assert.match(rendered, /Summary: 1 stylesheets; 7 selector groups; 11 property\/kind entries/);
  assert.doesNotMatch(rendered, /#123456|rgb\(|hsl\(|45deg|\b(?:red|blue|green)\b/);
  assert.deepEqual(rankSelectors(report, 1), [{ selector: '.widget', block: 'widget', count: 3 }]);
});

test('exclusions respect appearance, conditions, importance and property boundaries', () => {
  const report = findLiterals([{ url: 'https://assets.backlog.com/main.css', css:
    '.item { color: red; background-color: red; } .dark-mode .item { color: blue; }' }],
  ':root:root:root:root:root.dark-mode .item { color: var(--ink); }');
  assert.deepEqual(report[0].selectors, [{ selector: '.item', declarations:
    [{ property: 'color', kind: 'solid' }, { property: 'background-color', kind: 'solid' }] }]);
});

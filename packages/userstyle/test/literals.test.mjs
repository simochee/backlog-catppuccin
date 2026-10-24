import { test } from 'vite-plus/test';
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
  const sources = [
    { url: 'https://assets.backlog.com/styles/Common.css', css: fixture },
    ...['tooltipster', 'introjs', 'photoswipe', 'smartbanner', 'prettify'].map((name) => ({
      url: `https://assets.backlog.com/${name}.css`,
      css: '.vendor {color:red}',
    })),
  ];
  const report = findLiterals(sources, overrides);
  assert.equal(report.length, 1);
  assert.deepEqual(
    report[0].selectors.map(({ selector }) => selector),
    [
      '.conditional',
      '.icon',
      '.important',
      '.tokens',
      '.widget',
      '.widget--selected',
      '.widget__title',
    ],
  );
  assert.deepEqual(
    report[0].selectors.find(({ selector }) => selector === '.widget').declarations,
    [
      { property: 'color', kind: 'solid' },
      { property: 'background-image', kind: 'gradient' },
    ],
  );
  const rendered = renderLiterals(report);
  assert.match(rendered, /Summary: 1 stylesheets; 7 selector groups; 11 property\/kind entries/);
  assert.doesNotMatch(rendered, /#123456|rgb\(|hsl\(|45deg|\b(?:red|blue|green)\b/);
  assert.deepEqual(rankSelectors(report, 1), [{ selector: '.widget', block: 'widget', count: 3 }]);
});

test('exclusions respect appearance, conditions, importance and property boundaries', () => {
  const report = findLiterals(
    [
      {
        url: 'https://assets.backlog.com/main.css',
        css: '.item { color: red; background-color: red; } .dark-mode .item { color: blue; }',
      },
    ],
    ':root:root:root:root:root.dark-mode .item { color: var(--ink); }',
  );
  assert.deepEqual(report[0].selectors, [
    {
      selector: '.item',
      declarations: [
        { property: 'color', kind: 'solid' },
        { property: 'background-color', kind: 'solid' },
      ],
    },
  ]);
});

function inspect(css, overrides = '') {
  return findLiterals([{ url: 'https://assets.backlog.com/main.css', css }], overrides);
}

test('reports color-bearing shorthands and shadow kinds without values', () => {
  const solids = [
    'border',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'outline',
    'text-decoration',
    'text-decoration-color',
    'caret-color',
    'accent-color',
    'column-rule',
  ];
  const css = `.sample { ${solids.map((property) => `${property}: red;`).join(' ')}
    box-shadow: 0 1px 2px rgb(1 2 3); text-shadow: 1px 1px blue; }`;
  const report = inspect(css);
  assert.deepEqual(report[0].selectors[0].declarations, [
    ...solids.map((property) => ({ property, kind: 'solid' })),
    ...['box-shadow', 'text-shadow'].map((property) => ({ property, kind: 'shadow' })),
  ]);
  assert.doesNotMatch(renderLiterals(report), /\bred\b|\bblue\b|rgb\(|\dpx/);
});

test('skips keyframes and non-selector at-rules while retaining conditional selectors', () => {
  const report = inspect(`
    @keyframes pulse { from {color:red} 50% {color:blue} to {color:green} }
    @-webkit-keyframes pulse { from {color:red} }
    @font-feature-values Example { @styleset { nice {color:red} } }
    @media screen { @supports (display: grid) { .media {color:red} } }
    @container panel (width > 10px) { .container {color:red} }
    @layer theme { .layer {color:red} }
  `);
  assert.deepEqual(
    report[0].selectors.map(({ selector }) => selector),
    ['.container', '.layer', '.media'],
  );
  assert.equal(
    inspect('.sample {color:red}', '@keyframes pulse { .sample {color:var(--ink)} }').length,
    1,
  );
});

test('classifies literal channels with variable alpha and literal mix arguments', () => {
  for (const value of [
    'rgb(1 2 3 / var(--alpha))',
    'rgba(1, 2, 3, var(--alpha))',
    'hsl(0 50% 50% / var(--alpha))',
    'color(srgb 0 0 0 / var(--alpha))',
    'color-mix(in srgb, red, var(--ink))',
    'color-mix(in srgb, rgb(1 2 3), var(--ink))',
    'light-dark(var(--ink), #abc)',
  ]) {
    assert.deepEqual(inspect(`.sample {color:${value}}`)[0].selectors[0].declarations, [
      { property: 'color', kind: 'solid' },
    ]);
  }
  for (const value of [
    'rgba(var(--rgb), var(--alpha))',
    'rgb(var(--rgb) / .5)',
    'color-mix(in srgb, var(--ink), var(--paper))',
    'light-dark(var(--ink), var(--paper))',
  ]) {
    assert.deepEqual(inspect(`.sample {color:${value}}`), []);
  }
});

test('ranks only classes directly in the subject compound using code-unit order', () => {
  const selectors = [
    '.ancestor .widget:not(.other)',
    '.widget__title:is(.other)',
    '.widget--active:where(.other):has(.child)',
    '.ancestor>span:not(.widget)',
    '.Widget',
    '.widget',
  ];
  const report = inspect(selectors.map((selector) => `${selector} {color:red}`).join(' '));
  assert.deepEqual(
    report[0].selectors.map(({ selector }) => selector),
    [...selectors].sort(),
  );
  const ranking = rankSelectors(report);
  for (const selector of selectors.filter(
    (selector) => selector.includes('.widget') && !selector.includes('span'),
  )) {
    assert.deepEqual(
      ranking.find((entry) => entry.selector === selector),
      { selector, block: 'widget', count: 4 },
    );
  }
  assert.equal(
    ranking.find((entry) => entry.selector.includes('span')).block,
    '.ancestor>span:not(.widget)',
  );
  assert.deepEqual(
    ranking.filter(({ count }) => count === 4).map(({ selector }) => selector),
    selectors
      .filter((selector) => selector.includes('.widget') && !selector.includes('span'))
      .sort(),
  );
});

test('guarded overrides still cover non-error component literals', () => {
  const report = findLiterals(
    [
      {
        url: 'https://assets.backlog.com/test.css',
        css: '.dark-mode .pill {color:red} .choice {border-color:red}',
      },
    ],
    `
    .dark-mode:where(:not(:has(> body.Page--error))) .pill {color:var(--backgroundColorSchemeBase)}
    :root:root:root:root:root:where(:not(:has(> body.Page--error))) .choice {border-color:var(--defaultColorAccent)}
  `,
  );
  assert.deepEqual(report, []);
});

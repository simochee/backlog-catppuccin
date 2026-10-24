import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import postcss from 'postcss';
import { compile, checkWeakTokens, checkErrorPageExclusion, errorPageScope, checkOverrides, checkNeutralOrder, parseColor, checkRGBCounterpart } from '../scripts/compile.mjs';
import expectedOrder from './fixtures/neutral-order.json' with { type: 'json' };
import { blockStart, blockEnd } from '../scripts/dark-text.mjs';

const importLine = '@import "https://userstyles.catppuccin.com/lib/std/v1.less";';

test('library insertion preserves replacement dollar sequences and requires the import', async () => {
  const library = '.test { --literal: "$& $$ $\' $`"; }';
  const { css } = await compile('latte', importLine, library);
  assert.ok(css.includes('"$& $$ $\' $`"'));
  await assert.rejects(compile('latte', ':root {}', library), /@import line not found/);
});

test('CLI checks execute from a path containing spaces and URL-encoded characters', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'catppuccin space # 日本語-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory, 'test/fixtures'), { recursive: true });
  await copyFile(new URL('./fixtures/neutral-order.json', import.meta.url), join(directory, 'test/fixtures/neutral-order.json'));
  for (const file of ['compile.mjs', 'coverage.mjs', 'source.mjs', 'dark-text.mjs', 'literals.mjs']) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(directory, 'scripts', file));
  }
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
  const assignments = (flavor) => Object.entries(surfaceValues(flavor))
    .map(([name, value]) => `${name}: ${value};`).join(' ');
  await writeFile(join(directory, 'catppuccin.user.less'), `${importLine}
    .fixture() when (@flavor = latte) { ${assignments('latte')} }
    .fixture() when not (@flavor = latte) { ${assignments('mocha')} }
    .theme(@flavor) { .fixture(); }
    ${errorPageScope} { .theme(@lightFlavor); }
    ${errorPageScope}.dark-mode { .theme(@darkFlavor); }`);
  await writeFile(join(directory, 'mock-fetch.mjs'), `globalThis.fetch = async (url) => new Response(
    String(url).endsWith('.less') ? '/* fixture library */' :
    String(url).endsWith('.css') ? ':root { --backgroundColorBase: red; }' :
    String(url) === process.env.BACKLOG_PAGE_URL ? '<link rel="stylesheet" href="https://assets.backlog.com/fixture.css">' :
    (() => { throw new Error('Unexpected discovery page'); })());`);
  for (const [script, expected] of [
    ['compile', /mocha: PASS[\s\S]*Independent light\/dark switching.*PASS/],
    ['coverage', /1 assignable; 0 unassigned/],
    ['literals', /Summary: 0 stylesheets; 0 selector groups; 0 property\/kind entries/],
  ]) {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', pathToFileURL(join(directory, 'mock-fetch.mjs')).href, join(directory, 'scripts', `${script}.mjs`)], { env: { ...process.env, BACKLOG_PAGE_URL: 'https://simochee.backlog.com/fixture-page' } });
    assert.match(stdout, expected);
    if (script === 'compile') {
      for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
        assert.match(stdout, new RegExp(`${flavor}: PASS[^\\n]*\\n${flavor} neutral ordering: PASS`));
      }
    }
  }
  await writeFile(join(directory, 'failed-fetch.mjs'), `globalThis.fetch = async () => { throw new Error('fixture download failure'); };`);
  await assert.rejects(promisify(execFile)(process.execPath,
    ['--import', pathToFileURL(join(directory, 'failed-fetch.mjs')).href, join(directory, 'scripts/literals.mjs')]),
    (error) => /Literal report failed \(load stylesheets\): fixture download failure/.test(error.stderr));
  const file = join(directory, 'catppuccin.user.less');
  await writeFile(file, `${blockStart}\n${blockEnd}`);
  await writeFile(join(directory, 'mock-dark-fetch.mjs'), `globalThis.fetch = async (url) => new Response(
    String(url).endsWith('.css') ? '.pill {color:var(--backgroundColorSchemeBase)} .dark-mode .pill {color:var(--textColorPrimary)}' :
    '<link rel="stylesheet" href="https://assets.backlog.com/fixture.css">');`);
  const args = ['--import', pathToFileURL(join(directory, 'mock-dark-fetch.mjs')).href, join(directory, 'scripts/dark-text.mjs')];
  const run = promisify(execFile);
  await assert.rejects(run(process.execPath, [...args, '--check']), /out of date/);
  await run(process.execPath, args);
  const { stdout } = await run(process.execPath, [...args, '--check']);
  assert.match(stdout, /Pattern A \(1\):\n.pill[\s\S]*up to date/);
});

function surfaceValues(flavor = 'latte') {
  const spec = expectedOrder[flavor === 'latte' ? 'latte' : 'dark'];
  const shades = flavor === 'latte'
    ? ['#fefefe', '#eeeeee', '#dddddd', '#cccccc', '#bbbbbb', '#aaaaaa']
    : ['#111111', '#222222', '#333333', '#444444', '#555555'];
  return Object.fromEntries([
    ...spec.order.flatMap((group, index) => group.map((name) => [name, shades[index]])),
    ['--borderColorDefault', '#bbbbbb'],
    ['--iconColorWeak', '#777777'],
    ['--textColorWeak', '#aaaaaa'],
  ]);
}

function surfaces(values = surfaceValues()) {
  return postcss.parse(`:root { ${Object.entries(values).map(([name, value]) => `${name}: ${value};`).join(' ')} }`);
}

test('latte keeps inputs lighter than the page', () => {
  assert.doesNotThrow(() => checkNeutralOrder(surfaces(), 'latte'));
  const values = surfaceValues();
  values['--backgroundColorSchemeBase'] = '#dddddd';
  assert.throws(() => checkNeutralOrder(surfaces(values), 'latte'), /--backgroundColorSchemeBase.*--backgroundColorWeakOnBaseBG/);
});

for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
  test(`${flavor} checks every adjacent neutral rank in its palette direction`, () => {
    assert.doesNotThrow(() => checkNeutralOrder(surfaces(surfaceValues(flavor)), flavor));
    const names = expectedOrder[flavor === 'latte' ? 'latte' : 'dark'].order.flat();
    for (let index = 1; index < names.length; index++) {
      const values = surfaceValues(flavor);
      values[names[index]] = flavor === 'latte' ? '#ffffff' : '#000000';
      assert.throws(() => checkNeutralOrder(surfaces(values), flavor), (error) => error.message.includes(names[index]));
    }
  });
}

for (const [left, right] of expectedOrder.latte.distinct) {
  test(`latte keeps ${left} distinct from ${right}`, () => {
    const values = surfaceValues();
    const names = expectedOrder.latte.order.flat();
    if (names.includes(right)) {
      for (const name of names.slice(names.indexOf(left), names.indexOf(right))) values[name] = values[right];
    } else {
      values[left] = values[right];
    }
    assert.throws(() => checkNeutralOrder(surfaces(values), 'latte'), (error) =>
      error.message.includes('states must differ') && error.message.includes(left) && error.message.includes(right));
  });
}

test('latte rejects completely flat neutral surfaces', () => {
  const values = Object.fromEntries(Object.keys(surfaceValues()).map((name) => [name, '#eee']));
  assert.throws(() => checkNeutralOrder(surfaces(values), 'latte'), /--backgroundColorDisabled.*--backgroundColorHover/);
});

test('neutral ordering names missing properties', () => {
  for (const name of Object.keys(surfaceValues()).filter((name) => !['--iconColorWeak', '--textColorWeak'].includes(name))) {
    const values = surfaceValues();
    delete values[name];
    assert.throws(() => checkNeutralOrder(surfaces(values), 'latte'), (error) => error.message.includes(name));
  }
  assert.throws(() => checkNeutralOrder(postcss.parse(':root {}'), 'latte'), /--backgroundColorSchemeBase/);
});

for (const color of ['#abc', '#aabbcc', 'rgb(170, 187, 204)', 'rgba(170, 187, 204, 0.5)']) {
  test(`color parsing and RGB counterparts accept ${color}`, () => {
    assert.deepEqual(parseColor(color, '--example'), [170, 187, 204]);
    const css = postcss.parse(`:root { --example: ${color}; --example-rgb: 170, 187, 204; }`);
    assert.doesNotThrow(() => css.walkDecls(checkRGBCounterpart));
    const values = surfaceValues();
    values['--backgroundColorHighlightUpdate'] = color;
    assert.doesNotThrow(() => checkNeutralOrder(surfaces(values), 'latte'));
  });
}

test('invalid colors name their property', () => {
  for (const color of ['no-color', '#abcd', 'rgb(256, 0, 0)', 'rgba(0, 0, 0, 2)', 'rgb(1, 2)']) {
    assert.throws(() => parseColor(color, '--example'), /--example/);
  }
});

test('RGB checks name mismatched and missing counterparts', () => {
  for (const declarations of ['--example: #abc; --example-rgb: 0, 0, 0;', '--example-rgb: 0, 0, 0;']) {
    assert.throws(() => postcss.parse(`:root { ${declarations} }`).walkDecls(checkRGBCounterpart), /--example/);
  }
});

const scope = ':root:not(:has(> body.Page--error)):root:root:root:root';
for (const color of ['#abc', '#aabbcc', 'rgb(10, 20, 30)', 'rgba(10, 20, 30, 0.5)', 'hsl(120, 50%, 50%)', 'rgb(10 20 30 / 50%)', 'hsl(120 50% 50%)']) {
  test(`override allowlist accepts themed colors in ${color}`, () => {
    for (const prefix of [scope, `${scope}.dark-mode`, `${scope} body:not(.Page--error)`]) {
      assert.doesNotThrow(() => checkOverrides(postcss.parse(`
        ${prefix} .na-choice-box.is_active { border-color: ${color}; }
        ${prefix} .upgrade-bar.generic-cta-bar { background-image: linear-gradient(45deg, ${color}, ${color}); }
      `)));
    }
  });
}

test('override allowlist rejects mismatched selectors, values and unlisted properties', () => {
  for (const css of [
    `${scope} .other { border-color: #abc; }`,
    `${scope} .na-choice-box.is_active, .other { border-color: #abc; }`,
    '.na-choice-box.is_active { border-color: #abc; }',
    `${scope} .na-choice-box.is_active { border-color: var(--unexpected); }`,
    `${scope} .upgrade-bar.generic-cta-bar { background-image: linear-gradient(90deg, #abc, #def); }`,
    `${scope} .na-choice-box.is_active { color: #abc; }`,
    '.dark-mode .pill--square.-subtasking { color: var(--textColorWeak) !important; }',
  ]) assert.throws(() => checkOverrides(postcss.parse(css)), /Unexpected color override/);
});

test('override allowlist preserves token overrides and custom assignments', () => {
  assert.doesNotThrow(() => checkOverrides(postcss.parse(`
    :root { --example: #abc; }
    :root:not(:has(> body.Page--error)).dark-mode .example { color: var(--backgroundColorSchemeBase); }
    :root:not(:has(> body.Page--error)).dark-mode .pill--square.-subtasking { color: var(--textColorWeak); }
    :root:not(:has(> body.Page--error)):not(.dark-mode) body.Page--view-kanban .card { background-color: var(--backgroundColorSchemeBase); }
  `)));
});

test('error-page exclusion rejects any unguarded selector, including mixed lists and nested contexts', () => {
  for (const selector of [':root', 'body:not(.Page--error)', '.dark-mode .pill', `${errorPageScope}, .pill`, `[title="${errorPageScope}"]`]) {
    assert.throws(() => checkErrorPageExclusion(postcss.parse(`@media screen {${selector} {--example:red}}`)), /Missing error-page guard/);
  }
  assert.doesNotThrow(() => checkErrorPageExclusion(postcss.parse(`${errorPageScope}, ${errorPageScope}.dark-mode .pill {--example:red}`)));
});

test('weak tokens must both exist and differ even with equivalent color syntax', () => {
  assert.doesNotThrow(() => checkWeakTokens(surfaces()));
  for (const value of ['#aaa', '#aaaaaa', 'rgb(170, 170, 170)']) {
    const values = surfaceValues();
    values['--iconColorWeak'] = value;
    assert.throws(() => checkWeakTokens(surfaces(values)), /Weak tokens must differ/);
  }
  for (const token of ['--iconColorWeak', '--textColorWeak']) {
    const values = surfaceValues();
    delete values[token];
    assert.throws(() => checkWeakTokens(surfaces(values)), (error) => error.message.includes(token));
  }
  assert.throws(() => checkWeakTokens(postcss.parse(':root {}')), /Missing weak token/);
});

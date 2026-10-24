import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { selectorSpecificity, compare } from '@csstools/selector-specificity';
import { errorPageGuard, legacyGuard, nuGuard, rootTokenScope, rootOverrideScope, nuTokenScope } from '../scripts/guards.mjs';
import { checkErrorPageExclusion, checkNuStyle, nuContrastPairs } from '../scripts/compile.mjs';
import { coverageSets, missingAssignments } from '../scripts/coverage.mjs';
import { inspectCSS } from '../scripts/source.mjs';
import { findLiterals } from '../scripts/literals.mjs';

const source = await readFile(new URL('../catppuccin-nu.user.less', import.meta.url), 'utf8');
const main = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');

test('add-on has an independent identity, identical controls/domains and no legacy assignments', () => {
  assert.notEqual(source.match(/^@name .+$/m)[0], main.match(/^@name .+$/m)[0]);
  assert.match(source, /@description .*requires Backlog Catppuccin/);
  assert.deepEqual(source.match(/^@var .+$/gm), main.match(/^@var .+$/gm));
  assert.equal(source.match(/^@-moz-document .+$/m)[0], main.match(/^@-moz-document .+$/m)[0]);
  const assigned = [...source.slice(source.lastIndexOf('#nuui(@flavor) {')).matchAll(/(--[\w-]+):/g)].map((match) => match[1]);
  assert.ok(assigned.length > 200);
  assert.ok(assigned.every((name) => name.startsWith('--nuui-')));
  assert.equal(new Set(assigned).size, assigned.length);
});

test('coverage keeps add-on colors and composites separate from legacy and non-color tokens', () => {
  const extracted = inspectCSS(':root { --legacy: red; --nuui-text-default: blue; --nuui-elevation-shadow-small: 0 2px 4px red; --nuui-bg-ai-default: linear-gradient(red, blue); --nuui-radius: 4px; --nuui-opacity: .5; }');
  const sets = coverageSets({ names: extracted.names.filter((name) => !extracted.composites.includes(name)), composites: extracted.composites });
  assert.deepEqual(sets.legacy, ['--legacy']);
  assert.deepEqual(sets.nu, ['--nuui-bg-ai-default', '--nuui-elevation-shadow-small', '--nuui-text-default']);
  assert.deepEqual(missingAssignments(sets.nu, source), []);
  assert.deepEqual(missingAssignments(sets.nu, main), sets.nu);
  assert.deepEqual(missingAssignments(sets.nu, '--nuui-text-default: @text;'), ['--nuui-bg-ai-default', '--nuui-elevation-shadow-small']);
});

test('structural guard check distinguishes token roots, tooltips, components and add-on', () => {
  for (const selector of [rootTokenScope, `${rootTokenScope}.dark-mode body`, `${rootTokenScope} .simptip-info`]) {
    assert.doesNotThrow(() => checkErrorPageExclusion(postcss.parse(`${selector} {--tooltipBaseColor:red}`)));
  }
  for (const selector of [`:root${errorPageGuard} .component`, `${rootTokenScope} .component`, `${rootTokenScope} body .component`]) {
    for (const declaration of ['color:red', '--tooltipBaseColor:red', '--other:red']) {
      assert.throws(() => checkErrorPageExclusion(postcss.parse(`${selector} {${declaration}}`)), /design guard/);
    }
  }
  assert.throws(() => checkErrorPageExclusion(postcss.parse(`${rootTokenScope} {color:red}`)), /design guard/);
  assert.doesNotThrow(() => checkErrorPageExclusion(postcss.parse(`${rootOverrideScope} .component {color:red}`)));
  for (const guard of [errorPageGuard, legacyGuard, nuGuard.replace('> head > link', 'head link')]) {
    assert.throws(() => checkErrorPageExclusion(postcss.parse(`:root${guard} {--nuui-text-default:red}`), true), /design guard/);
  }
  assert.doesNotThrow(() => checkErrorPageExclusion(postcss.parse(`${nuTokenScope}.dark-mode body {--nuui-text-default:red}`), true));
});

test('design guards add zero specificity and add-on body beats site theme declarations', () => {
  const specificity = (selector) => selectorSpecificity(selectorParser().astSync(selector).first);
  for (const guard of [errorPageGuard, legacyGuard, nuGuard]) assert.deepEqual(specificity(`:root${guard}`), specificity(':root'));
  assert.ok(compare(specificity(`${nuTokenScope}.dark-mode body`), specificity('.dark-mode body.theme-green:not(.Page--error, .Page--add-space)')) > 0);
});

function validNu() {
  const entries = new Map(nuContrastPairs().flat().map((name) => [name, name.startsWith('bg-') ? '#fff' : '#111']));
  entries.set('bg-canvas-backdrop', '#ccc');
  entries.set('bg-canvas-default', '#ddd');
  entries.set('bg-floating', '#fff');
  entries.set('bg-ghost-active', '#eee');
  const declarations = [...entries].map(([name, value]) => `--nuui-${name}:${value}`).join(';');
  return postcss.parse(['', ' body', '.dark-mode', '.dark-mode body'].map((mode) => `${nuTokenScope}${mode} {${declarations}}`).join('\n'));
}

test('add-on checks reject unreadable semantic, marker and navigation pairs and flattened states', () => {
  assert.match(checkNuStyle(validNu(), 'latte'), /PASS/);
  for (const token of ['text-on-primary', 'icon-on-warning', 'text-on-marker-default', 'text-on-theme-nav', 'text-danger']) {
    const css = validNu();
    css.first.nodes.find((decl) => decl.prop === `--nuui-${token}`).value = '#fff';
    assert.throws(() => checkNuStyle(css, 'latte'), /contrast/);
  }
  const flat = validNu();
  flat.first.nodes.find((decl) => decl.prop === '--nuui-bg-ghost-active').value = '#fff';
  assert.throws(() => checkNuStyle(flat, 'latte'), /must differ/);
  const order = validNu();
  order.first.nodes.find((decl) => decl.prop === '--nuui-bg-canvas-default').value = '#000';
  assert.throws(() => checkNuStyle(order, 'latte'), /neutral order/);
});

test('new-design literal triage cannot hide colors behind legacy-only overrides', () => {
  const css = '.component {color:red}';
  const overrides = `${rootOverrideScope} .component {color:var(--textColorPrimary)}`;
  const urls = ['styles', 'styles_nu-ui'].map((folder) => ({ url: `https://assets.backlog.com/${folder}/Common.css`, css }));
  const report = findLiterals(urls, overrides);
  assert.equal(report.length, 1);
  assert.match(report[0].stylesheet, /styles_nu-ui/);
  assert.equal(report[0].selectors[0].declarations[0].property, 'color');
});

test('image/color type parity follows discovered gradients and aliases in both directions', async () => {
  const { checkNuTokenTypes } = await import('../scripts/compile.mjs');
  const discovered = inspectCSS(':root { --nuui-image: repeating-linear-gradient(red, blue); --nuui-alias: var(--nuui-image); --nuui-color: red; --nuui-color-alias: var(--nuui-color); --nuui-shadow: 0 1px 2px red; }');
  assert.deepEqual(discovered.images, ['--nuui-alias', '--nuui-image']);
  const valid = '--nuui-image:linear-gradient(120deg, pink, blue); --nuui-alias:radial-gradient(pink, blue); --nuui-color:#fff; --nuui-color-alias:rgba(1,2,3,.5)';
  assert.match(checkNuTokenTypes(postcss.parse(`:root {${valid}}`), discovered), /PASS/);
  for (const name of ['image', 'alias', 'color', 'color-alias']) {
    const wrong = name.includes('color') ? 'linear-gradient(red, blue)' : '#fff';
    assert.throws(() => checkNuTokenTypes(postcss.parse(`:root {--nuui-${name}:${wrong}}`), discovered), /Token type mismatch/);
  }
});

test('guarded navigation and migration rules use only approved role tokens', async () => {
  const { compile, nuComponentTokens } = await import('../scripts/compile.mjs');
  const palette = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'blue', 'sapphire', 'sky', 'lavender', 'subtext0', 'subtext1', 'overlay0', 'overlay1', 'surface0', 'surface1', 'surface2', 'mantle', 'base', 'crust', 'text', 'accent'];
  const shades = {base: '#eeeeee', mantle: '#dddddd', crust: '#cccccc', text: '#111111', accent: '#aa4444'};
  const library = `#lib { .palette() {${palette.map((name) => `@${name}: ${shades[name] || '#888888'};`).join('')}} }`;
  const css = postcss.parse((await compile('latte', source, library, 'mocha')).css);
  assert.doesNotThrow(() => checkErrorPageExclusion(css, true));
  let roots = 0;
  css.walkRules((rule) => {
    const values = new Map(rule.nodes.map((decl) => [decl.prop, decl.value]));
    if (!values.has('--nuui-bg-primary-default')) return;
    roots++;
    assert.equal(values.get('--nuui-bg-primary-default'), shades.accent);
    assert.equal(values.get('--nuui-bg-theme-nav'), rule.selector.includes('.dark-mode') ? shades.mantle : shades.crust);
  });
  assert.equal(roots, 4);
  for (const [selector, entries] of Object.entries(nuComponentTokens)) {
    const found = [];
    css.walkRules((rule) => { if (rule.selector === `${nuTokenScope} ${selector}`) found.push(rule); });
    assert.equal(found.length, 1, selector);
    assert.deepEqual(Object.fromEntries(found[0].nodes.map((decl) => [decl.prop, decl.value])),
      Object.fromEntries(Object.entries(entries).map(([prop, token]) => [prop, `var(${token})`])));
    assert.throws(() => checkErrorPageExclusion(postcss.parse(`${nuTokenScope.replace(nuGuard, legacyGuard)} ${selector} {color:red}`), true), /design guard/);
  }
});

test('Latte solid contrast exceptions retain a strict 2.5 floor and leave other pairs at 3', async () => {
  const { nuContrastFloor } = await import('../scripts/compile.mjs');
  assert.equal(nuContrastFloor('latte/green', 'text-on-primary', 'bg-primary-default'), 2.5);
  assert.equal(nuContrastFloor('latte', 'icon-on-success', 'bg-success-default'), 2.5);
  for (const flavor of ['frappe', 'macchiato', 'mocha']) assert.equal(nuContrastFloor(flavor, 'text-on-primary', 'bg-primary-default'), 3);
  assert.equal(nuContrastFloor('latte', 'text-warning', 'bg-warning-banner'), 3);
  const fixture = validNu();
  fixture.first.nodes.find((decl) => decl.prop === '--nuui-text-on-primary').value = '#999';
  const messages = [];
  assert.match(checkNuStyle(fixture, 'latte/green', (message) => messages.push(message)), /PASS/);
  assert.match(messages.join('\n'), /latte\/green.*text-on-primary.*2\.849/);
  assert.throws(() => checkNuStyle(fixture, 'mocha'), /< 3:1/);
  fixture.first.nodes.find((decl) => decl.prop === '--nuui-text-on-primary').value = '#aaa';
  assert.throws(() => checkNuStyle(fixture, 'latte'), /< 2.5:1/);
});

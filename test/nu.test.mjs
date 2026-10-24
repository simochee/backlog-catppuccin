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
  const assigned = [...source.matchAll(/(--[\w-]+):/g)].map((match) => match[1]);
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

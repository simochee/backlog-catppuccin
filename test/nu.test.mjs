import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { selectorSpecificity, compare } from '@csstools/selector-specificity';
import { errorPageGuard, legacyGuard, newDesignGuard, sharedTokenScope, legacyOverrideScope, newDesignTokenScope } from '../scripts/guards.mjs';
import { checkErrorPageExclusion, checkNuStyle, nuContrastPairs, nuDistinctSurfaces, checkTooltipContrast, markerNames } from '../scripts/compile.mjs';
import { coverageSets, missingAssignments, discoverCoverage } from '../scripts/coverage.mjs';
import { inspectCSS } from '../scripts/source.mjs';
import { findLiterals } from '../scripts/literals.mjs';

const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
const main = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');

test('userstyle has one header, control set and document scope', () => {
  assert.equal((source.match(/==UserStyle==/g) || []).length, 1);
  assert.equal((source.match(/^@var /gm) || []).length, 3);
  assert.equal((source.match(/^@-moz-document /gm) || []).length, 1);
  const assigned = [...source.slice(source.lastIndexOf('#nuui(@flavor) {')).matchAll(/(--[\w-]+):/g)].map((match) => match[1]);
  assert.ok(assigned.length > 200);
  assert.ok(assigned.every((name) => name.startsWith('--nuui-')));
  assert.equal(new Set(assigned).size, assigned.length);
});

test('coverage keeps new design colors and composites separate from legacy and non-color tokens', () => {
  const extracted = inspectCSS(':root { --legacy: red; --nuui-text-default: blue; --nuui-elevation-shadow-small: 0 2px 4px red; --nuui-bg-ai-default: linear-gradient(red, blue); --nuui-radius: 4px; --nuui-opacity: .5; }');
  const sets = coverageSets({ names: extracted.names.filter((name) => !extracted.composites.includes(name)), composites: extracted.composites });
  assert.deepEqual(sets.legacy, ['--legacy']);
  assert.deepEqual(sets.nu, ['--nuui-bg-ai-default', '--nuui-elevation-shadow-small', '--nuui-text-default']);
  assert.deepEqual(missingAssignments(sets.nu, source), []);
  assert.deepEqual(missingAssignments(sets.nu, main), []);
  assert.deepEqual(missingAssignments(sets.nu, '--nuui-text-default: @text;'), ['--nuui-bg-ai-default', '--nuui-elevation-shadow-small']);
});

test('structural guard check distinguishes token roots, tooltips, components and new design', () => {
  for (const selector of [sharedTokenScope, `${sharedTokenScope}.dark-mode body`, `${sharedTokenScope} .simptip-info`]) {
    assert.doesNotThrow(() => checkErrorPageExclusion(postcss.parse(`${selector} {--tooltipBaseColor:red}`)));
  }
  for (const selector of [`:root${errorPageGuard} .component`, `${sharedTokenScope} .component`, `${sharedTokenScope} body .component`]) {
    for (const declaration of ['color:red', '--tooltipBaseColor:red', '--other:red']) {
      assert.throws(() => checkErrorPageExclusion(postcss.parse(`${selector} {${declaration}}`)), /design guard/);
    }
  }
  assert.throws(() => checkErrorPageExclusion(postcss.parse(`${sharedTokenScope} {color:red}`)), /design guard/);
  assert.doesNotThrow(() => checkErrorPageExclusion(postcss.parse(`${legacyOverrideScope} .component {color:red}`)));
  for (const guard of [errorPageGuard, legacyGuard, newDesignGuard.replace('> head > link', 'head link')]) {
    assert.throws(() => checkErrorPageExclusion(postcss.parse(`:root${guard} {--nuui-text-default:red}`), true), /design guard/);
  }
  assert.doesNotThrow(() => checkErrorPageExclusion(postcss.parse(`${newDesignTokenScope}.dark-mode body {--nuui-text-default:red}`), true));
});

test('design guards add zero specificity and new design body beats site theme declarations', () => {
  const specificity = (selector) => selectorSpecificity(selectorParser().astSync(selector).first);
  for (const guard of [errorPageGuard, legacyGuard, newDesignGuard]) assert.deepEqual(specificity(`:root${guard}`), specificity(':root'));
  assert.ok(compare(specificity(`${newDesignTokenScope}.dark-mode body`), specificity('.dark-mode body.theme-green:not(.Page--error, .Page--add-space)')) > 0);
});

function validNu() {
  const entries = new Map(nuContrastPairs().flat().map((name) => [name, name.startsWith('bg-') ? '#fff' : '#111']));
  entries.set('bg-canvas-backdrop', '#bbb');
  entries.set('bg-canvas-default', '#eee');
  entries.set('bg-floating', '#fff');
  entries.set('bg-ghost-hover', '#ccc');
  entries.set('bg-ghost-active', '#eee');
  entries.set('bg-ghost-pressed', '#bbb');
  entries.set('bg-subtle', '#fff');
  entries.set('bg-row-header', '#fff');
  entries.set('bg-disabled', '#ddd');
  for (const role of ['danger', 'info', 'success', 'warning', ...markerNames.map((name) => `marker-${name}`)]) {
    entries.set(`bg-${role}-subtle`, '#eee');
    entries.set(`bg-${role}-highlight`, '#ddd');
  }
  for (const name of markerNames) {
    entries.set(`border-marker-${name}-subtle`, '#888');
    entries.set(`border-marker-${name}-default`, '#aaa');
  }
  const declarations = [...entries].map(([name, value]) => `--nuui-${name}:${value}`).join(';');
  return postcss.parse(['', ' body', '.dark-mode', '.dark-mode body'].map((mode) => `${newDesignTokenScope}${mode} {${declarations}}`).join('\n'));
}

test('new design checks reject unreadable semantic, marker and navigation pairs and flattened states', () => {
  assert.match(checkNuStyle(validNu(), 'latte'), /PASS/);
  for (const token of ['text-on-primary', 'icon-on-warning', 'text-on-marker-default', 'text-on-theme-nav', 'text-danger']) {
    const css = validNu();
    css.first.nodes.find((decl) => decl.prop === `--nuui-${token}`).value = '#fff';
    assert.throws(() => checkNuStyle(css, 'latte'), /contrast/);
  }
  const flat = validNu();
  flat.first.nodes.find((decl) => decl.prop === '--nuui-bg-ghost-active').value = '#ccc';
  assert.throws(() => checkNuStyle(flat, 'latte'), /must differ/);
  const order = validNu();
  order.first.nodes.find((decl) => decl.prop === '--nuui-bg-canvas-default').value = '#000';
  assert.throws(() => checkNuStyle(order, 'latte'), /neutral order/);
});

test('new-design literal triage cannot hide colors behind legacy-only overrides', () => {
  const css = '.component {color:red}';
  const overrides = `${legacyOverrideScope} .component {color:var(--textColorPrimary)}`;
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
  const palette = ['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'blue', 'sapphire', 'sky', 'lavender', 'subtext0', 'subtext1', 'overlay0', 'overlay1', 'overlay2', 'surface0', 'surface1', 'surface2', 'mantle', 'base', 'crust', 'text', 'accent'];
  const shades = {base: '#eeeeee', mantle: '#dddddd', crust: '#cccccc', text: '#111111', accent: '#aa4444'};
  const library = `#lib { .palette() {${palette.map((name) => `@${name}: ${shades[name] || '#888888'};`).join('')}} }`;
  const css = postcss.parse((await compile('latte', source, library, 'mocha')).css);
  css.walkRules((rule) => { if (!rule.selector.startsWith(newDesignTokenScope)) rule.remove(); });
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
    css.walkRules((rule) => { if (rule.selector === `${newDesignTokenScope} ${selector}`) found.push(rule); });
    assert.equal(found.length, 1, selector);
    assert.deepEqual(Object.fromEntries(found[0].nodes.map((decl) => [decl.prop, decl.value])),
      Object.fromEntries(Object.entries(entries).map(([prop, token]) => [prop, `var(${token})`])));
    assert.throws(() => checkErrorPageExclusion(postcss.parse(`${newDesignTokenScope.replace(newDesignGuard, legacyGuard)} ${selector} {color:red}`), true), /design guard/);
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


test('every hosting surface stays distinct from ghost hover and disabled', () => {
  for (const [left, right] of nuDistinctSurfaces) {
    const css = validNu();
    css.first.nodes.find((decl) => decl.prop === `--nuui-${left}`).value = css.first.nodes.find((decl) => decl.prop === `--nuui-${right}`).value;
    assert.throws(() => checkNuStyle(css, 'mocha'), /must differ/);
  }
});

test('live coverage and type parity fail when discovery or assignments are empty', async () => {
  const { checkNuTokenTypes } = await import('../scripts/compile.mjs');
  const legacy = { url: 'https://assets.backlog.com/styles/Common.css', css: ':root {--legacy:red}' };
  const nu = { ...legacy, url: 'https://assets.backlog.com/styles_nu-ui/Common.css' };
  assert.throws(() => discoverCoverage([legacy]), /No styles_nu-ui/);
  assert.throws(() => discoverCoverage([nu]), /No --nuui-/);
  assert.throws(() => discoverCoverage([{ ...nu, css: '' }]), /No color variables/);
  assert.throws(() => checkNuTokenTypes(postcss.parse(''), inspectCSS(legacy.css)), /No --nuui-/);
  assert.throws(() => checkNuTokenTypes(postcss.parse(''), inspectCSS(':root {--nuui-text:red}')), /No --nuui-.*assignments/);
});

test('the userstyle declares the same new-design marker once', async () => {
  const { newDesignMarker } = await import('../scripts/guards.mjs');
  for (const style of [source, main]) {
    assert.equal(style.match(/@newDesignMarker: ~'([^']+)';/)[1], newDesignMarker);
    assert.equal(style.split(newDesignMarker).length - 1, 1);
    assert.ok(style.includes('@{newDesignMarker}'));
  }
});

test('tooltip contrast checks defaults, every variant, and missing pairs at 3:1', () => {
  const selectors = ['', '.dark-mode'].flatMap((mode) => ['', ...['success', 'info', 'danger', 'error', 'warning'].map((name) => ` .simptip-${name}`)].map((suffix) => `${sharedTokenScope}${mode}${suffix}`));
  const css = postcss.parse(selectors.map((selector) => `${selector} {--tooltip-base-color:#fff;--tooltipBaseColor:#fff;--tooltip-text-color:#111}`).join('\n'));
  assert.match(checkTooltipContrast(css, 'latte'), /PASS/);
  for (const rule of css.nodes) {
    const bad = css.clone();
    bad.nodes[css.nodes.indexOf(rule)].last.value = '#999';
    assert.throws(() => checkTooltipContrast(bad, 'mocha'), /< 3:1/);
  }
  css.last.remove();
  assert.throws(() => checkTooltipContrast(css, 'latte'), /Missing/);
});


test('only Latte solid success tooltip can use the 2.5 contrast floor', () => {
  const fixture = () => postcss.parse(['', '.dark-mode'].flatMap((mode) => ['', ...['success', 'info', 'danger', 'error', 'warning'].map((name) => ` .simptip-${name}`)].map((suffix) => `${sharedTokenScope}${mode}${suffix} {--tooltip-base-color:#fff;--tooltipBaseColor:#fff;--tooltip-text-color:#111}`)).join('\n'));
  for (const flavor of ['latte', 'mocha']) {
    for (const variant of ['success', 'info', 'danger', 'error', 'warning']) {
      const css = fixture();
      css.nodes.find((rule) => rule.selector.endsWith(` .simptip-${variant}`)).last.value = '#999';
      const messages = [];
      if (flavor === 'latte' && variant === 'success') {
        assert.match(checkTooltipContrast(css, flavor, (message) => messages.push(message)), /PASS/);
        assert.match(messages.join('\n'), /tooltip success.*2\.849:1 >= 2\.5:1/);
        css.nodes.find((rule) => rule.selector.endsWith(' .simptip-success')).last.value = '#aaa';
        assert.throws(() => checkTooltipContrast(css, flavor), /< 2.5:1/);
      } else assert.throws(() => checkTooltipContrast(css, flavor), /< 3:1/);
    }
  }
});


test('accent sweep checks only accent-dependent contrast pairs', () => {
  const css = validNu();
  css.first.nodes.find((decl) => decl.prop === '--nuui-bg-floating').value = '#000';
  css.first.nodes.find((decl) => decl.prop === '--nuui-text-on-warning').value = '#fff';
  assert.match(checkNuStyle(css, 'mocha/green', () => {}, true), /PASS/);
  css.first.nodes.find((decl) => decl.prop === '--nuui-text-on-primary').value = '#fff';
  assert.throws(() => checkNuStyle(css, 'mocha/green', () => {}, true), /contrast/);
});

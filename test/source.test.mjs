import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCSS, stylesheetURLs, validateStylesheetURL } from '../scripts/source.mjs';
import { missingAssignments } from '../scripts/coverage.mjs';

test('extracts colors, aliases, fallbacks and RGB channels without dimensions', () => {
  const result = inspectCSS(':root { --ink: red; --alias: var(--ink); --fallback: var(--missing, blue); --ink-rgb: 1, 2, 3; --width: 12px; --count: 3; --gradient: linear-gradient(red, blue); --shadow: 0 2px 4px var(--ink); --gradient-alias: var(--gradient); }');
  assert.deepEqual(result.names, ['--alias', '--fallback', '--gradient', '--gradient-alias', '--ink', '--ink-rgb', '--shadow']);
  assert.deepEqual(result.composites, ['--gradient', '--gradient-alias', '--shadow']);
});

test('discovers versioned stylesheet URLs and rejects other sources', () => {
  assert.deepEqual(stylesheetURLs(`<link href='https://assets.backlog.com/version/example.css' rel='stylesheet'><link rel="icon" href="/icon">`), ['https://assets.backlog.com/version/example.css']);
  assert.throws(() => stylesheetURLs('<html></html>'));
  assert.throws(() => validateStylesheetURL('https://example.com/a.css'));
  assert.throws(() => validateStylesheetURL('http://assets.backlog.com/a.css'));
});

test('coverage flags missing assignments and ignores comment-only declarations', () => {
  assert.deepEqual(missingAssignments(['--ink', '--missing'], '--ink: @text; /* --missing: @red; */'), ['--missing']);
});

test('discovery warns and skips disallowed stylesheets while extras stay strict', (t) => {
  const warnings = [];
  t.mock.method(console, 'error', (message) => warnings.push(message));
  assert.deepEqual(stylesheetURLs('<link rel="stylesheet" href="https://example.com/a.css"><link rel="stylesheet" href="https://assets.backlog.com/a.css">'), ['https://assets.backlog.com/a.css']);
  assert.match(warnings.join('\n'), /Warning: skipped stylesheet/);
  assert.throws(() => validateStylesheetURL('https://example.com/a.css'));
});

test('coverage ignores LESS line comments and preserves quoted HTTPS URLs', () => {
  const source = `@import "https://example.com/library.less";
    // --commented: @red;
    --real: @text; // --also-commented: @green;
    --url: "https://example.com/image";
    --escaped: 'it\\'s https://example.com';
    --after: @base;`;
  assert.deepEqual(missingAssignments(['--commented', '--also-commented', '--real', '--url', '--escaped', '--after'], source), ['--commented', '--also-commented']);
});

test('discovery adds and deduplicates all supported bundles from the version path', () => {
  const urls = stylesheetURLs('<link rel="stylesheet" href="https://assets.backlog.com/playassets/test-version/styles/Common.css">');
  assert.equal(urls.length, 14);
  for (const path of ['styles/Common.css', 'styles/ReactApp.css', 'styles/Kanban.css', 'styles/Wiki.css', 'styles/Git.css', 'styles/Documents.css', ...['Common', 'ReactApp', 'Kanban', 'Wiki', 'Git', 'Documents'].map((name) => `styles_nu-ui/${name}.css`), 'react/static/css/index.css', 'react/global-bar/static/css/main.css']) {
    assert.ok(urls.includes(`https://assets.backlog.com/playassets/test-version/${path}`));
  }
});

test('missing discovered bundles warn and skip, while extra URLs and other errors fail', async (t) => {
  const { loadStylesheets } = await import('../scripts/source.mjs');
  const warnings = [];
  t.mock.method(console, 'error', (message) => warnings.push(message));
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('this-page-does-not-exist')) return new Response('<link rel="stylesheet" href="https://assets.backlog.com/playassets/test/styles/Common.css">', { status: 404 });
    if (String(url).endsWith('/styles/Common.css')) return new Response(':root { --ink: red; }');
    return new Response('', { status: 404 });
  });
  assert.equal((await loadStylesheets()).length, 1);
  assert.equal(warnings.filter((line) => line.startsWith('Warning: skipped missing')).length, 13);
  await assert.rejects(loadStylesheets(['https://assets.backlog.com/extra.css']), /HTTP 404/);
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }));
  await assert.rejects(loadStylesheets(), /HTTP 500/);
});

test('404 linked stylesheets fail even when they are also speculative bundle paths', async (t) => {
  const { loadStylesheets } = await import('../scripts/source.mjs');
  t.mock.method(console, 'error', () => {});
  for (const path of ['styles/Common.css', 'linked.css']) {
    t.mock.method(globalThis, 'fetch', async (url) => String(url).includes('this-page-does-not-exist')
      ? new Response(`<link rel="stylesheet" href="https://assets.backlog.com/playassets/test/${path}">`, { status: 404 })
      : new Response('', { status: 404 }));
    await assert.rejects(loadStylesheets(), /HTTP 404/);
  }
});

test('speculative 404 response bodies are cancelled and explicit extras stay required', async (t) => {
  const { loadStylesheets } = await import('../scripts/source.mjs');
  let cancelled = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('this-page-does-not-exist')) return new Response('<link rel="stylesheet" href="https://assets.backlog.com/playassets/test/styles/Common.css">');
    if (String(url).endsWith('/styles/Common.css')) return new Response('');
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 404 });
  });
  assert.equal((await loadStylesheets()).length, 1);
  assert.equal(cancelled, 13);
  await assert.rejects(loadStylesheets(['https://assets.backlog.com/playassets/test/styles/Wiki.css']), /HTTP 404/);
});

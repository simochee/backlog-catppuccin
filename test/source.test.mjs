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

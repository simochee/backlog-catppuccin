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

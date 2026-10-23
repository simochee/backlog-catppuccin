import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { compile } from '../scripts/compile.mjs';

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
  for (const file of ['compile.mjs', 'coverage.mjs', 'source.mjs']) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(directory, 'scripts', file));
  }
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
  await writeFile(join(directory, 'catppuccin.user.less'), `${importLine}
    :root { --backgroundColorBase: if((@lightFlavor = latte), red, blue); }
    :root.dark-mode { --backgroundColorBase: if((@darkFlavor = latte), red, blue); }`);
  await writeFile(join(directory, 'mock-fetch.mjs'), `globalThis.fetch = async (url) => new Response(
    String(url).endsWith('.less') ? '/* fixture library */' :
    String(url).endsWith('.css') ? ':root { --backgroundColorBase: red; }' :
    String(url) === process.env.BACKLOG_PAGE_URL ? '<link rel="stylesheet" href="https://assets.backlog.com/fixture.css">' :
    (() => { throw new Error('Unexpected discovery page'); })());`);
  for (const [script, expected] of [
    ['compile', /mocha: PASS[\s\S]*Independent light\/dark switching.*PASS/],
    ['coverage', /1 assignable; 0 unassigned/],
  ]) {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', pathToFileURL(join(directory, 'mock-fetch.mjs')).href, join(directory, 'scripts', `${script}.mjs`)], { env: { ...process.env, BACKLOG_PAGE_URL: 'https://simochee.backlog.com/fixture-page' } });
    assert.match(stdout, expected);
  }
});

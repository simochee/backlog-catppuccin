import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    singleQuote: true,
    ignorePatterns: [
      'catppuccin.user.less',
      'packages/userstyle/test/fixtures/catppuccin-library.less',
    ],
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ['packages/userstyle/scripts/source.mjs'],
        rules: { 'unicorn/no-useless-spread': 'off' },
      },
      {
        files: ['packages/userstyle/scripts/{source,coverage,dark-text}.mjs'],
        rules: { 'typescript/require-array-sort-compare': 'off' },
      },
    ],
  },
  test: {
    include: ['packages/userstyle/test/**/*.test.mjs'],
    testTimeout: 120_000,
    restoreMocks: true,
  },
  run: {
    tasks: {
      'check:less': {
        command: 'node packages/userstyle/scripts/compile.mjs',
        cache: {
          input: [
            'catppuccin.user.less',
            'packages/userstyle/**',
            'pnpm-lock.yaml',
            'package.json',
            'vite.config.ts',
          ],
        },
      },
      extract: { command: 'node packages/userstyle/scripts/extract.mjs', cache: false },
      'check:coverage': { command: 'node packages/userstyle/scripts/coverage.mjs', cache: false },
      'check:dark-text': {
        command: 'node packages/userstyle/scripts/dark-text.mjs --check',
        cache: false,
      },
      'generate:dark-text': {
        command: 'node packages/userstyle/scripts/dark-text.mjs',
        cache: false,
      },
      'report:literals': { command: 'node packages/userstyle/scripts/literals.mjs', cache: false },
    },
  },
});

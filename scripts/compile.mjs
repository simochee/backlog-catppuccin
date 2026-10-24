import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import less from 'less';
import postcss from 'postcss';
import { download } from './source.mjs';

const libraryURL = 'https://userstyles.catppuccin.com/lib/std/v1.less';
const isRGB = (name) => /-rgb$/.test(name) || name === '--rgb-accent';
export async function compile(flavor, source, library, darkFlavor = flavor, accentColor = 'mauve') {
  const importLine = `@import "${libraryURL}";`;
  if (!source.includes(importLine)) throw new Error('Catppuccin library @import line not found');
  const local = source.replace(importLine, () => library);
  return less.render(local, {
    javascriptEnabled: false,
    globalVars: { lightFlavor: flavor, darkFlavor, accentColor },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
    const library = await download(libraryURL);
    for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
      const result = await compile(flavor, source, library);
      const css = postcss.parse(result.css, { from: undefined, map: false });
      let count = 0;
      css.walkDecls(/^--/, (decl) => {
        count++;
        if (isRGB(decl.prop) && !/^\d+,\s*\d+,\s*\d+$/.test(decl.value)) {
          throw new Error(`Invalid RGB triplet: ${decl.prop}`);
        }
        if (isRGB(decl.prop)) {
          const colorName = decl.prop === '--rgb-accent' ? '--defaultColorAccent' : decl.prop.slice(0, -4);
          const counterpart = decl.parent.nodes.find((node) => node.prop === colorName);
          const hex = counterpart?.value.replace(/^#([\da-f])([\da-f])([\da-f])$/i, '#$1$1$2$2$3$3');
          if (!/^#[\da-f]{6}$/i.test(hex || '')) throw new Error(`Missing color counterpart: ${decl.prop}`);
          const channels = hex.slice(1).match(/../g).map((channel) => parseInt(channel, 16));
          if (channels.some((channel, index) => channel !== Number(decl.value.split(',')[index]))) {
            throw new Error(`RGB triplet differs from color: ${decl.prop}`);
          }
        }
      });
      if (!count) throw new Error('Compiled output has no assignments');
      console.log(`${flavor}: PASS (${count} custom-property assignments)`);
    }
    const mixed = postcss.parse((await compile('latte', source, library, 'mocha', 'green')).css, { from: undefined, map: false });
    const palettes = {};
    mixed.walkDecls('--backgroundColorBase', (decl) => {
      if (decl.parent.selector.includes('body')) return;
      palettes[decl.parent.selector.includes('.dark-mode') ? 'dark' : 'light'] = decl.value;
    });
    if (!palettes.light || !palettes.dark || palettes.light === palettes.dark) throw new Error('Flavor switching failed');
    checkOverrides(mixed);
    console.log('Independent light/dark switching and scoped color overrides: PASS');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

export function checkOverrides(css) {
  css.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) return;
    const selectors = postcss.list.comma(decl.parent.selector);
    const darkText = decl.prop === 'color' &&
      selectors.every((selector) => selector.startsWith('.dark-mode '));
    const subtask = decl.prop === 'color' && !decl.important &&
      decl.parent.selector === '.dark-mode .pill--square.-subtasking' && decl.value === 'var(--textColorWeak)';
    const board = decl.prop === 'background-color' &&
      selectors.length === 1 && selectors[0] === ':root:not(.dark-mode) body.Page--view-kanban .card';
    if (!subtask && (decl.value !== 'var(--backgroundColorSchemeBase)' || !(darkText || board))) {
      throw new Error(`Unexpected color override: ${decl.parent.selector} / ${decl.prop}`);
    }
  });
}

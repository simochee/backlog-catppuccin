import { readFile } from 'node:fs/promises';
import less from 'less';
import postcss from 'postcss';
import { download } from './source.mjs';

const libraryURL = 'https://userstyles.catppuccin.com/lib/std/v1.less';
export async function compile(flavor, source, library, darkFlavor = flavor, accentColor = 'mauve') {
  const local = source.replace(`@import "${libraryURL}";`, library);
  return less.render(local, {
    javascriptEnabled: false,
    globalVars: { lightFlavor: flavor, darkFlavor, accentColor },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const source = await readFile(new URL('../catppuccin.user.less', import.meta.url), 'utf8');
    const library = await download(libraryURL);
    for (const flavor of ['latte', 'frappe', 'macchiato', 'mocha']) {
      const result = await compile(flavor, source, library);
      const css = postcss.parse(result.css, { from: undefined, map: false });
      let count = 0;
      css.walkDecls(/^--/, (decl) => {
        count++;
        if (/-rgb$/.test(decl.prop) && !/^\d+,\s*\d+,\s*\d+$/.test(decl.value)) {
          throw new Error(`Invalid RGB triplet: ${decl.prop}`);
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
    mixed.walkDecls((decl) => {
      if (!decl.prop.startsWith('--')) throw new Error(`Unexpected non-color property: ${decl.prop}`);
    });
    console.log('Independent light/dark switching and custom-property-only output: PASS');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

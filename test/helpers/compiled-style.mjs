import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import { compile } from '../../scripts/compile.mjs';
import { loadPinnedLibrary, loadPalettes } from '../../scripts/palette.mjs';
const source = await readFile(new URL('../../catppuccin.user.less', import.meta.url), 'utf8');
const library = await loadPinnedLibrary();
const palettes = await loadPalettes();
const compiled = new Map();
for (const flavor of Object.keys(palettes)) compiled.set(flavor, postcss.parse((await compile(flavor, source, library)).css));
const rootValues = (rule) => new Map(rule.nodes.filter((node) => node.type === 'decl').map((decl) => [decl.prop, decl.value]));

export { source, library, palettes, compiled, rootValues };

import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import colorNames from 'color-name';
import { gunzipSync } from 'node:zlib';

export const pageURL = 'https://simochee.backlog.com/this-page-does-not-exist';

export async function download(url, allow404 = false) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok && !(allow404 && response.status === 404)) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }
  let bytes = Buffer.from(await response.arrayBuffer());
  // Some asset responses carry gzip bytes without Content-Encoding.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return bytes.toString('utf8');
}

export function stylesheetURLs(html) {
  const urls = new Set();
  for (const link of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...link[0].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)]
      .map((match) => [match[1].toLowerCase(), match[2]]));
    if (attrs.rel?.split(/\s+/).includes('stylesheet') && attrs.href) {
      urls.add(new URL(attrs.href.replaceAll('&amp;', '&'), pageURL).href);
    }
  }
  if (!urls.size) throw new Error('No stylesheet links discovered');
  return [...urls];
}

export function validateStylesheetURL(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.hostname !== 'assets.backlog.com' || url.username || url.password) {
    throw new Error('Stylesheets must use HTTPS on assets.backlog.com');
  }
  return url.href;
}

export function inspectCSS(css) {
  const root = postcss.parse(css, { from: undefined, map: false });
  const declarations = [];
  root.walkDecls(/^--/, (decl) => declarations.push(decl));
  const colors = new Set();
  const composites = new Set();
  for (const decl of declarations) {
    if (/gradient\s*\(/i.test(decl.value) || /(?:^|\s)-?(?:\d*\.)?\d+(?:px|rem|em)\b/i.test(decl.value) && /(?:rgba?\(|#[\da-f]|var\()/i.test(decl.value)) composites.add(decl.prop);
    let isColor = /-rgb$/.test(decl.prop) && /^\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*$/.test(decl.value);
    valueParser(decl.value).walk((node) => {
      if (node.type === 'function' && /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)$/i.test(node.value)) isColor = true;
      if (node.type === 'word' && (/^#[\da-f]{3,8}$/i.test(node.value) || Object.hasOwn(colorNames, node.value.toLowerCase()) || /^(transparent|currentcolor)$/i.test(node.value))) isColor = true;
    });
    if (isColor) colors.add(decl.prop);
  }
  // Follow aliases and fallback references until the dependency set is stable.
  let changed;
  do {
    changed = false;
    for (const decl of declarations) {
      const refs = [...decl.value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
      if (refs.some((name) => colors.has(name)) && !colors.has(decl.prop)) {
        colors.add(decl.prop);
        changed = true;
      }
      if (refs.some((name) => composites.has(name)) && !composites.has(decl.prop)) {
        composites.add(decl.prop);
        changed = true;
      }
    }
  } while (changed);
  const selectors = new Set(declarations.filter((decl) => colors.has(decl.prop))
    .map((decl) => decl.parent.selector).filter(Boolean));
  return { names: [...colors].sort(), composites: [...composites].filter((name) => colors.has(name)).sort(), selectors: [...selectors].sort() };
}

export async function extract(extraURLs = []) {
  const urls = [...new Set([...stylesheetURLs(await download(pageURL, true)), ...extraURLs]
    .map(validateStylesheetURL))];
  const stylesheets = [];
  for (const url of urls) {
    const css = await download(url);
    stylesheets.push(css);
    const result = inspectCSS(css);
    console.error(`Source: ${url} (${result.names.length} color variables)`);
  }
  // Resolve references across stylesheet boundaries as well as within each file.
  const result = inspectCSS(stylesheets.join('\n'));
  if (!result.names.length) throw new Error('No color variables discovered');
  return { names: result.names.filter((name) => !result.composites.includes(name)), composites: result.composites, total: result.names.length };
}

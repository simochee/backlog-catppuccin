import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import colorNames from 'color-name';
import { gunzipSync } from 'node:zlib';

export const pageURL = process.env.BACKLOG_PAGE_URL || 'https://simochee.backlog.com/this-page-does-not-exist';

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
      const input = new URL(attrs.href.replaceAll('&amp;', '&'), pageURL).href;
      try {
        urls.add(validateStylesheetURL(input));
      } catch {
        console.error(`Warning: skipped stylesheet outside HTTPS assets.backlog.com: ${input}`);
      }
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
  let dependenciesChanged;
  do {
    dependenciesChanged = false;
    for (const decl of declarations) {
      const refs = [...decl.value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
      if (refs.some((name) => colors.has(name)) && !colors.has(decl.prop)) {
        colors.add(decl.prop);
        dependenciesChanged = true;
      }
      if (refs.some((name) => composites.has(name)) && !composites.has(decl.prop)) {
        composites.add(decl.prop);
        dependenciesChanged = true;
      }
    }
  } while (dependenciesChanged);
  return { names: [...colors].sort(), composites: [...composites].filter((name) => colors.has(name)).sort() };
}

export async function extract(extraURLs = []) {
  const validatedExtras = extraURLs.filter(Boolean).map(validateStylesheetURL);
  const urls = [...new Set([...stylesheetURLs(await download(pageURL, true)), ...validatedExtras])];
  const stylesheets = await Promise.all(urls.map(async (url) => {
    const css = await download(url);
    console.error(`Source: ${url}`);
    return css;
  }));
  const result = inspectCSS(stylesheets.join('\n'));
  if (!result.names.length) throw new Error('No color variables discovered');
  return { names: result.names.filter((name) => !result.composites.includes(name)), composites: result.composites, total: result.names.length };
}

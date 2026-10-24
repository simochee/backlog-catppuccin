import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import colorNames from 'color-name';
import { gunzipSync } from 'node:zlib';

export const pageURL = process.env.BACKLOG_PAGE_URL || 'https://simochee.backlog.com/this-page-does-not-exist';

export async function download(url, allow404 = false, skip404 = false) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (skip404 && response.status === 404) {
    await response.body?.cancel();
    console.error(`Warning: skipped missing stylesheet: ${url}`);
    return null;
  }
  if (!response.ok && !(allow404 && response.status === 404)) {
    throw new Error(`HTTP ${response.status} while fetching ${url}`);
  }
  let bytes = Buffer.from(await response.arrayBuffer());
  // Some asset responses carry gzip bytes without Content-Encoding.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return bytes.toString('utf8');
}

export function stylesheetURLs(html, speculativeURLs = new Set()) {
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
  for (const url of [...urls]) {
    const base = url.match(/^https:\/\/assets\.backlog\.com\/playassets\/[^/]+\//)?.[0];
    if (!base) continue;
    for (const path of [
      'styles/Common.css', 'styles/ReactApp.css', 'styles/Kanban.css',
      'styles/Wiki.css', 'styles/Git.css', 'styles/Documents.css',
      ...['Common', 'ReactApp', 'Kanban', 'Wiki', 'Git', 'Documents'].map((name) => `styles_nu-ui/${name}.css`),
      'react/static/css/index.css', 'react/global-bar/static/css/main.css',
    ]) {
      const candidate = new URL(path, base).href;
      if (!urls.has(candidate)) speculativeURLs.add(candidate);
    }
  }
  return [...new Set([...urls, ...speculativeURLs])];
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
  const images = new Set();
  for (const decl of declarations) {
    if (/[\w-]+-gradient\s*\(/i.test(decl.value)) images.add(decl.prop);
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
      if (refs.some((name) => images.has(name)) && !images.has(decl.prop)) {
        images.add(decl.prop);
        dependenciesChanged = true;
      }
      if (refs.some((name) => composites.has(name)) && !composites.has(decl.prop)) {
        composites.add(decl.prop);
        dependenciesChanged = true;
      }
    }
  } while (dependenciesChanged);
  return { images: [...images].sort(), names: [...colors].sort(), composites: [...composites].filter((name) => colors.has(name)).sort() };
}

export async function loadStylesheets(extraURLs = []) {
  const validatedExtras = extraURLs.filter(Boolean).map(validateStylesheetURL);
  const speculativeURLs = new Set();
  const urls = [...new Set([...stylesheetURLs(await download(pageURL, true), speculativeURLs), ...validatedExtras])];
  const stylesheets = await Promise.all(urls.map(async (url) => {
    const css = await download(url, false, speculativeURLs.has(url) && !validatedExtras.includes(url));
    if (css === null) return null;
    console.error(`Source: ${url}`);
    return { url, css };
  }));
  return stylesheets.filter(Boolean);
}

export async function extract(extraURLs = []) {
  const stylesheets = await loadStylesheets(extraURLs);
  const result = inspectCSS(stylesheets.map(({ css }) => css).join('\n'));
  return { names: discoveredColorNames(result), composites: result.composites, total: result.names.length };
}

export function discoveredColorNames({ names, composites }, { requireNu = false } = {}) {
  const missing = !names.length ? '' : requireNu &&
    ![...names, ...composites].some((name) => name.startsWith('--nuui-')) ? '--nuui-* ' : null;
  if (missing !== null) throw new Error(`No ${missing}color variables discovered`);
  const excluded = new Set(composites);
  return names.filter((name) => !excluded.has(name));
}

// Meta Inspector — local metadata viewer for sites you're building.
// Run: npm start  →  open http://localhost:4040
const express = require('express');
const cheerio = require('cheerio');
const path = require('path');
const { URL } = require('url');
const { audit, toMarkdown } = require('./audit');
const { renderPrintReport } = require('./report-html');

const PORT = process.env.PORT || 4040;
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const SEO_LIMITS = { title: [30, 60], description: [70, 160] };

function abs(base, href) {
  if (!href) return null;
  try { return new URL(href, base).href; } catch { return href; }
}

async function fetchWithRedirects(url, maxHops = 10) {
  const chain = [];
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const t0 = process.hrtime.bigint();
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'User-Agent': 'MetaInspector/1.0 (local dev tool)', Accept: 'text/html,*/*' },
      signal: AbortSignal.timeout(15000),
    });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    chain.push({ url: current, status: res.status, ms: Math.round(ms) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = abs(current, res.headers.get('location'));
      continue;
    }
    return { res, chain };
  }
  throw new Error('Too many redirects');
}

function parseMicrodata($) {
  const items = [];
  $('[itemscope]').not('[itemprop]').each((_, el) => items.push(microItem($, el)));
  return items;
}
function microItem($, el) {
  const $el = $(el);
  const item = { type: $el.attr('itemtype') || null, properties: {} };
  $el.find('[itemprop]').each((_, p) => {
    const $p = $(p);
    // only direct children of this scope (skip nested scopes' props)
    if ($p.parents('[itemscope]').first().get(0) !== el) return;
    const name = $p.attr('itemprop');
    let val;
    if ($p.is('[itemscope]')) val = microItem($, p);
    else val = $p.attr('content') || $p.attr('href') || $p.attr('src') || $p.attr('datetime') || $p.text().trim();
    if (item.properties[name]) {
      if (!Array.isArray(item.properties[name])) item.properties[name] = [item.properties[name]];
      item.properties[name].push(val);
    } else item.properties[name] = val;
  });
  return item;
}

function validateJsonLd(obj) {
  const issues = [];
  const REQUIRED = {
    Article: ['headline', 'author', 'datePublished'],
    NewsArticle: ['headline', 'author', 'datePublished', 'image'],
    BlogPosting: ['headline', 'author', 'datePublished'],
    Product: ['name', 'image'],
    Organization: ['name', 'url'],
    LocalBusiness: ['name', 'address'],
    Event: ['name', 'startDate', 'location'],
    Recipe: ['name', 'image'],
    FAQPage: ['mainEntity'],
    BreadcrumbList: ['itemListElement'],
    WebSite: ['name', 'url'],
    Person: ['name'],
  };
  const walk = (node, pathStr) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${pathStr}[${i}]`));
    if (!node || typeof node !== 'object') return;
    const t = node['@type'];
    const types = Array.isArray(t) ? t : t ? [t] : [];
    if (!node['@context'] && pathStr === '$') issues.push(`${pathStr}: missing @context`);
    if (!types.length && pathStr === '$') issues.push(`${pathStr}: missing @type`);
    for (const ty of types) {
      for (const req of REQUIRED[ty] || []) {
        if (node[req] == null || node[req] === '') issues.push(`${pathStr} (${ty}): missing recommended "${req}"`);
      }
    }
    if (node['@graph']) walk(node['@graph'], `${pathStr}.@graph`);
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object' && k !== '@graph') walk(v, `${pathStr}.${k}`);
  };
  walk(obj, '$');
  return issues;
}

function analyze(html, finalUrl, res, chain) {
  const $ = cheerio.load(html);
  const head = $('head');
  const warnings = [];
  const warn = (level, msg) => warnings.push({ level, msg });

  // --- core
  const titles = $('title').map((_, e) => $(e).text().trim()).get();
  const title = titles[0] || null;
  const metaBy = (sel) => $(sel).map((_, e) => $(e).attr('content')).get();
  const descs = metaBy('meta[name="description" i]');
  const core = {
    title,
    titleLength: title ? title.length : 0,
    description: descs[0] || null,
    descriptionLength: descs[0] ? descs[0].length : 0,
    charset: $('meta[charset]').attr('charset') || ($('meta[http-equiv="Content-Type" i]').attr('content') || '').match(/charset=([^;]+)/i)?.[1] || null,
    viewport: $('meta[name="viewport" i]').attr('content') || null,
    canonical: abs(finalUrl, $('link[rel="canonical" i]').attr('href')),
    robots: $('meta[name="robots" i]').attr('content') || null,
    googlebot: $('meta[name="googlebot" i]').attr('content') || null,
    lang: $('html').attr('lang') || null,
    dir: $('html').attr('dir') || null,
    themeColor: $('meta[name="theme-color" i]').map((_, e) => ({ content: $(e).attr('content'), media: $(e).attr('media') || null })).get(),
    author: $('meta[name="author" i]').attr('content') || null,
    generator: $('meta[name="generator" i]').attr('content') || null,
    keywords: $('meta[name="keywords" i]').attr('content') || null,
    referrer: $('meta[name="referrer" i]').attr('content') || null,
    colorScheme: $('meta[name="color-scheme" i]').attr('content') || null,
    applicationName: $('meta[name="application-name" i]').attr('content') || null,
    appleMobileWebAppTitle: $('meta[name="apple-mobile-web-app-title" i]').attr('content') || null,
    appleMobileWebAppCapable: $('meta[name="apple-mobile-web-app-capable" i]').attr('content') || null,
    appleStatusBarStyle: $('meta[name="apple-mobile-web-app-status-bar-style" i]').attr('content') || null,
    msTileColor: $('meta[name="msapplication-TileColor" i]').attr('content') || null,
    formatDetection: $('meta[name="format-detection" i]').attr('content') || null,
    baseHref: $('base').attr('href') || null,
    doctype: /^\s*<!doctype\s+html/i.test(html) ? 'html5' : (html.match(/<!DOCTYPE[^>]*>/i)?.[0] || null),
  };

  // --- icons
  const icons = $('link[rel*="icon" i], link[rel="apple-touch-icon" i], link[rel="apple-touch-icon-precomposed" i], link[rel="mask-icon" i]')
    .map((_, e) => ({ rel: $(e).attr('rel'), href: abs(finalUrl, $(e).attr('href')), sizes: $(e).attr('sizes') || null, type: $(e).attr('type') || null, color: $(e).attr('color') || null })).get();

  // --- social
  const og = {}, twitter = {}, article = {}, otherProps = {};
  $('meta[property], meta[name]').each((_, e) => {
    const key = $(e).attr('property') || $(e).attr('name');
    const content = $(e).attr('content');
    if (!key) return;
    const push = (obj, k) => { if (obj[k]) { if (!Array.isArray(obj[k])) obj[k] = [obj[k]]; obj[k].push(content); } else obj[k] = content; };
    const lk = key.toLowerCase();
    if (lk.startsWith('og:')) push(og, key);
    else if (lk.startsWith('twitter:')) push(twitter, key);
    else if (lk.startsWith('article:') || lk.startsWith('profile:') || lk.startsWith('book:')) push(article, key);
    else if (lk.startsWith('fb:') || lk.startsWith('al:') || lk.startsWith('music:') || lk.startsWith('video:')) push(otherProps, key);
  });
  for (const k of ['og:image', 'og:url', 'og:audio', 'og:video', 'twitter:image']) {
    if (og[k]) og[k] = Array.isArray(og[k]) ? og[k].map((v) => abs(finalUrl, v)) : abs(finalUrl, og[k]);
    if (twitter[k]) twitter[k] = Array.isArray(twitter[k]) ? twitter[k].map((v) => abs(finalUrl, v)) : abs(finalUrl, twitter[k]);
  }

  // --- structured data
  const jsonld = [];
  $('script[type="application/ld+json" i]').each((_, e) => {
    const raw = $(e).html() || '';
    try {
      const parsed = JSON.parse(raw);
      jsonld.push({ ok: true, data: parsed, issues: validateJsonLd(parsed) });
    } catch (err) {
      jsonld.push({ ok: false, raw: raw.slice(0, 2000), error: err.message });
    }
  });
  const microdata = parseMicrodata($);
  const rdfa = $('[typeof]').map((_, e) => ({ typeof: $(e).attr('typeof'), vocab: $(e).attr('vocab') || null, properties: $(e).find('[property]').map((_, p) => ({ name: $(p).attr('property'), value: $(p).attr('content') || $(p).text().trim().slice(0, 200) })).get() })).get();

  // --- links & feeds
  const links = {
    hreflang: $('link[rel="alternate" i][hreflang]').map((_, e) => ({ hreflang: $(e).attr('hreflang'), href: abs(finalUrl, $(e).attr('href')) })).get(),
    feeds: $('link[rel="alternate" i][type*="rss" i], link[rel="alternate" i][type*="atom" i], link[rel="alternate" i][type*="json" i]').map((_, e) => ({ type: $(e).attr('type'), title: $(e).attr('title') || null, href: abs(finalUrl, $(e).attr('href')) })).get(),
    manifest: abs(finalUrl, $('link[rel="manifest" i]').attr('href')),
    amp: abs(finalUrl, $('link[rel="amphtml" i]').attr('href')),
    prevNext: $('link[rel="prev" i], link[rel="next" i]').map((_, e) => ({ rel: $(e).attr('rel'), href: abs(finalUrl, $(e).attr('href')) })).get(),
    resourceHints: $('link[rel="preload" i], link[rel="preconnect" i], link[rel="dns-prefetch" i], link[rel="prefetch" i], link[rel="modulepreload" i], link[rel="prerender" i]').map((_, e) => ({ rel: $(e).attr('rel'), href: abs(finalUrl, $(e).attr('href')), as: $(e).attr('as') || null, crossorigin: $(e).attr('crossorigin') != null ? ($(e).attr('crossorigin') || 'anonymous') : null })).get(),
    stylesheets: $('link[rel="stylesheet" i]').map((_, e) => ({ href: abs(finalUrl, $(e).attr('href')), media: $(e).attr('media') || null })).get(),
    scripts: $('script[src]').map((_, e) => ({ src: abs(finalUrl, $(e).attr('src')), type: $(e).attr('type') || null, async: $(e).attr('async') != null, defer: $(e).attr('defer') != null, module: ($(e).attr('type') || '') === 'module' })).get(),
    inlineScripts: $('script:not([src])').not('[type="application/ld+json" i]').length,
    inlineStyles: $('style').length,
    otherHeadLinks: $('head link').filter((_, e) => !/^(stylesheet|icon|shortcut icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon|canonical|alternate|manifest|amphtml|prev|next|preload|preconnect|dns-prefetch|prefetch|modulepreload|prerender)$/i.test($(e).attr('rel') || '')).map((_, e) => ({ rel: $(e).attr('rel'), href: abs(finalUrl, $(e).attr('href')) })).get(),
  };
  const allHrefs = $('a[href]').map((_, e) => $(e).attr('href')).get();
  let host = null; try { host = new URL(finalUrl).host; } catch {}
  const linkStats = { total: allHrefs.length, internal: 0, external: 0, anchors: 0, mailto: 0, tel: 0, nofollow: $('a[rel~="nofollow" i]').length, targetBlankNoRel: $('a[target="_blank" i]').filter((_, e) => !/noopener|noreferrer/i.test($(e).attr('rel') || '')).length };
  for (const h of allHrefs) {
    if (h.startsWith('#')) linkStats.anchors++;
    else if (h.startsWith('mailto:')) linkStats.mailto++;
    else if (h.startsWith('tel:')) linkStats.tel++;
    else { try { new URL(h, finalUrl).host === host ? linkStats.internal++ : linkStats.external++; } catch { linkStats.internal++; } }
  }

  // --- outline
  const headings = $('h1,h2,h3,h4,h5,h6').map((_, e) => ({ level: +e.tagName[1], text: $(e).text().trim().replace(/\s+/g, ' ').slice(0, 160) })).get();
  const images = $('img').map((_, e) => ({ src: abs(finalUrl, $(e).attr('src') || $(e).attr('data-src')), alt: $(e).attr('alt'), width: $(e).attr('width') || null, height: $(e).attr('height') || null, loading: $(e).attr('loading') || null })).get();
  const bodyText = $('body').clone().find('script,style,noscript,template').remove().end().text().replace(/\s+/g, ' ').trim();
  const outline = {
    headings,
    h1Count: headings.filter((h) => h.level === 1).length,
    images: { total: images.length, missingAlt: images.filter((i) => i.alt == null).length, emptyAlt: images.filter((i) => i.alt === '').length, lazy: images.filter((i) => i.loading === 'lazy').length, missingDimensions: images.filter((i) => !i.width || !i.height).length, list: images.slice(0, 200) },
    wordCount: bodyText ? bodyText.split(' ').length : 0,
    htmlBytes: Buffer.byteLength(html),
    landmarks: { main: $('main').length, nav: $('nav').length, header: $('header').length, footer: $('footer').length, article: $('article').length, aside: $('aside').length, section: $('section').length },
    forms: $('form').length,
    iframes: $('iframe').map((_, e) => abs(finalUrl, $(e).attr('src'))).get(),
  };

  // --- http
  const headers = {};
  res.headers.forEach((v, k) => { headers[k] = v; });
  const SECURITY = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy'];
  const http = { finalUrl, status: res.status, statusText: res.statusText, headers, redirectChain: chain, totalMs: chain.reduce((a, c) => a + c.ms, 0), securityHeaders: SECURITY.map((h) => ({ header: h, present: !!headers[h], value: headers[h] || null })), xRobotsTag: headers['x-robots-tag'] || null };

  // --- warnings
  if (!title) warn('error', 'Missing <title>');
  else {
    if (titles.length > 1) warn('warn', `Multiple <title> tags (${titles.length})`);
    if (title.length < SEO_LIMITS.title[0]) warn('warn', `Title is short (${title.length} chars; aim for ${SEO_LIMITS.title[0]}–${SEO_LIMITS.title[1]})`);
    if (title.length > SEO_LIMITS.title[1]) warn('warn', `Title is long (${title.length} chars; may truncate past ${SEO_LIMITS.title[1]})`);
  }
  if (!core.description) warn('error', 'Missing meta description');
  else {
    if (descs.length > 1) warn('warn', `Multiple meta descriptions (${descs.length})`);
    if (core.description.length < SEO_LIMITS.description[0]) warn('info', `Description is short (${core.description.length} chars; ${SEO_LIMITS.description[0]}–${SEO_LIMITS.description[1]} is typical)`);
    if (core.description.length > SEO_LIMITS.description[1]) warn('warn', `Description is long (${core.description.length} chars; may truncate past ${SEO_LIMITS.description[1]})`);
  }
  if (!core.charset) warn('warn', 'No charset declared');
  else if (!/utf-?8/i.test(core.charset)) warn('info', `Charset is ${core.charset} (UTF-8 recommended)`);
  if (!core.viewport) warn('error', 'Missing viewport meta (mobile rendering will be broken)');
  if (!core.lang) warn('warn', 'No lang attribute on <html>');
  if (!core.canonical) warn('info', 'No canonical URL');
  if (core.doctype !== 'html5') warn('warn', core.doctype ? `Non-HTML5 doctype: ${core.doctype}` : 'Missing <!DOCTYPE html> (quirks mode)');
  if (core.robots && /noindex/i.test(core.robots)) warn('info', 'Page is set to noindex');
  if (http.xRobotsTag && /noindex/i.test(http.xRobotsTag)) warn('info', 'X-Robots-Tag header sets noindex');
  if (!icons.length) warn('warn', 'No favicon declared');
  if (!icons.some((i) => /apple-touch-icon/i.test(i.rel))) warn('info', 'No apple-touch-icon');
  if (!og['og:title']) warn('warn', 'Missing og:title');
  if (!og['og:description']) warn('warn', 'Missing og:description');
  if (!og['og:image']) warn('warn', 'Missing og:image (no preview image when shared)');
  if (!og['og:url']) warn('info', 'Missing og:url');
  if (!og['og:type']) warn('info', 'Missing og:type');
  if (og['og:image'] && !og['og:image:width']) warn('info', 'og:image has no og:image:width / height (slower first share)');
  if (og['og:image'] && !og['og:image:alt'] && !twitter['twitter:image:alt']) warn('info', 'No og:image:alt / twitter:image:alt');
  if (!twitter['twitter:card']) warn('warn', 'Missing twitter:card');
  if (!jsonld.length && !microdata.length && !rdfa.length) warn('info', 'No structured data found');
  jsonld.forEach((j, i) => { if (!j.ok) warn('error', `JSON-LD block #${i + 1} is invalid JSON: ${j.error}`); j.issues?.forEach((is) => warn('info', `JSON-LD #${i + 1}: ${is}`)); });
  if (outline.h1Count === 0) warn('warn', 'No <h1> on page');
  if (outline.h1Count > 1) warn('info', `Multiple <h1> tags (${outline.h1Count})`);
  let prev = 0; for (const h of headings) { if (h.level > prev + 1 && prev !== 0) { warn('info', `Heading level skipped: h${prev} → h${h.level} ("${h.text.slice(0, 40)}")`); break; } prev = h.level; }
  if (outline.images.missingAlt) warn('warn', `${outline.images.missingAlt} image(s) missing alt attribute`);
  if (linkStats.targetBlankNoRel) warn('info', `${linkStats.targetBlankNoRel} target="_blank" link(s) without rel="noopener"`);
  if (!links.manifest) warn('info', 'No web app manifest');
  if (!headers['content-type'] || !/text\/html/i.test(headers['content-type'])) warn('warn', `Content-Type is ${headers['content-type'] || 'missing'}`);
  if (!headers['cache-control']) warn('info', 'No Cache-Control header');
  if (http.status >= 400) warn('error', `HTTP ${http.status} ${http.statusText}`);
  if (chain.length > 1) warn('info', `${chain.length - 1} redirect(s) before final URL`);

  const order = { error: 0, warn: 1, info: 2 };
  warnings.sort((a, b) => order[a.level] - order[b.level]);

  return { fetchedAt: new Date().toISOString(), core, icons, social: { og, twitter, article, other: otherProps }, structured: { jsonld, microdata, rdfa }, links, linkStats, outline, http, warnings, headRaw: head.html() ? head.html().trim().slice(0, 50000) : null };
}


const UA = 'MetaInspector/1.0 (local dev tool)';
async function fetchText(url, timeout = 10000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA } });
    return { status: r.status, contentType: r.headers.get('content-type'), text: (await r.text()).slice(0, 200000) };
  } catch (e) { return { status: 0, error: e.message, text: '' }; }
}

// Site-level files (robots, llms.txt, sitemap) cached briefly per origin so crawls don't refetch them per page.
const extrasCache = new Map();
async function fetchExtras(origin) {
  const hit = extrasCache.get(origin);
  if (hit && Date.now() - hit.t < 10000) return hit.v;
  const [robotsTxt, llmsTxt, llmsFullTxt, sitemap] = await Promise.all([
    fetchText(origin + '/robots.txt'), fetchText(origin + '/llms.txt'), fetchText(origin + '/llms-full.txt'), fetchText(origin + '/sitemap.xml'),
  ]);
  const v = { robotsTxt, llmsTxt, llmsFullTxt, sitemap };
  extrasCache.set(origin, { t: Date.now(), v });
  return v;
}

function normalizeUrl(u) {
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  const p = new URL(u); p.hash = ''; return p.href;
}
function friendlyError(err, url) {
  const code = err.cause?.code || err.cause?.errors?.[0]?.code || err.code;
  return code === 'ECONNREFUSED' ? `Connection refused — is your dev server running at ${url}?`
    : code === 'ENOTFOUND' ? `Host not found: ${url}`
    : err.name === 'TimeoutError' ? `Timed out after 15s fetching ${url}`
    : `${err.message}${code ? ` (${code})` : ''}`;
}

async function inspectUrl(url) {
  const { res: r, chain } = await fetchWithRedirects(url);
  const html = await r.text();
  const finalUrl = chain[chain.length - 1].url;
  const data = analyze(html, finalUrl, r, chain);
  const extras = await fetchExtras(new URL(finalUrl).origin);
  data.audit = audit(data, extras);
  data.site = { robots: extras.robotsTxt, llms: extras.llmsTxt, llmsFull: extras.llmsFullTxt, sitemap: extras.sitemap };
  data.internalLinks = collectInternalLinks(html, finalUrl);
  return data;
}

function collectInternalLinks(html, base) {
  const $ = cheerio.load(html); const host = new URL(base).host; const out = new Set();
  $('a[href]').each((_, e) => {
    const href = $(e).attr('href'); if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    try { const u = new URL(href, base); if (u.host !== host) return; u.hash = ''; if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js|ico|mp4|mp3|woff2?)$/i.test(u.pathname)) return; out.add(u.href); } catch {}
  });
  return [...out];
}
function sitemapUrls(xml, host) {
  const out = [];
  for (const m of (xml || '').matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) { try { const u = new URL(m[1]); if (u.host === host) { u.hash = ''; out.push(u.href); } } catch {} }
  return out;
}

app.get('/api/inspect', async (req, res) => {
  let url = (req.query.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url query param required' });
  try { url = normalizeUrl(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  try { res.json(await inspectUrl(url)); }
  catch (err) { res.status(502).json({ error: friendlyError(err, url) }); }
});

// Image proxy for previews (og:image, icons, <img>) so the UI isn't blocked by CORS, hotlink rules or mixed content.
const IMG_MAX_BYTES = 15 * 1024 * 1024;
app.get('/api/img', async (req, res) => {
  const raw = (req.query.url || '').trim();
  let target;
  try { target = new URL(raw); } catch { return res.status(400).send('Invalid URL'); }
  if (!/^https?:$/.test(target.protocol)) return res.status(400).send('Only http(s) URLs');
  try {
    const r = await fetch(target.href, {
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/svg+xml,image/*,*/*;q=0.8', Referer: target.origin + '/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return res.status(r.status).send(`Upstream ${r.status}`);
    const type = r.headers.get('content-type') || '';
    const looksLikeImage = /^image\//i.test(type) || /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(target.pathname);
    if (!looksLikeImage) return res.status(415).send(`Not an image (${type || 'no content-type'})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > IMG_MAX_BYTES) return res.status(413).send('Image too large');
    res.set({
      'Content-Type': /^image\//i.test(type) ? type : 'application/octet-stream',
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      // SVGs can carry script; keep them inert when opened directly.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    });
    res.send(buf);
  } catch (err) { res.status(502).send(friendlyError(err, target.href)); }
});

// Markdown report (?ai=1 adds the prompt preamble). Download with ?download=1.
app.get('/api/report.md', async (req, res) => {
  let url = (req.query.url || '').trim();
  try { url = normalizeUrl(url); } catch { return res.status(400).send('Invalid URL'); }
  try {
    const d = await inspectUrl(url);
    const md = toMarkdown(d, d.audit, { forAI: req.query.ai === '1', site: siteFor(d) });
    res.type('text/markdown');
    if (req.query.download === '1') res.attachment(`meta-report-${new URL(d.http.finalUrl).host.replace(/[^a-z0-9.-]/gi, '_')}.md`);
    res.send(md);
  } catch (err) { res.status(502).send(friendlyError(err, url)); }
});

// Printable standalone HTML report (use the browser's Print → Save as PDF).
app.get('/report', async (req, res) => {
  let url = (req.query.url || '').trim();
  try { url = normalizeUrl(url); } catch { return res.status(400).send('Invalid URL'); }
  try { const d = await inspectUrl(url); res.type('html').send(renderPrintReport(d, d.audit, siteFor(d))); }
  catch (err) { res.status(502).type('text').send(friendlyError(err, url)); }
});

// Latest completed crawl per origin, so the page reports can include every crawled page's rating.
const crawlCache = new Map();
const siteFor = (d) => crawlCache.get(new URL(d.http.finalUrl).origin) || null;

// Crawl every same-host page reachable from the start URL (+ sitemap). Streams NDJSON progress lines.
app.get('/api/crawl', async (req, res) => {
  let url = (req.query.url || '').trim();
  const max = Math.min(500, Math.max(1, parseInt(req.query.max) || 100));
  const concurrency = 4;
  try { url = normalizeUrl(url); } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  res.setHeader('Content-Type', 'application/x-ndjson'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Accel-Buffering', 'no');
  const send = (o) => res.write(JSON.stringify(o) + '\n');
  const host = new URL(url).host;
  const queue = [url]; const seen = new Set([url]); const pages = []; let active = 0; let closed = false;
  req.on('close', () => { closed = true; });
  try {
    const extras = await fetchExtras(new URL(url).origin);
    for (const u of sitemapUrls(extras.sitemap.text, host)) if (!seen.has(u)) { seen.add(u); queue.push(u); }
    send({ type: 'start', url, sitemapUrls: seen.size - 1, max });
  } catch (e) { send({ type: 'start', url, sitemapUrls: 0, max }); }
  await new Promise((resolve) => {
    const next = () => {
      if (closed) return resolve();
      while (active < concurrency && queue.length && pages.length + active < max) {
        const u = queue.shift(); active++;
        inspectUrl(u).then((d) => {
          const a = d.audit;
          const page = { url: u, finalUrl: d.http.finalUrl, status: d.http.status, ms: d.http.totalMs, title: d.core.title, titleLength: d.core.titleLength, description: d.core.description, descriptionLength: d.core.descriptionLength, canonical: d.core.canonical, h1: d.outline.h1Count, words: d.outline.wordCount, images: d.outline.images.total, missingAlt: d.outline.images.missingAlt, ogImage: !!d.social.og['og:image'], jsonld: d.structured.jsonld.length, noindex: !!(d.core.robots && /noindex/i.test(d.core.robots)), score: a.overall, grade: a.grade, categories: a.categories.map((c) => ({ id: c.id, name: c.name, score: c.score, grade: c.grade })), high: a.fixes.filter((f) => f.severity === 'high').length, med: a.fixes.filter((f) => f.severity === 'med').length, low: a.fixes.filter((f) => f.severity === 'low').length, topFixes: a.fixes.slice(0, 3).map((f) => f.msg) };
          pages.push(page);
          const ct = d.http.headers['content-type'] || '';
          if (/text\/html/i.test(ct)) for (const l of d.internalLinks) if (!seen.has(l) && seen.size < max * 3) { seen.add(l); queue.push(l); }
          send({ type: 'page', page, done: pages.length, queued: queue.length });
        }).catch((err) => {
          pages.push({ url: u, status: 0, error: friendlyError(err, u), score: 0, grade: 'F', high: 1, med: 0, low: 0, topFixes: [friendlyError(err, u)] });
          send({ type: 'page', page: pages[pages.length - 1], done: pages.length, queued: queue.length });
        }).finally(() => { active--; if (!queue.length && !active) resolve(); else next(); });
      }
      if (!queue.length && !active) resolve();
    };
    next();
  });
  // site-wide summary
  const ok = pages.filter((p) => p.status === 200);
  const dupTitles = {}, dupDescs = {};
  ok.forEach((p) => { if (p.title) (dupTitles[p.title] ||= []).push(p.url); if (p.description) (dupDescs[p.description] ||= []).push(p.url); });
  const summary = {
    pages: pages.length, ok: ok.length, errors: pages.filter((p) => p.status !== 200).length,
    avgScore: ok.length ? Math.round(ok.reduce((a, p) => a + p.score, 0) / ok.length) : 0,
    duplicateTitles: Object.entries(dupTitles).filter(([, v]) => v.length > 1).map(([t, v]) => ({ title: t, urls: v })),
    duplicateDescriptions: Object.entries(dupDescs).filter(([, v]) => v.length > 1).map(([d, v]) => ({ description: d, urls: v })),
    missingTitle: ok.filter((p) => !p.title).length, missingDescription: ok.filter((p) => !p.description).length, missingOgImage: ok.filter((p) => !p.ogImage).length, noindex: ok.filter((p) => p.noindex).length, noH1: ok.filter((p) => p.h1 === 0).length, truncated: queue.length > 0,
  };
  if (!closed) crawlCache.set(new URL(url).origin, { at: new Date().toISOString(), summary, pages });
  send({ type: 'done', summary, pages });
  res.end();
});

app.listen(PORT, () => {
  console.log(`\n  Meta Inspector running → http://localhost:${PORT}\n`);
});

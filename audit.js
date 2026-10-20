// Scoring + report generation for Meta Inspector.
// Produces category scores (0–100), findings with fixes, AI-readiness analysis, and Markdown export.

const AI_BOTS = [
  { ua: 'GPTBot', owner: 'OpenAI — training + search' },
  { ua: 'OAI-SearchBot', owner: 'OpenAI — ChatGPT search' },
  { ua: 'ChatGPT-User', owner: 'OpenAI — user-triggered browsing' },
  { ua: 'ClaudeBot', owner: 'Anthropic — training' },
  { ua: 'Claude-User', owner: 'Anthropic — user-triggered browsing' },
  { ua: 'Claude-SearchBot', owner: 'Anthropic — search' },
  { ua: 'anthropic-ai', owner: 'Anthropic (legacy)' },
  { ua: 'Google-Extended', owner: 'Google — Gemini training' },
  { ua: 'PerplexityBot', owner: 'Perplexity — search index' },
  { ua: 'Perplexity-User', owner: 'Perplexity — user-triggered browsing' },
  { ua: 'Applebot-Extended', owner: 'Apple — Apple Intelligence' },
  { ua: 'Meta-ExternalAgent', owner: 'Meta — AI training' },
  { ua: 'Amazonbot', owner: 'Amazon — Alexa' },
  { ua: 'CCBot', owner: 'Common Crawl (feeds many models)' },
  { ua: 'Bytespider', owner: 'ByteDance' },
  { ua: 'DuckAssistBot', owner: 'DuckDuckGo AI' },
  { ua: 'YouBot', owner: 'You.com' },
  { ua: 'cohere-ai', owner: 'Cohere' },
  { ua: 'Diffbot', owner: 'Diffbot' },
];

// Minimal robots.txt evaluator: returns 'allowed' | 'blocked' | 'partial' per UA for path "/".
function parseRobots(text) {
  const groups = []; let cur = null;
  for (let raw of (text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); }
    else if ((k === 'allow' || k === 'disallow') && cur) cur.rules.push({ type: k, path: v });
  }
  return groups;
}
function robotsVerdict(groups, ua) {
  const lua = ua.toLowerCase();
  let g = groups.find((g) => g.agents.some((a) => a !== '*' && (lua.includes(a) || a.includes(lua))));
  if (!g) g = groups.find((g) => g.agents.includes('*'));
  if (!g) return { verdict: 'allowed', via: 'no rule' };
  const dis = g.rules.filter((r) => r.type === 'disallow' && r.path);
  const all = g.rules.filter((r) => r.type === 'allow' && r.path);
  const root = dis.some((r) => r.path === '/') && !all.some((r) => r.path === '/');
  const explicit = g.agents.includes(lua) || g.agents.some((a) => a !== '*' && lua.includes(a));
  if (root) return { verdict: 'blocked', via: explicit ? 'explicit' : 'wildcard (*)' };
  if (dis.length) return { verdict: 'partial', via: explicit ? 'explicit' : 'wildcard (*)', paths: dis.map((r) => r.path).slice(0, 6) };
  return { verdict: 'allowed', via: explicit ? 'explicit' : 'wildcard (*)' };
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const grade = (s) => (s >= 90 ? 'A' : s >= 80 ? 'B' : s >= 70 ? 'C' : s >= 55 ? 'D' : 'F');

function audit(d, extras) {
  // d = analyze() output; extras = { robotsTxt, llmsTxt, llmsFullTxt, sitemap }
  const cats = [];
  const mk = (id, name, weight) => { const c = { id, name, weight, score: 100, findings: [] }; cats.push(c); return c; };
  // finding: { severity: 'high'|'med'|'low'|'pass', msg, fix, cost }
  const hit = (c, cost, severity, msg, fix) => { c.score -= cost; c.findings.push({ severity, msg, fix }); };
  const pass = (c, msg) => c.findings.push({ severity: 'pass', msg });

  const core = d.core, og = d.social.og, tw = d.social.twitter, o = d.outline, h = d.http;
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const types = []; const walkT = (n) => { if (Array.isArray(n)) return n.forEach(walkT); if (n && typeof n === 'object') { if (n['@type']) types.push(...[].concat(n['@type'])); Object.values(n).forEach(walkT); } };
  d.structured.jsonld.forEach((j) => j.ok && walkT(j.data));
  d.structured.microdata.forEach((m) => m.type && types.push(m.type.split('/').pop()));
  const has = (t) => types.includes(t);
  const ld = d.structured.jsonld.filter((j) => j.ok).map((j) => j.data);
  const findNode = (pred) => { let out = null; const w = (n) => { if (out) return; if (Array.isArray(n)) return n.forEach(w); if (n && typeof n === 'object') { if (pred(n)) { out = n; return; } Object.values(n).forEach(w); } }; w(ld); return out; };

  // ---------- Core SEO
  const seo = mk('seo', 'Core SEO', 25);
  if (!core.title) hit(seo, 30, 'high', 'Missing <title>', 'Add a unique, descriptive <title> of 30–60 characters.');
  else if (core.titleLength > 60) hit(seo, 8, 'med', `Title is ${core.titleLength} chars (truncates ~60)`, 'Shorten the title; keep the key phrase in the first 50 characters.');
  else if (core.titleLength < 30) hit(seo, 5, 'low', `Title is short (${core.titleLength} chars)`, 'Expand to 30–60 characters with a descriptive phrase.');
  else pass(seo, `Title length OK (${core.titleLength})`);
  if (!core.description) hit(seo, 20, 'high', 'Missing meta description', 'Add <meta name="description"> of 70–160 characters that summarizes the page.');
  else if (core.descriptionLength > 160) hit(seo, 6, 'med', `Description is ${core.descriptionLength} chars (truncates ~160)`, 'Trim to ≤160 characters.');
  else if (core.descriptionLength < 70) hit(seo, 4, 'low', `Description is short (${core.descriptionLength} chars)`, 'Expand to 70–160 characters.');
  else pass(seo, `Description length OK (${core.descriptionLength})`);
  if (!core.canonical) hit(seo, 10, 'med', 'No canonical URL', 'Add <link rel="canonical" href="https://yourdomain/path">.');
  else pass(seo, 'Canonical present');
  if (!core.lang) hit(seo, 6, 'med', 'No lang on <html>', 'Add <html lang="en"> (or the page language).');
  if (!core.viewport) hit(seo, 15, 'high', 'Missing viewport meta', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
  if (core.robots && /noindex/i.test(core.robots)) hit(seo, 25, 'high', 'Page is noindex', 'Remove noindex before launch (fine during dev).');
  if (h.xRobotsTag && /noindex/i.test(h.xRobotsTag)) hit(seo, 25, 'high', 'X-Robots-Tag: noindex header', 'Remove the header on the production server.');
  if (o.h1Count === 0) hit(seo, 10, 'med', 'No <h1>', 'Add exactly one <h1> that states the page topic.');
  else if (o.h1Count > 1) hit(seo, 4, 'low', `${o.h1Count} <h1> tags`, 'Use a single <h1>; demote the others.');
  else pass(seo, 'Single <h1>');
  if (core.doctype !== 'html5') hit(seo, 5, 'med', 'Non-HTML5 or missing doctype', 'Start the document with <!DOCTYPE html>.');
  if (!core.charset) hit(seo, 4, 'low', 'No charset declared', 'Add <meta charset="utf-8"> as the first element in <head>.');
  if (core.keywords) hit(seo, 0, 'low', 'meta keywords present', 'Harmless but ignored by every major engine; safe to remove.');
  if (!d.icons.length) hit(seo, 3, 'low', 'No favicon', 'Add <link rel="icon">; Google shows it in results.');
  seo.score = clamp(seo.score);

  // ---------- Social
  const soc = mk('social', 'Social sharing', 15);
  if (!og['og:title']) hit(soc, 15, 'high', 'Missing og:title', 'Add <meta property="og:title">.');
  if (!og['og:description']) hit(soc, 12, 'med', 'Missing og:description', 'Add <meta property="og:description">.');
  if (!og['og:image']) hit(soc, 30, 'high', 'Missing og:image', 'Add an absolute og:image URL, ideally 1200×630.');
  else {
    const u = first(og['og:image']);
    if (!/^https?:\/\//i.test(u)) hit(soc, 10, 'med', 'og:image is not absolute', 'Use a full https:// URL.');
    if (!og['og:image:width'] || !og['og:image:height']) hit(soc, 4, 'low', 'No og:image:width/height', 'Add width/height so the first share renders with the image.');
    if (!og['og:image:alt'] && !tw['twitter:image:alt']) hit(soc, 3, 'low', 'No og:image:alt', 'Add og:image:alt for accessibility.');
  }
  if (!og['og:url']) hit(soc, 6, 'low', 'Missing og:url', 'Add og:url matching the canonical.');
  if (!og['og:type']) hit(soc, 4, 'low', 'Missing og:type', 'Add og:type (website, article, product…).');
  if (!og['og:site_name']) hit(soc, 3, 'low', 'Missing og:site_name', 'Add og:site_name.');
  if (!tw['twitter:card']) hit(soc, 10, 'med', 'Missing twitter:card', 'Add <meta name="twitter:card" content="summary_large_image">.');
  if (soc.findings.length === 0) pass(soc, 'All key Open Graph + Twitter tags present');
  soc.score = clamp(soc.score);

  // ---------- Structured data
  const sd = mk('structured', 'Structured data', 15);
  const invalid = d.structured.jsonld.filter((j) => !j.ok);
  invalid.forEach((j) => hit(sd, 25, 'high', `Invalid JSON-LD: ${j.error}`, 'Fix the JSON syntax; validate at validator.schema.org.'));
  if (!ld.length && !d.structured.microdata.length) hit(sd, 40, 'high', 'No structured data', 'Add JSON-LD: at minimum WebSite + Organization (or Person) on the home page; Article/Product/etc. on content pages.');
  else {
    pass(sd, `Types found: ${[...new Set(types)].join(', ') || 'untyped'}`);
    if (!has('Organization') && !has('Person') && !has('LocalBusiness')) hit(sd, 15, 'med', 'No Organization/Person entity', 'Add an Organization (or Person) node with name, url, logo, sameAs.');
    if (!has('WebSite')) hit(sd, 8, 'low', 'No WebSite node', 'Add a WebSite node with name + url.');
    if (!has('BreadcrumbList') && o.headings.length > 3) hit(sd, 4, 'low', 'No BreadcrumbList', 'Add breadcrumbs if the page sits in a hierarchy.');
    const issues = d.structured.jsonld.flatMap((j) => j.issues || []);
    issues.forEach((i) => hit(sd, 4, 'low', i, 'Fill in the recommended property.'));
  }
  sd.score = clamp(sd.score);

  // ---------- Accessibility & structure
  const a11y = mk('a11y', 'Accessibility & structure', 15);
  if (o.images.missingAlt) hit(a11y, Math.min(30, 6 * o.images.missingAlt), 'high', `${o.images.missingAlt} image(s) without alt`, 'Add alt text; use alt="" only for decorative images.');
  else if (o.images.total) pass(a11y, 'All images have alt attributes');
  if (!o.landmarks.main) hit(a11y, 8, 'med', 'No <main> landmark', 'Wrap primary content in <main>.');
  if (!o.landmarks.nav && d.linkStats.internal > 3) hit(a11y, 4, 'low', 'No <nav> landmark', 'Wrap site navigation in <nav>.');
  let prev = 0, skipped = false; for (const hh of o.headings) { if (prev && hh.level > prev + 1) skipped = true; prev = hh.level; }
  if (skipped) hit(a11y, 6, 'low', 'Heading levels skipped', 'Keep heading levels sequential (h1 → h2 → h3).');
  if (!core.lang) hit(a11y, 8, 'med', 'No document language', 'Screen readers need <html lang>.');
  if (d.linkStats.targetBlankNoRel) hit(a11y, 4, 'low', `${d.linkStats.targetBlankNoRel} target=_blank link(s) without rel=noopener`, 'Add rel="noopener noreferrer".');
  if (o.images.missingDimensions) hit(a11y, Math.min(10, 2 * o.images.missingDimensions), 'low', `${o.images.missingDimensions} image(s) without width/height`, 'Set width and height to avoid layout shift.');
  a11y.score = clamp(a11y.score);

  // ---------- Technical
  const tech = mk('tech', 'Technical', 10);
  if (h.status >= 400) hit(tech, 60, 'high', `HTTP ${h.status}`, 'Page must return 200.');
  if (h.redirectChain.length > 2) hit(tech, 8, 'med', `${h.redirectChain.length - 1} redirects`, 'Collapse to a single redirect or none.');
  const blocking = d.links.scripts.filter((s) => !s.async && !s.defer && !s.module).length;
  if (blocking) hit(tech, Math.min(15, 5 * blocking), 'med', `${blocking} render-blocking script(s)`, 'Add defer (or type="module") to scripts in <head>.');
  if (!d.links.manifest) hit(tech, 3, 'low', 'No web app manifest', 'Optional: add manifest.json for installability + icons.');
  if (!core.themeColor.length) hit(tech, 2, 'low', 'No theme-color', 'Add <meta name="theme-color"> for mobile browser chrome.');
  if (!d.icons.some((i) => /apple-touch-icon/i.test(i.rel))) hit(tech, 3, 'low', 'No apple-touch-icon', 'Add a 180×180 apple-touch-icon.');
  if (!(h.headers['content-type'] || '').toLowerCase().includes('charset')) hit(tech, 2, 'low', 'Content-Type header has no charset', 'Serve text/html; charset=utf-8.');
  const secMissing = h.securityHeaders.filter((s) => !s.present).map((s) => s.header);
  if (secMissing.length) hit(tech, 0, 'low', `Security headers absent: ${secMissing.length}/${h.securityHeaders.length}`, 'Not scored (normal on dev servers) — add CSP, HSTS, X-Content-Type-Options, Referrer-Policy in production.');
  if (!extras.sitemap || extras.sitemap.status !== 200) hit(tech, 6, 'low', 'No sitemap.xml', 'Generate a sitemap and reference it in robots.txt.');
  if (!extras.robotsTxt || extras.robotsTxt.status !== 200) hit(tech, 6, 'low', 'No robots.txt', 'Add robots.txt (even a permissive one) with a Sitemap: line.');
  if (o.htmlBytes > 300 * 1024) hit(tech, 5, 'low', `HTML is ${(o.htmlBytes / 1024).toFixed(0)} KB`, 'Large HTML slows first render; move data/inline scripts out.');
  tech.score = clamp(tech.score);

  // ---------- AI readiness (GEO)
  const ai = mk('ai', 'AI readiness (GEO)', 20);
  const robotsGroups = parseRobots(extras.robotsTxt?.status === 200 ? extras.robotsTxt.text : '');
  const bots = AI_BOTS.map((b) => ({ ...b, ...robotsVerdict(robotsGroups, b.ua) }));
  const blocked = bots.filter((b) => b.verdict === 'blocked');
  const searchBots = ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended'];
  const blockedSearch = blocked.filter((b) => searchBots.includes(b.ua));
  if (!extras.robotsTxt || extras.robotsTxt.status !== 200) pass(ai, 'No robots.txt → all AI crawlers allowed by default');
  else if (!blocked.length) pass(ai, `All ${AI_BOTS.length} known AI crawlers allowed`);
  else {
    if (blockedSearch.length) hit(ai, Math.min(30, 8 * blockedSearch.length), 'high', `AI search crawlers blocked: ${blockedSearch.map((b) => b.ua).join(', ')}`, 'Allow search/answer bots (OAI-SearchBot, Claude-SearchBot, PerplexityBot) even if you block training bots.');
    const trainOnly = blocked.filter((b) => !searchBots.includes(b.ua));
    if (trainOnly.length) hit(ai, Math.min(15, 2 * trainOnly.length), 'low', `AI training crawlers blocked: ${trainOnly.map((b) => b.ua).join(', ')}`, 'Intentional for many sites; unblock if you want to appear in model knowledge.');
  }
  if (extras.llmsTxt?.status === 200) pass(ai, '/llms.txt present'); else hit(ai, 10, 'med', 'No /llms.txt', 'Add llms.txt: a short Markdown summary of the site with links to key pages (llmstxt.org).');
  if (extras.llmsFullTxt?.status === 200) pass(ai, '/llms-full.txt present');
  // content in HTML
  const ratio = o.wordCount;
  if (ratio < 40) hit(ai, 25, 'high', `Only ${ratio} words in server HTML`, 'Content appears client-rendered. Use SSR/SSG or prerender so crawlers (and most AI agents, which do not run JS) see the text.');
  else if (ratio < 150) hit(ai, 8, 'low', `Thin server-rendered content (${ratio} words)`, 'Ensure the key content is in the initial HTML.');
  else pass(ai, `${ratio} words server-rendered`);
  // entity + authorship
  const org = findNode((n) => ['Organization', 'Person', 'LocalBusiness'].includes(n['@type']) || (Array.isArray(n['@type']) && n['@type'].some((t) => ['Organization', 'Person'].includes(t))));
  if (!org) hit(ai, 10, 'med', 'No Organization/Person entity in structured data', 'AI engines resolve "who is this" from an Organization/Person node with name, url, logo, description, sameAs.');
  else if (!org.sameAs) hit(ai, 6, 'low', 'Entity has no sameAs links', 'Add sameAs: [LinkedIn, GitHub, Wikipedia, X…] to disambiguate the entity.');
  else pass(ai, 'Entity with sameAs present');
  const art = findNode((n) => /Article|BlogPosting|NewsArticle/.test(String(n['@type'])));
  if (art) {
    if (!art.datePublished) hit(ai, 5, 'low', 'Article lacks datePublished', 'AI answers prefer dated, attributable content.');
    if (!art.dateModified) hit(ai, 3, 'low', 'Article lacks dateModified', 'Add dateModified and keep it current.');
    if (!art.author) hit(ai, 5, 'low', 'Article lacks author', 'Add an author Person node.');
  } else if (!d.social.article['article:published_time'] && !core.author) hit(ai, 3, 'low', 'No authorship/date signals', 'For content pages, add Article schema or article:published_time + author meta.');
  if (has('FAQPage') || has('HowTo') || has('QAPage')) pass(ai, 'Q&A-style schema present (FAQPage/HowTo)');
  // answerability
  const qHeads = o.headings.filter((x) => /\?$|^(how|what|why|when|where|who|which|can|should|is|are|do|does)\b/i.test(x.text)).length;
  if (o.headings.length >= 3 && qHeads === 0) hit(ai, 4, 'low', 'No question-style headings', 'Headings phrased as the questions users ask (“How does X work?”) are lifted directly into AI answers.');
  else if (qHeads) pass(ai, `${qHeads} question-style heading(s)`);
  const shortHeads = o.headings.filter((x) => x.text.length < 4).length;
  if (shortHeads) hit(ai, 3, 'low', `${shortHeads} heading(s) too short to be descriptive`, 'Use headings that stand alone out of context.');
  // citability
  if (core.robots && /nosnippet|max-snippet:\s*0/i.test(core.robots)) hit(ai, 15, 'high', 'robots meta blocks snippets', 'Remove nosnippet / max-snippet:0 so engines can quote you.');
  if (!core.canonical && !og['og:url']) hit(ai, 5, 'low', 'No canonical or og:url', 'A stable canonical URL is what AI engines cite.');
  if (!core.description) hit(ai, 6, 'med', 'No meta description for summary', 'AI overviews often reuse the description as the one-line summary.');
  if (core.title && og['og:title'] && first(og['og:title']) !== core.title && !core.title.includes(first(og['og:title']))) hit(ai, 2, 'low', 'Title and og:title disagree', 'Keep them consistent so the entity/title resolves cleanly.');
  ai.score = clamp(ai.score);
  ai.bots = bots;
  ai.llms = { txt: extras.llmsTxt?.status === 200, full: extras.llmsFullTxt?.status === 200, preview: extras.llmsTxt?.status === 200 ? (extras.llmsTxt.text || '').slice(0, 1500) : null };

  const totalW = cats.reduce((a, c) => a + c.weight, 0);
  const overall = clamp(cats.reduce((a, c) => a + c.score * c.weight, 0) / totalW);
  cats.forEach((c) => { c.grade = grade(c.score); });

  // top fixes ordered by severity then category weight
  const sevRank = { high: 0, med: 1, low: 2 };
  const fixes = cats.flatMap((c) => c.findings.filter((f) => f.severity !== 'pass').map((f) => ({ ...f, category: c.name, weight: c.weight })))
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.weight - a.weight);

  return { overall, grade: grade(overall), categories: cats, fixes, generatedAt: new Date().toISOString() };
}

// Every crawled page's rating, worst first — shared by the Markdown and printable reports.
const CAT_SHORT = { seo: 'SEO', social: 'Social', structured: 'Schema', a11y: 'A11y', tech: 'Tech', ai: 'AI' };
function sitePageRows(site) {
  return [...site.pages].sort((x, y) => x.score - y.score).map((p) => ({
    ...p, cats: Object.fromEntries((p.categories || []).map((c) => [c.id, c])),
  }));
}

function toMarkdown(d, a, { forAI = false, site = null } = {}) {
  const L = [];
  if (forAI) {
    L.push('You are helping me improve the metadata, SEO, social sharing, structured data, accessibility and AI-search readiness of a website I am building. Below is an automated audit of one page (plus, if present, the ratings of every other crawled page on the site) and the raw <head> HTML.', '', 'Please: (1) fix every HIGH and MED finding, (2) rewrite the <head> as a complete corrected block I can paste in, (3) write any JSON-LD needed, (4) suggest an llms.txt and robots.txt if missing, (5) explain anything you changed that was not in the findings. Keep my existing content and branding; ask if something is ambiguous.', '', '---', '');
  }
  L.push(`# Metadata audit — ${d.core.title || d.http.finalUrl}`, '', `- URL: ${d.http.finalUrl}`, `- Fetched: ${d.fetchedAt}`, `- HTTP: ${d.http.status} in ${d.http.totalMs} ms`, `- **Overall score: ${a.overall}/100 (${a.grade})**`, '');
  L.push('## Scores', '', '| Category | Score | Grade | Weight |', '|---|---|---|---|');
  a.categories.forEach((c) => L.push(`| ${c.name} | ${c.score} | ${c.grade} | ${c.weight}% |`));
  L.push('', '## Prioritized fixes', '');
  if (!a.fixes.length) L.push('_Nothing to fix._');
  a.fixes.forEach((f, i) => L.push(`${i + 1}. **[${f.severity.toUpperCase()}] ${f.msg}** _(${f.category})_${f.fix ? `\n   - Fix: ${f.fix}` : ''}`));
  L.push('', '## Category detail', '');
  a.categories.forEach((c) => {
    L.push(`### ${c.name} — ${c.score}/100 (${c.grade})`, '');
    c.findings.forEach((f) => L.push(`- ${f.severity === 'pass' ? '✅' : f.severity === 'high' ? '🔴' : f.severity === 'med' ? '🟠' : '🟡'} ${f.msg}`));
    L.push('');
  });
  if (site && site.pages.length) {
    const s = site.summary;
    L.push(`## Site pages — ${s.pages} crawled · average ${s.avgScore}/100`, '', `_Crawled ${site.at}. Errors: ${s.errors} · missing title: ${s.missingTitle} · missing description: ${s.missingDescription} · missing og:image: ${s.missingOgImage} · no h1: ${s.noH1} · noindex: ${s.noindex} · duplicate titles: ${s.duplicateTitles.length} · duplicate descriptions: ${s.duplicateDescriptions.length}_`, '');
    const ids = Object.keys(CAT_SHORT);
    L.push(`| Score | Grade | URL | Status | ${ids.map((id) => CAT_SHORT[id]).join(' | ')} | High | Med | Low | Top issues |`, `|${'---|'.repeat(ids.length + 8)}`);
    sitePageRows(site).forEach((p) => L.push(`| ${p.score} | ${p.grade} | ${p.url} | ${p.status || 'ERR'} | ${ids.map((id) => p.cats[id]?.score ?? '—').join(' | ')} | ${p.high} | ${p.med} | ${p.low} | ${(p.topFixes || []).join('; ').replace(/\|/g, '\\|')} |`));
    L.push('');
  }
  const ai = a.categories.find((c) => c.id === 'ai');
  L.push('## AI crawler access (from robots.txt)', '', '| Crawler | Owner | Status |', '|---|---|---|');
  ai.bots.forEach((b) => L.push(`| ${b.ua} | ${b.owner} | ${b.verdict}${b.paths ? ` (${b.paths.join(', ')})` : ''} |`));
  L.push('', `- llms.txt: ${ai.llms.txt ? 'present' : 'missing'} · llms-full.txt: ${ai.llms.full ? 'present' : 'missing'}`, '');
  L.push('## Current tags', '', '| Tag | Value |', '|---|---|');
  const row = (k, v) => L.push(`| ${k} | ${v == null || v === '' ? '—' : String(Array.isArray(v) ? v.join(', ') : v).replace(/\|/g, '\\|')} |`);
  ['title', 'description', 'canonical', 'lang', 'charset', 'viewport', 'robots'].forEach((k) => row(k, d.core[k]));
  Object.entries(d.social.og).forEach(([k, v]) => row(k, v));
  Object.entries(d.social.twitter).forEach(([k, v]) => row(k, v));
  L.push('', '## Headings', '');
  d.outline.headings.forEach((h) => L.push(`${'  '.repeat(h.level - 1)}- h${h.level}: ${h.text}`));
  if (d.structured.jsonld.length) {
    L.push('', '## JSON-LD', '');
    d.structured.jsonld.forEach((j) => L.push('```json', j.ok ? JSON.stringify(j.data, null, 2) : j.raw, '```', ''));
  }
  L.push('', '## Raw <head>', '', '```html', d.headRaw || '', '```', '');
  return L.join('\n');
}

module.exports = { audit, toMarkdown, sitePageRows, CAT_SHORT, AI_BOTS };

// Standalone printable HTML report (Print → Save as PDF in the browser).
const { sitePageRows, CAT_SHORT } = require('./audit');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderPrintReport(d, a, site = null) {
  const sevColor = { high: '#dc2626', med: '#d97706', low: '#ca8a04', pass: '#16a34a' };
  const gradeColor = (g) => ({ A: '#16a34a', B: '#65a30d', C: '#d97706', D: '#ea580c', F: '#dc2626' }[g]);
  const ai = a.categories.find((c) => c.id === 'ai');
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v == null || v === '' ? '<i>—</i>' : esc(Array.isArray(v) ? v.join(', ') : v)}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Metadata audit — ${esc(d.core.title || d.http.finalUrl)}</title>
<style>
body{font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:#111;margin:0;padding:32px;max-width:900px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;padding-bottom:4px;border-bottom:2px solid #111;text-transform:uppercase;letter-spacing:.06em}h3{font-size:13px;margin:16px 0 6px}
.meta{color:#555;font-size:12px}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:8px}
.score{text-align:center;border:3px solid;border-radius:14px;padding:10px 18px;min-width:110px}.score b{font-size:34px;display:block;line-height:1}.score span{font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.cats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:14px 0}.cat{border:1px solid #ddd;border-radius:10px;padding:10px 12px}.cat b{font-size:22px}.cat small{color:#666;display:block}
.bar{height:6px;background:#eee;border-radius:3px;margin-top:6px}.bar i{display:block;height:100%;border-radius:3px}
ol.fixes{padding-left:22px}ol.fixes li{margin:8px 0}.sev{font:700 10px/1 monospace;color:#fff;padding:3px 6px;border-radius:4px;margin-right:6px;vertical-align:middle}
.fix{color:#444;font-size:12px;margin-top:2px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top;word-break:break-word}th{width:30%;}table.pages td{font-size:11px}th{color:#555;font-weight:500;font-family:monospace}
ul.f{list-style:none;padding:0;margin:0}ul.f li{padding:3px 0}ul.f li::before{content:"●";margin-right:8px}
pre{font:11px/1.45 monospace;background:#f6f6f6;border:1px solid #e5e5e5;padding:10px;white-space:pre-wrap;word-break:break-word;border-radius:6px}
.foot{margin-top:40px;color:#888;font-size:11px;border-top:1px solid #ddd;padding-top:10px}
.noprint{position:fixed;top:12px;right:12px}.noprint button{font:600 13px sans-serif;padding:8px 14px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer}
@media print{.noprint{display:none}body{padding:0}h2{break-after:avoid}.cat,ol.fixes li,tr{break-inside:avoid}}
</style></head><body>
<div class="noprint"><button onclick="print()">Print / Save PDF</button></div>
<div class="top"><div><h1>Metadata audit</h1><div class="meta">${esc(d.http.finalUrl)}<br>${esc(d.core.title || '')}<br>Fetched ${esc(new Date(d.fetchedAt).toLocaleString())} · HTTP ${d.http.status} · ${d.http.totalMs} ms</div></div>
<div class="score" style="border-color:${gradeColor(a.grade)};color:${gradeColor(a.grade)}"><b>${a.overall}</b><span>Overall · ${a.grade}</span></div></div>
<div class="cats">${a.categories.map((c) => `<div class="cat"><b style="color:${gradeColor(c.grade)}">${c.score}</b> <span style="color:${gradeColor(c.grade)};font-weight:700">${c.grade}</span><small>${esc(c.name)} · weight ${c.weight}%</small><div class="bar"><i style="width:${c.score}%;background:${gradeColor(c.grade)}"></i></div></div>`).join('')}</div>
<h2>Prioritized fixes (${a.fixes.length})</h2>
${a.fixes.length ? `<ol class="fixes">${a.fixes.map((f) => `<li><span class="sev" style="background:${sevColor[f.severity]}">${f.severity.toUpperCase()}</span><b>${esc(f.msg)}</b> <span class="meta">— ${esc(f.category)}</span>${f.fix ? `<div class="fix">${esc(f.fix)}</div>` : ''}</li>`).join('')}</ol>` : '<p>Nothing to fix.</p>'}
<h2>Category detail</h2>
${a.categories.map((c) => `<h3>${esc(c.name)} — ${c.score}/100 (${c.grade})</h3><ul class="f">${c.findings.map((f) => `<li style="color:${sevColor[f.severity]}"><span style="color:#111">${esc(f.msg)}</span></li>`).join('')}</ul>`).join('')}
${site && site.pages.length ? `<h2>Site pages — ${site.summary.pages} crawled · average ${site.summary.avgScore}/100</h2>
<p class="meta">Crawled ${esc(new Date(site.at).toLocaleString())} · errors ${site.summary.errors} · missing title ${site.summary.missingTitle} · missing description ${site.summary.missingDescription} · missing og:image ${site.summary.missingOgImage} · no h1 ${site.summary.noH1} · noindex ${site.summary.noindex}</p>
<table class="pages"><tr><td><b>Score</b></td><td><b>URL</b></td>${Object.values(CAT_SHORT).map((n) => `<td><b>${n}</b></td>`).join('')}<td><b>H/M/L</b></td><td><b>Top issue</b></td></tr>
${sitePageRows(site).map((p) => `<tr><td style="color:${gradeColor(p.grade)};font-weight:700;white-space:nowrap">${p.score} ${p.grade}</td><td>${esc(p.url.replace(new URL(d.http.finalUrl).origin, '') || '/')}${p.status === 200 ? '' : ` <b style="color:#dc2626">${p.status || 'ERR'}</b>`}</td>${Object.keys(CAT_SHORT).map((id) => { const c = p.cats[id]; return `<td style="color:${c ? gradeColor(c.grade) : '#999'}">${c ? c.score : '—'}</td>`; }).join('')}<td style="white-space:nowrap">${p.high}/${p.med}/${p.low}</td><td>${esc(p.topFixes?.[0] || '')}</td></tr>`).join('')}</table>` : ''}
<h2>AI crawler access</h2>
<table><tr><th>Crawler</th><td><b>Owner</b></td><td><b>robots.txt verdict</b></td></tr>${ai.bots.map((b) => `<tr><th>${esc(b.ua)}</th><td>${esc(b.owner)}</td><td style="color:${b.verdict === 'allowed' ? '#16a34a' : b.verdict === 'blocked' ? '#dc2626' : '#d97706'};font-weight:600">${esc(b.verdict)}${b.paths ? ` <span style="color:#666;font-weight:400">(${esc(b.paths.join(', '))})</span>` : ''} <span style="color:#999;font-weight:400">via ${esc(b.via)}</span></td></tr>`).join('')}</table>
<p class="meta">llms.txt: <b>${ai.llms.txt ? 'present' : 'missing'}</b> · llms-full.txt: <b>${ai.llms.full ? 'present' : 'missing'}</b></p>
<h2>Current tags</h2>
<table>${['title', 'description', 'canonical', 'lang', 'charset', 'viewport', 'robots'].map((k) => row(k, d.core[k])).join('')}${Object.entries(d.social.og).map(([k, v]) => row(k, v)).join('')}${Object.entries(d.social.twitter).map(([k, v]) => row(k, v)).join('')}</table>
<h2>Headings</h2>
<ul class="f">${d.outline.headings.map((h) => `<li style="padding-left:${(h.level - 1) * 16}px"><code>h${h.level}</code> ${esc(h.text)}</li>`).join('') || '<li>none</li>'}</ul>
${d.structured.jsonld.length ? `<h2>JSON-LD</h2>${d.structured.jsonld.map((j) => `<pre>${esc(j.ok ? JSON.stringify(j.data, null, 2) : j.raw)}</pre>`).join('')}` : ''}
<h2>Raw &lt;head&gt;</h2><pre>${esc(d.headRaw || '')}</pre>
<div class="foot">Generated by Meta Inspector · ${esc(a.generatedAt)}</div>
</body></html>`;
}

module.exports = { renderPrintReport };

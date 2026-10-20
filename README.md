# Meta Inspector

A local dashboard for everything a crawler, a social network, or an AI search engine sees when it looks at the site you're building. Point it at your dev server, get a scored report, and hand the report to an AI (or yourself) to fix.

Built by **EJ**. MIT licensed.

## Features

- **Scored report** — Core SEO, Social sharing, Structured data, Accessibility & structure, Technical, and **AI readiness (GEO)**, each 0–100 with a letter grade, weighted into an overall score, plus a prioritized fix list with a concrete fix for every finding.
- **AI readiness** — per-crawler robots.txt verdicts for 19 AI bots (GPTBot, ClaudeBot, Google-Extended, PerplexityBot, Applebot-Extended, CCBot…), `llms.txt` detection with a starter template, server-rendered-content check, entity/author/date schema signals, answer-shaped headings, and snippet/citation restrictions.
- **Whole-site crawl** — follows every same-host link (plus `sitemap.xml`), scores each page, and surfaces duplicate titles/descriptions, missing tags, 404s, and noindex pages in a sortable table.
- **Exports** — *Copy for AI* (Markdown report with a prompt preamble and the raw `<head>`, ready to paste into Claude or ChatGPT), Markdown download, JSON, printable/PDF report, and site-crawl CSV.
- **Live previews** — Google result, Facebook/LinkedIn/iMessage card, X card, Slack/Discord unfurl, with og:image dimension checks.
- **Everything else** — every meta/OG/Twitter tag, JSON-LD / microdata / RDFa (parsed and validated), hreflang, feeds, resource hints, scripts, heading tree, image alt coverage, redirect chain, security headers, robots.txt, sitemap, manifest.
- **Auto-refresh** while you edit; keyboard shortcuts; bookmarkable URLs; dark/light.

Fetching is done server-side so your dev server needs no CORS setup. Nothing leaves your machine.

## Run

```bash
git clone https://github.com/ejq17/meta-inspector.git
cd meta-inspector
npm install
npm start          # → http://localhost:4040
```

Type your dev URL (`localhost:3000`, `127.0.0.1:5173/about`, `mysite.test`) and press Inspect.

- **↻ Auto** re-fetches every N seconds; the status bar says *unchanged* when nothing moved.
- `R` re-fetch · `1–9` switch tabs.
- Bookmark `http://localhost:4040/?url=localhost:3000`.
- `PORT=5050 npm start` to change the port.

## Tabs

| Tab | What's there |
|---|---|
| Report | Scores, grades, prioritized fixes, per-category findings, export buttons |
| AI | AI-readiness score, findings, llms.txt, per-crawler robots.txt verdicts |
| Site | Crawl the whole site; per-page scores, duplicates, CSV/Markdown export |
| Overview | Warnings, core tags with length checks, theme/app tags, favicons, page stats |
| Social | Preview cards + every og:/twitter:/article: tag, og:image dimensions |
| Structured | JSON-LD (highlighted, missing-field checks), microdata, RDFa |
| Links | hreflang, feeds, manifest, resource hints, scripts, stylesheets, anchor stats |
| Outline | Heading tree, landmarks, image list with alt coverage |
| Http | Status, timing, redirect chain, security headers, all headers |
| Files | robots.txt, sitemap.xml, manifest, humans.txt, security.txt, ads.txt |
| Raw | `<head>` source and the full JSON |

## HTTP API

Useful for scripts and CI:

| Endpoint | Returns |
|---|---|
| `GET /api/inspect?url=` | Full JSON (tags, structured data, outline, headers, `audit`) |
| `GET /api/report.md?url=&ai=1&download=1` | Markdown report; `ai=1` adds the AI prompt preamble |
| `GET /report?url=` | Printable HTML report |
| `GET /api/crawl?url=&max=100` | NDJSON stream: `start`, one `page` per URL, then `done` with a site summary |

## How scoring works

Each category starts at 100 and loses points per finding (high ≈ 15–40, med ≈ 6–15, low ≈ 2–8). Weights: Core SEO 25%, AI readiness 20%, Social 15%, Structured data 15%, Accessibility 15%, Technical 10%. Security headers are reported but not scored, since they're normally absent on dev servers. Blocking AI *search* crawlers costs more than blocking *training* crawlers. All of this lives in [`audit.js`](audit.js) and is easy to tune.

## Limitations

It inspects the HTML your server sends, not what JavaScript renders afterward — which is also what link-preview bots and most AI crawlers see. A client-rendered SPA will show an empty shell and get flagged for it.

## Project layout

```
server.js        Express server: fetch, parse (cheerio), crawl, API routes
audit.js         Scoring rules, AI-crawler list, robots.txt evaluation, Markdown export
report-html.js   Printable report template
public/          Single-file front end (no build step)
```

## License

MIT © EJ — see [LICENSE](LICENSE).

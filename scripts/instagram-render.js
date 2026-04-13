#!/usr/bin/env node
/**
 * Instagram Carousel Image Generator for Lumied Blog
 * Usage: node scripts/instagram-render.js <slug>
 * Generates 5 slides (1080x1080) as PNGs in /tmp/ig-slides/
 */

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// --- Config ---
const SITE_DIR = path.join(__dirname, '..', 'site', 'blog');
const OUT_DIR = process.platform === 'win32' ? path.join(process.env.TEMP || 'C:\\Temp', 'ig-slides') : '/tmp/ig-slides';
const SIZE = 1080;

// --- Brand ---
const BRAND = {
  primary: '#6C63FF',
  accent: '#F59E0B',
  dark: '#0F172A',
  green: '#10B981',
  red: '#EF4444',
  muted: '#94A3B8',
  light: '#FAFAFA',
  textDark: '#1E293B',
};

// --- Helpers ---
function extractData(html) {
  const data = {};

  // Title from <h1>
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  data.title = h1Match ? h1Match[1].replace(/<[^>]+>/g, '').trim() : 'Artigo Lumied';

  // Category from article:section meta
  const catMatch = html.match(/<meta\s+property=["']article:section["']\s+content=["']([^"']+)["']/i);
  data.category = catMatch ? catMatch[1].trim() : 'Blog';

  // Lead paragraph — first <p> after article-content div
  const contentStart = html.indexOf('article-content');
  if (contentStart > -1) {
    const afterContent = html.substring(contentStart);
    const leadMatch = afterContent.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    data.lead = leadMatch ? leadMatch[1].replace(/<[^>]+>/g, '').trim() : '';
  }
  data.lead = data.lead || 'Descubra como transformar a gestao da sua escola com tecnologia.';

  // First blockquote text
  const bqMatch = html.match(/<blockquote[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/blockquote>/i);
  data.quote = bqMatch ? bqMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // First scenario-box text
  const scenarioMatch = html.match(/class=["']scenario-box["'][^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
  data.scenarioText = scenarioMatch ? scenarioMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // Extract a statistic — look for numbers in blockquote or scenario-box
  data.stat = extractStat(data.quote || data.scenarioText || data.lead);

  // If no quote found, use lead
  if (!data.quote) data.quote = data.lead;

  // TOC items
  data.tocItems = [];
  const tocMatch = html.match(/<nav\s+class=["']toc["'][^>]*>[\s\S]*?<ol>([\s\S]*?)<\/ol>/i);
  if (tocMatch) {
    const liRegex = /<li[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi;
    let m;
    while ((m = liRegex.exec(tocMatch[1])) !== null) {
      data.tocItems.push(m[1].replace(/<[^>]+>/g, '').trim());
    }
  }
  // Limit to 5 items
  data.tocItems = data.tocItems.slice(0, 5);
  if (data.tocItems.length === 0) {
    data.tocItems = ['Introducao', 'Contexto', 'Solucao', 'Resultados', 'Conclusao'];
  }

  return data;
}

function extractStat(text) {
  // Split text into sentences first for cleaner context
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 10);

  // Patterns ordered by visual impact for Instagram
  const patterns = [
    { re: /(R\$\s*[\d.,]+\s*(?:mil|k|milhões|mi)?)/i, label: 'currency' },
    { re: /(\d+\.?\d*\s*%)/,                           label: 'percent' },
    { re: /(\d+\.?\d*\s*(?:horas?|h)\b)/i,             label: 'hours' },
    { re: /(\d+\.?\d*\s*(?:dias?|d)\b)/i,              label: 'days' },
    { re: /(\d+\.?\d*x)/i,                              label: 'multiplier' },
  ];

  for (const { re } of patterns) {
    for (const sentence of sentences) {
      const m = sentence.match(re);
      if (m) {
        // Build context: take the meaningful part of the sentence around the stat
        const statIdx = sentence.indexOf(m[1]);
        // Take text before the stat — usually the description
        let before = sentence.substring(0, statIdx).replace(/&[a-z]+;/gi, '').trim();
        // Remove trailing connectors like "é de", "de", "em"
        before = before.replace(/\s+(é de|de|em|por|a|com|para)\s*$/i, '').trim();
        // Take text after the stat as secondary context
        let after = sentence.substring(statIdx + m[1].length).replace(/&[a-z]+;/gi, '').trim();
        after = after.replace(/^\s*[-—]+\s*/, '').replace(/^(e|ou)\s+/i, '').trim();
        // Prefer before (the description), only use after as fallback
        let context = before || after;
        // Clean up
        context = context.replace(/\s{2,}/g, ' ').replace(/^[.,;:\s]+/, '').replace(/[.,;:\s]+$/, '');
        // Truncate context
        if (context.length > 100) {
          context = context.substring(0, 100).replace(/\s+\S*$/, '') + '...';
        }
        return { number: m[1].trim(), context };
      }
    }
  }

  // Fallback: try any big number in the full text
  const bigNum = text.match(/(\d{2,})/);
  if (bigNum) {
    return { number: bigNum[1], context: 'dados relevantes para sua escola' };
  }

  return { number: '100%', context: 'conformidade legal com tecnologia' };
}

function truncateTitle(title, maxChars = 90) {
  if (title.length <= maxChars) return title;
  return title.substring(0, maxChars).replace(/\s+\S*$/, '') + '...';
}

// --- Slide HTML Generators ---
const FONTS_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,700;0,800;1,700&display=swap');`;

const BASE_STYLE = `
${FONTS_IMPORT}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: ${SIZE}px; height: ${SIZE}px; overflow: hidden; }
`;

function slideHero(data) {
  const title = truncateTitle(data.title);
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  background: linear-gradient(135deg, ${BRAND.dark} 0%, #1A1030 50%, ${BRAND.dark} 100%);
  color: #fff;
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 60px 64px;
  position: relative;
}
.grid-overlay {
  position: absolute; inset: 0; opacity: 0.04;
  background-image: linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px);
  background-size: 60px 60px;
  pointer-events: none;
}
.top { display: flex; justify-content: space-between; align-items: flex-start; }
.logo { font-family: 'Playfair Display', serif; font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
.badge {
  display: inline-block;
  background: ${BRAND.primary};
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  padding: 8px 20px;
  border-radius: 100px;
}
.center { flex: 1; display: flex; align-items: center; }
h1 {
  font-family: 'Playfair Display', serif;
  font-size: 46px;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -1px;
  max-width: 900px;
}
.bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: ${BRAND.muted};
  font-size: 15px;
}
.arrow { font-size: 18px; }
</style></head><body>
<div class="grid-overlay"></div>
<div class="top">
  <div class="logo">LUMIED</div>
  <div class="badge">${data.category}</div>
</div>
<div class="center">
  <h1>${title}</h1>
</div>
<div class="bottom">
  <span>lumied.com.br</span>
  <span class="arrow">arrasta &rarr;</span>
</div>
</body></html>`;
}

function slideStat(data) {
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  background: ${BRAND.primary};
  color: #fff;
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 60px 64px;
  position: relative;
  text-align: center;
}
.stat {
  font-family: 'Playfair Display', serif;
  font-size: 140px;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 24px;
  letter-spacing: -4px;
}
.context {
  font-size: 24px;
  opacity: 0.8;
  max-width: 700px;
  line-height: 1.5;
}
.brand {
  position: absolute;
  bottom: 48px;
  right: 64px;
  font-family: 'Playfair Display', serif;
  font-size: 18px;
  font-weight: 800;
  opacity: 0.5;
}
</style></head><body>
<div class="stat">${data.stat.number}</div>
<div class="context">${data.stat.context}</div>
<div class="brand">LUMIED</div>
</body></html>`;
}

function slideQuote(data) {
  // Truncate quote to ~200 chars for readability
  let quote = data.quote;
  if (quote.length > 220) {
    quote = quote.substring(0, 220).replace(/\s+\S*$/, '') + '...';
  }
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  background: ${BRAND.light};
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 80px 80px 60px 86px;
  position: relative;
}
.quote-mark {
  position: absolute;
  top: 50px;
  left: 60px;
  font-family: 'Playfair Display', serif;
  font-size: 240px;
  color: ${BRAND.primary};
  opacity: 0.12;
  line-height: 1;
  pointer-events: none;
}
.left-border {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 6px;
  background: ${BRAND.primary};
}
.quote {
  font-family: 'Playfair Display', serif;
  font-size: 32px;
  font-weight: 700;
  font-style: italic;
  color: ${BRAND.textDark};
  line-height: 1.5;
  margin-bottom: 32px;
  position: relative;
  z-index: 1;
}
.author {
  font-size: 16px;
  color: #64748B;
  font-weight: 500;
}
.bottom-line {
  position: absolute;
  bottom: 48px;
  left: 80px;
  right: 80px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 16px;
  border-top: 1px solid #E2E8F0;
  color: #94A3B8;
  font-size: 14px;
}
</style></head><body>
<div class="left-border"></div>
<div class="quote-mark">&ldquo;</div>
<div class="quote">${quote}</div>
<div class="author">Equipe Lumied &middot; Blog Lumied</div>
<div class="bottom-line">
  <span>lumied.com.br</span>
</div>
</body></html>`;
}

function slideList(data) {
  const items = data.tocItems.map((item, i) => `
    <div class="item">
      <div class="num">${String(i + 1).padStart(2, '0')}</div>
      <div class="text">${item}</div>
    </div>
  `).join('');

  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  background: linear-gradient(135deg, ${BRAND.primary} 0%, #3B82F6 100%);
  color: #fff;
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 80px 72px;
  position: relative;
}
h2 {
  font-family: 'Inter', sans-serif;
  font-size: 28px;
  font-weight: 800;
  margin-bottom: 48px;
  letter-spacing: -0.5px;
}
.item {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 28px;
}
.num {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 800;
  flex-shrink: 0;
}
.text {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.4;
}
.brand {
  position: absolute;
  bottom: 48px;
  right: 64px;
  font-family: 'Playfair Display', serif;
  font-size: 18px;
  font-weight: 800;
  opacity: 0.5;
}
</style></head><body>
<h2>Neste artigo</h2>
${items}
<div class="brand">LUMIED</div>
</body></html>`;
}

function slideCTA(data) {
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  background: ${BRAND.dark};
  background-image: radial-gradient(ellipse 60% 50% at 50% 50%, rgba(108,99,255,0.15) 0%, transparent 70%);
  color: #fff;
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 80px 72px;
  position: relative;
}
h2 {
  font-family: 'Playfair Display', serif;
  font-size: 48px;
  font-weight: 800;
  line-height: 1.2;
  margin-bottom: 40px;
  letter-spacing: -1px;
  max-width: 800px;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: ${BRAND.primary};
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  padding: 20px 40px;
  border-radius: 14px;
  margin-bottom: 48px;
  box-shadow: 0 8px 32px rgba(108,99,255,0.4);
}
.sub {
  color: ${BRAND.muted};
  font-size: 16px;
}
.bottom {
  position: absolute;
  bottom: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: ${BRAND.muted};
  font-size: 14px;
}
</style></head><body>
<h2>Transforme sua escola</h2>
<div class="btn">Agende uma demo &rarr;</div>
<div class="bottom">
  <span>lumied.com.br</span>
  <span>Link na bio &#9757;</span>
</div>
</body></html>`;
}

// --- Main ---
async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/instagram-render.js <slug>');
    console.error('Example: node scripts/instagram-render.js compliance-escolar');
    process.exit(1);
  }

  const articlePath = path.join(SITE_DIR, slug, 'index.html');
  if (!fs.existsSync(articlePath)) {
    console.error(`Article not found: ${articlePath}`);
    process.exit(1);
  }

  // Read & extract
  console.log(`Reading: ${articlePath}`);
  const html = fs.readFileSync(articlePath, 'utf-8');
  const data = extractData(html);

  console.log(`Title: ${data.title}`);
  console.log(`Category: ${data.category}`);
  console.log(`Stat: ${data.stat.number} — ${data.stat.context}`);
  console.log(`TOC items: ${data.tocItems.length}`);

  // Generate slide HTML
  const slides = [
    { name: 'slide-1-hero', html: slideHero(data) },
    { name: 'slide-2-stat', html: slideStat(data) },
    { name: 'slide-3-quote', html: slideQuote(data) },
    { name: 'slide-4-list', html: slideList(data) },
    { name: 'slide-5-cta', html: slideCTA(data) },
  ];

  // Ensure output dir
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Write HTML files
  for (const slide of slides) {
    const htmlPath = path.join(OUT_DIR, `${slide.name}.html`);
    fs.writeFileSync(htmlPath, slide.html, 'utf-8');
  }

  // Launch Puppeteer & screenshot
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const outputPaths = [];

    for (const slide of slides) {
      const htmlPath = path.join(OUT_DIR, `${slide.name}.html`);
      const pngPath = path.join(OUT_DIR, `${slide.name}.png`);

      const page = await browser.newPage();
      await page.setViewport({ width: SIZE, height: SIZE, deviceScaleFactor: 1 });

      // Load the HTML file
      const fileUrl = `file://${htmlPath.replace(/\\/g, '/')}`;
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });

      // Wait a bit for fonts to load
      await page.evaluate(() => document.fonts.ready);

      await page.screenshot({ path: pngPath, type: 'png' });
      await page.close();

      outputPaths.push(pngPath);
      console.log(`Generated: ${pngPath}`);
    }

    // Print output paths
    console.log('\n--- Output files ---');
    for (const p of outputPaths) {
      console.log(p);
    }

  } catch (err) {
    console.error('Puppeteer error:', err.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});

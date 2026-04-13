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

// --- Load logo as base64 data URI ---
const LOGO_PATH = path.join(__dirname, '..', 'lumied-logo-branco.png');
let LOGO_DATA_URI = '';
try {
  const logoBuffer = fs.readFileSync(LOGO_PATH);
  LOGO_DATA_URI = 'data:image/png;base64,' + logoBuffer.toString('base64');
} catch (e) {
  console.warn('Warning: Could not load lumied-logo-branco.png, falling back to text logo');
}

// --- Category background images (Unsplash) ---
const CATEGORY_IMAGES = {
  'Compliance': 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=1080&h=1080&fit=crop',
  'Pedagogia': 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=1080&h=1080&fit=crop',
  'Financeiro': 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1080&h=1080&fit=crop',
  'Gestão': 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=1080&h=1080&fit=crop',
  'Comercial': 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1080&h=1080&fit=crop',
  'EdTech': 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1080&h=1080&fit=crop',
  'Comunicação': 'https://images.unsplash.com/photo-1577563908411-5077b6dc7624?w=1080&h=1080&fit=crop',
  'Segurança': 'https://images.unsplash.com/photo-1558002038-1055907df827?w=1080&h=1080&fit=crop',
  'Legal': 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1080&h=1080&fit=crop',
  'Legal e Compliance': 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1080&h=1080&fit=crop',
  'Operacional': 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1080&h=1080&fit=crop',
  'Marketing': 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1080&h=1080&fit=crop',
  'RH': 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=1080&h=1080&fit=crop',
};
const DEFAULT_BG_IMAGE = 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=1080&h=1080&fit=crop';

function getCategoryImage(category) {
  return CATEGORY_IMAGES[category] || DEFAULT_BG_IMAGE;
}

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

// --- Logo HTML helper ---
function logoImg(height) {
  if (LOGO_DATA_URI) {
    return `<img src="${LOGO_DATA_URI}" style="height:${height}px;width:auto;display:block;" alt="Lumied" />`;
  }
  return `<span style="font-family:'Playfair Display',serif;font-size:${Math.round(height * 0.5)}px;font-weight:800;color:#fff;">LUMIED</span>`;
}

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
  const bgUrl = getCategoryImage(data.category);
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  font-family: 'Inter', sans-serif;
  color: #fff;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(180deg, rgba(15,23,42,0.6) 0%, rgba(15,23,42,0.9) 100%), url('${bgUrl}');
  background-size: cover;
  background-position: center;
  z-index: 0;
}
.content {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  justify-content: space-between;
  height: 100%; padding: 56px 64px;
}
.top { display: flex; justify-content: space-between; align-items: flex-start; }
.logo img { height: 52px; width: auto; }
.badge {
  display: inline-block;
  background: ${BRAND.primary};
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  padding: 6px 16px;
  border-radius: 100px;
  font-family: 'Inter', sans-serif;
}
.center { flex: 1; display: flex; align-items: center; padding-left: 20px; position: relative; }
.accent-bar {
  position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 4px; height: 60px; background: ${BRAND.primary}; border-radius: 2px;
}
h1 {
  font-family: 'Playfair Display', serif;
  font-size: 42px;
  font-weight: 700;
  line-height: 1.18;
  letter-spacing: -1px;
  max-width: 900px;
  text-shadow: 0 2px 20px rgba(0,0,0,0.5);
}
.bottom {
  border-top: 1px solid rgba(255,255,255,0.2);
  padding-top: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: ${BRAND.muted};
  font-size: 13px;
  font-family: 'Inter', sans-serif;
}
</style></head><body>
<div class="bg"></div>
<div class="content">
  <div class="top">
    <div class="logo">${logoImg(52)}</div>
    <div class="badge">${data.category}</div>
  </div>
  <div class="center">
    <div class="accent-bar"></div>
    <h1>${title}</h1>
  </div>
  <div class="bottom">
    <span>lumied.com.br</span>
    <span>&rarr; arrasta</span>
  </div>
</div>
</body></html>`;
}

function slideStat(data) {
  const bgUrl = getCategoryImage(data.category);
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  font-family: 'Inter', sans-serif;
  color: #fff;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(135deg, rgba(108,99,255,0.88) 0%, rgba(59,130,246,0.88) 100%), url('${bgUrl}');
  background-size: cover;
  background-position: center;
  z-index: 0;
}
.content {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  justify-content: center; align-items: center;
  height: 100%; padding: 60px 64px;
  text-align: center;
}
.deco-circle {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 200px; height: 200px;
  border: 2px solid rgba(255,255,255,0.15);
  border-radius: 50%;
  z-index: 0;
}
.stat {
  font-family: 'Playfair Display', serif;
  font-size: 120px;
  font-weight: 800;
  line-height: 1;
  margin-bottom: 24px;
  letter-spacing: -4px;
  text-shadow: 0 4px 30px rgba(0,0,0,0.3);
  position: relative; z-index: 1;
}
.context {
  font-size: 22px;
  opacity: 0.85;
  max-width: 700px;
  line-height: 1.5;
  position: relative; z-index: 1;
}
.brand-logo {
  position: absolute;
  bottom: 48px;
  right: 64px;
  z-index: 1;
}
</style></head><body>
<div class="bg"></div>
<div class="content">
  <div class="deco-circle"></div>
  <div class="stat">${data.stat.number}</div>
  <div class="context">${data.stat.context}</div>
</div>
<div class="brand-logo">${logoImg(32)}</div>
</body></html>`;
}

function slideQuote(data) {
  // Truncate quote to ~200 chars for readability
  let quote = data.quote;
  if (quote.length > 220) {
    quote = quote.substring(0, 220).replace(/\s+\S*$/, '') + '...';
  }
  const bgUrl = getCategoryImage(data.category);
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  background: #F8FAFC;
  font-family: 'Inter', sans-serif;
  position: relative;
  display: flex;
  flex-direction: column;
}
.image-strip {
  width: 100%; height: 320px;
  background-image: url('${bgUrl}');
  background-size: cover;
  background-position: center;
  border-radius: 0 0 24px 24px;
  flex-shrink: 0;
}
.quote-section {
  flex: 1;
  padding: 40px 80px 60px 86px;
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.quote-mark {
  position: absolute;
  top: 10px;
  left: 60px;
  font-family: 'Playfair Display', serif;
  font-size: 200px;
  color: ${BRAND.primary};
  opacity: 0.2;
  line-height: 1;
  pointer-events: none;
}
.left-bar {
  position: absolute;
  left: 66px; top: 80px;
  width: 4px; height: 200px;
  background: ${BRAND.primary};
  border-radius: 2px;
}
.quote {
  font-family: 'Playfair Display', serif;
  font-size: 28px;
  font-weight: 700;
  font-style: italic;
  color: ${BRAND.textDark};
  line-height: 1.5;
  margin-bottom: 24px;
  position: relative;
  z-index: 1;
}
.author {
  font-size: 15px;
  color: #64748B;
  font-weight: 500;
  position: relative;
  z-index: 1;
}
.bottom-line {
  position: absolute;
  bottom: 36px;
  left: 80px; right: 80px;
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 16px;
  border-top: 1px solid #E2E8F0;
}
</style></head><body>
<div class="image-strip"></div>
<div class="quote-section">
  <div class="quote-mark">&ldquo;</div>
  <div class="left-bar"></div>
  <div class="quote">${quote}</div>
  <div class="author">Equipe Lumied &middot; Blog Lumied</div>
</div>
<div class="bottom-line">${logoImg(28)}</div>
</body></html>`;
}

function slideList(data) {
  const items = data.tocItems.map((item, i) => `
    <div class="item">
      <div class="num">${i + 1}</div>
      <div class="text">${item}</div>
    </div>
    ${i < data.tocItems.length - 1 ? '<div class="separator"></div>' : ''}
  `).join('');

  const bgUrl = getCategoryImage(data.category);
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  font-family: 'Inter', sans-serif;
  color: #fff;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(180deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.92) 100%), url('${bgUrl}');
  background-size: cover;
  background-position: center;
  z-index: 0;
}
.content {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  justify-content: center;
  height: 100%; padding: 72px 72px;
}
h2 {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin-bottom: 48px;
  position: relative;
  display: inline-block;
}
h2::after {
  content: '';
  position: absolute;
  bottom: -8px; left: 0;
  width: 40px; height: 2px;
  background: ${BRAND.primary};
  box-shadow: 0 0 10px rgba(108,99,255,0.5);
}
.item {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 0;
}
.num {
  width: 40px; height: 40px;
  border-radius: 50%;
  background: ${BRAND.primary};
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; font-weight: 800;
  flex-shrink: 0;
  color: #fff;
}
.text {
  font-size: 18px;
  font-weight: 500;
  line-height: 1.4;
}
.separator {
  height: 1px;
  background: rgba(255,255,255,0.08);
  margin: 4px 0 4px 60px;
}
.brand-logo {
  position: absolute;
  bottom: 48px;
  left: 50%; transform: translateX(-50%);
  z-index: 1;
}
</style></head><body>
<div class="bg"></div>
<div class="content">
  <h2>Neste artigo</h2>
  ${items}
</div>
<div class="brand-logo">${logoImg(32)}</div>
</body></html>`;
}

function slideCTA(data) {
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  background: ${BRAND.dark};
  color: #fff;
  font-family: 'Inter', sans-serif;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 80px 72px;
  position: relative;
  overflow: hidden;
}
.glow-1 {
  position: absolute;
  top: -100px; right: -100px;
  width: 400px; height: 400px;
  background: ${BRAND.primary};
  opacity: 0.2;
  border-radius: 50%;
  filter: blur(100px);
  pointer-events: none;
}
.glow-2 {
  position: absolute;
  bottom: -80px; left: -80px;
  width: 250px; height: 250px;
  background: #3B82F6;
  opacity: 0.15;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
}
.logo-wrap { margin-bottom: 40px; }
h2 {
  font-family: 'Playfair Display', serif;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 12px;
  letter-spacing: -1px;
  max-width: 800px;
  position: relative; z-index: 1;
}
.subtitle {
  font-size: 20px;
  color: ${BRAND.muted};
  margin-bottom: 48px;
  position: relative; z-index: 1;
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: ${BRAND.primary};
  color: #fff;
  font-size: 20px;
  font-weight: 700;
  padding: 16px 32px;
  border-radius: 12px;
  margin-bottom: 48px;
  box-shadow: 0 8px 32px rgba(108,99,255,0.4);
  position: relative; z-index: 1;
}
.url {
  color: ${BRAND.muted};
  font-size: 14px;
  margin-bottom: 8px;
  position: relative; z-index: 1;
}
.bio {
  color: ${BRAND.primary};
  font-size: 14px;
  position: relative; z-index: 1;
}
</style></head><body>
<div class="glow-1"></div>
<div class="glow-2"></div>
<div class="logo-wrap">${logoImg(56)}</div>
<h2>Transforme sua escola</h2>
<div class="subtitle">com intelig&ecirc;ncia artificial</div>
<div class="btn">Agende uma demo &rarr;</div>
<div class="url">lumied.com.br</div>
<div class="bio">Link na bio &#x1F446;</div>
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
  console.log(`Background: ${getCategoryImage(data.category)}`);

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

      // Wait for fonts to load
      await page.evaluate(() => document.fonts.ready);

      // Wait for background images (Unsplash) to fully load
      try {
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 });
      } catch (_) {
        // timeout is OK — image may already be loaded or unavailable
      }

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

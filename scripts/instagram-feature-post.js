#!/usr/bin/env node
/**
 * Instagram Feature Carousel Publisher for Lumied (@lumi.ed)
 * Usage: node scripts/instagram-feature-post.js [--dry-run]
 *
 * Generates a 7-slide commercial feature carousel (1080x1080) and publishes it.
 * Reads feature-posts.json, picks the next feature with status "pending".
 *
 * Env vars:
 *   INSTAGRAM_ACCESS_TOKEN (required for publish)
 *   INSTAGRAM_USER_ID (default: 17841436678488566)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

const IG_USER_ID = process.env.INSTAGRAM_USER_ID || '17841436678488566';
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || '';
const SUPABASE_URL = 'https://brgorknbrjlfwvrrlwxj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE';
const GRAPH_API = 'https://graph.facebook.com/v21.0';
const DRY_RUN = process.argv.includes('--dry-run');
const OUT_DIR = process.platform === 'win32' ? path.join(process.env.TEMP || 'C:\\Temp', 'ig-feature') : '/tmp/ig-feature';

// --- Load logo as base64 data URI ---
const LOGO_PATH = path.join(__dirname, '..', 'lumied-logo-branco.png');
let LOGO_DATA_URI = '';
try {
  const logoBuffer = fs.readFileSync(LOGO_PATH);
  LOGO_DATA_URI = 'data:image/png;base64,' + logoBuffer.toString('base64');
} catch (e) {
  console.warn('Warning: Could not load lumied-logo-branco.png, falling back to text logo');
}

// --- Keyword-based Image Bank ---
const IMAGE_BANK = {
  'escola': 'photo-1503676260728-1c00da094a0b',
  'educação': 'photo-1503676260728-1c00da094a0b',
  'sala de aula': 'photo-1580582932707-520aed937b7b',
  'professor': 'photo-1544717305-2782549b5136',
  'professora': 'photo-1544717305-2782549b5136',
  'aluno': 'photo-1427504494785-3a9ca7044f45',
  'criança': 'photo-1503454537195-1dcabb73ffb9',
  'bilíngue': 'photo-1546410531-bb4caa6b424d',
  'financeiro': 'photo-1554224155-6726b3ff858f',
  'inadimplência': 'photo-1554224155-6726b3ff858f',
  'cobrança': 'photo-1554224155-6726b3ff858f',
  'mensalidade': 'photo-1526304640581-d334cdbbf45e',
  'boleto': 'photo-1526304640581-d334cdbbf45e',
  'PIX': 'photo-1556742049-0cfed4f6a45d',
  'LGPD': 'photo-1589829545856-d10d557cf95f',
  'compliance': 'photo-1450101499163-c8848c66ca85',
  'CLT': 'photo-1450101499163-c8848c66ca85',
  'lei': 'photo-1589829545856-d10d557cf95f',
  'contrato': 'photo-1450101499163-c8848c66ca85',
  'jurídico': 'photo-1589829545856-d10d557cf95f',
  'IA': 'photo-1677442135703-1787eea5ce01',
  'inteligência artificial': 'photo-1677442135703-1787eea5ce01',
  'tecnologia': 'photo-1581091226825-a6a2a5aee158',
  'software': 'photo-1517694712202-14dd9538aa97',
  'sistema': 'photo-1517694712202-14dd9538aa97',
  'digital': 'photo-1518770660439-4636190af475',
  'automação': 'photo-1485827404703-89b55fcc595e',
  'dashboard': 'photo-1551288049-bebda4e38f71',
  'dados': 'photo-1551288049-bebda4e38f71',
  'WhatsApp': 'photo-1611162616305-c69b3fa7fbe0',
  'comunicação': 'photo-1577563908411-5077b6dc7624',
  'família': 'photo-1609220136736-443140cffec6',
  'gestão': 'photo-1552664730-d307ca884978',
  'equipe': 'photo-1521737604893-d14cc237f11d',
  'segurança': 'photo-1558002038-1055907df827',
  'biometria': 'photo-1558002038-1055907df827',
  'acesso': 'photo-1558002038-1055907df827',
  'almoxarifado': 'photo-1497366216548-37526070297c',
  'matrícula': 'photo-1556742049-0cfed4f6a45d',
  'CRM': 'photo-1556742049-0cfed4f6a45d',
  'captação': 'photo-1556742049-0cfed4f6a45d',
  'sucesso': 'photo-1533227268428-f9ed0900fb3b',
  'resultado': 'photo-1533227268428-f9ed0900fb3b',
  'inovação': 'photo-1485827404703-89b55fcc595e',
  'investimento': 'photo-1579621970563-ebec7560ff3e',
};

const IMAGE_BANK_KEYS_SORTED = Object.keys(IMAGE_BANK).sort((a, b) => b.length - a.length);

function findBestImage(text, usedPhotos, size = '1080') {
  const lower = (text || '').toLowerCase();
  for (const keyword of IMAGE_BANK_KEYS_SORTED) {
    if (lower.includes(keyword.toLowerCase())) {
      const photoId = IMAGE_BANK[keyword];
      if (!usedPhotos.has(photoId)) {
        usedPhotos.add(photoId);
        return `https://images.unsplash.com/${photoId}?w=${size}&h=${size}&fit=crop`;
      }
    }
  }
  const defaultId = 'photo-1503676260728-1c00da094a0b';
  usedPhotos.add(defaultId);
  return `https://images.unsplash.com/${defaultId}?w=${size}&h=${size}&fit=crop`;
}

// --- HTTP helpers ---
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const req = mod.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function uploadToSupabase(filePath, bucket, objectPath) {
  const fileBuffer = fs.readFileSync(filePath);
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath}`;
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'image/png',
        'Content-Length': fileBuffer.length,
        'x-upsert': 'true',
      },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath}`;
          resolve(publicUrl);
        } else {
          reject(new Error(`Upload failed (${res.statusCode}): ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

// --- Logo helpers ---
function logoHtml(height = 44) {
  if (LOGO_DATA_URI) {
    return `<img src="${LOGO_DATA_URI}" style="height:${height}px;object-fit:contain;" />`;
  }
  return `<span style="font-family:'Playfair Display',serif;font-size:${height * 0.7}px;font-weight:700;color:white;">Lumied</span>`;
}

// --- Slide HTML generators (1080x1080) ---
const SIZE = 1080;

function slideHeroHtml(feature, bgUrl) {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:${SIZE}px;height:${SIZE}px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:url('${bgUrl}') center/cover no-repeat;position:absolute;top:0;left:0;"></div>
  <div style="width:100%;height:100%;position:absolute;top:0;left:0;background:linear-gradient(to bottom,rgba(0,0,0,0.4) 0%,rgba(0,0,0,0.85) 100%);"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px;text-align:center;">
    <div style="margin-bottom:32px;">${logoHtml(48)}</div>
    <div style="font-family:'Playfair Display',serif;font-size:48px;font-weight:700;color:white;line-height:1.3;margin-bottom:24px;">${feature.feature}</div>
    <div style="font-size:24px;color:rgba(255,255,255,0.85);line-height:1.5;max-width:800px;">${feature.headline}</div>
    <div style="position:absolute;bottom:40px;font-size:16px;color:rgba(255,255,255,0.5);">Arrasta pro lado →</div>
  </div>
</body></html>`;
}

function slideBenefitHtml(feature) {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:${SIZE}px;height:${SIZE}px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:#FAFAFA;position:absolute;top:0;left:0;"></div>
  <div style="position:absolute;top:0;left:0;width:8px;height:100%;background:linear-gradient(to bottom,#6C63FF,#3B82F6);"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;padding:80px 80px 80px 100px;">
    <div style="font-size:14px;font-weight:700;color:#6C63FF;letter-spacing:2px;text-transform:uppercase;margin-bottom:24px;">BENEFICIO PRINCIPAL</div>
    <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700;color:#1E293B;line-height:1.4;">${feature.benefit}</div>
  </div>
</body></html>`;
}

function slidePoints1Html(feature) {
  const points = feature.points.slice(0, 3);
  const pointsHtml = points.map(p => `
    <div style="display:flex;align-items:flex-start;gap:20px;margin-bottom:32px;">
      <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6C63FF,#3B82F6);display:flex;align-items:center;justify-content:center;color:white;font-size:20px;font-weight:700;">✓</div>
      <div style="font-size:26px;color:white;line-height:1.4;padding-top:4px;">${p}</div>
    </div>
  `).join('');

  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:${SIZE}px;height:${SIZE}px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:linear-gradient(135deg,#1E293B 0%,#0F172A 100%);position:absolute;top:0;left:0;"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;padding:80px;">
    <div style="font-size:14px;font-weight:700;color:#6C63FF;letter-spacing:2px;margin-bottom:48px;">O QUE VOCE GANHA</div>
    ${pointsHtml}
  </div>
</body></html>`;
}

function slidePoints2Html(feature) {
  const points = feature.points.slice(3);
  const pointsHtml = points.map(p => `
    <div style="display:flex;align-items:flex-start;gap:20px;margin-bottom:32px;">
      <div style="flex-shrink:0;width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6C63FF,#3B82F6);display:flex;align-items:center;justify-content:center;color:white;font-size:20px;font-weight:700;">✓</div>
      <div style="font-size:26px;color:white;line-height:1.4;padding-top:4px;">${p}</div>
    </div>
  `).join('');

  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:${SIZE}px;height:${SIZE}px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:linear-gradient(135deg,#1E293B 0%,#0F172A 100%);position:absolute;top:0;left:0;"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;justify-content:center;padding:80px;">
    <div style="font-size:14px;font-weight:700;color:#6C63FF;letter-spacing:2px;margin-bottom:48px;">E MAIS...</div>
    ${pointsHtml}
  </div>
</body></html>`;
}

function slideStatHtml(feature) {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:${SIZE}px;height:${SIZE}px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:#6C63FF;position:absolute;top:0;left:0;"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;">
    <div style="font-family:'Playfair Display',serif;font-size:120px;font-weight:700;color:white;line-height:1.1;margin-bottom:16px;">${feature.stat}</div>
    <div style="font-size:24px;color:rgba(255,255,255,0.85);line-height:1.5;max-width:700px;">${feature.stat_context}</div>
  </div>
</body></html>`;
}

function slideSocialProofHtml() {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:${SIZE}px;height:${SIZE}px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:linear-gradient(135deg,#0F172A 0%,#1E293B 100%);position:absolute;top:0;left:0;"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px;">
    <div style="font-size:14px;font-weight:700;color:#10B981;letter-spacing:2px;margin-bottom:48px;">PROVA SOCIAL</div>
    <div style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700;color:white;line-height:1.4;margin-bottom:40px;">Usado por escolas bilingues no RS</div>
    <div style="font-size:64px;margin-bottom:16px;">★★★★★</div>
    <div style="font-size:28px;color:white;font-weight:700;margin-bottom:12px;">4.9/5</div>
    <div style="font-size:20px;color:rgba(255,255,255,0.6);margin-bottom:48px;">baseado em avaliacao de gestores</div>
    <div style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:16px;padding:28px 40px;max-width:700px;">
      <div style="font-size:18px;color:rgba(255,255,255,0.8);line-height:1.5;font-style:italic;">"O Lumied transformou nossa gestao. Inadimplencia caiu 40% em 90 dias."</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.5);margin-top:12px;">— Gestao Escolar, Maple Bear Caxias do Sul</div>
    </div>
  </div>
</body></html>`;
}

function slideCtaHtml() {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:${SIZE}px;height:${SIZE}px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:#0F172A;position:absolute;top:0;left:0;"></div>
  <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:400px;height:400px;background:radial-gradient(circle,rgba(108,99,255,0.35) 0%,transparent 70%);border-radius:50%;filter:blur(50px);"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:60px;">
    <div style="margin-bottom:40px;">${logoHtml(56)}</div>
    <div style="font-family:'Playfair Display',serif;font-size:36px;font-weight:700;color:white;line-height:1.3;margin-bottom:20px;">Quer ver como funciona na pratica?</div>
    <div style="font-size:20px;color:#94A3B8;margin-bottom:40px;">Demonstracao gratuita de 30 min. Sem compromisso.</div>
    <div style="display:inline-block;padding:18px 48px;border-radius:12px;background:linear-gradient(135deg,#6C63FF,#3B82F6);color:white;font-size:20px;font-weight:700;margin-bottom:20px;">Agende uma Demo →</div>
    <div style="font-size:16px;color:rgba(255,255,255,0.5);">Link na bio 👆</div>
    <div style="position:absolute;bottom:40px;font-size:14px;color:rgba(255,255,255,0.3);">lumied.com.br</div>
  </div>
</body></html>`;
}

function generateCaption(feature) {
  const pointsText = feature.points.map(p => `✓ ${p}`).join('\n');
  const slugTag = feature.slug.replace(/-/g, '');
  return `${feature.headline}

${feature.benefit}

${pointsText}

${feature.stat} → ${feature.stat_context}

Quer ver como funciona na pratica? Link na bio 👆

#gestaoescolar #escolabilingue #edtech #lumied #tecnologiaeducacional #${slugTag}`;
}

// --- Main ---
async function main() {
  // 1. Read feature-posts.json
  const jsonPath = path.join(__dirname, 'feature-posts.json');
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const posts = data.posts;

  // 2. Find next pending feature
  const feature = posts.find(p => p.status === 'pending');
  if (!feature) {
    console.error('No pending features found in feature-posts.json');
    process.exit(0);
  }

  console.log(`\nFeature: ${feature.feature}`);
  console.log(`Slug: ${feature.slug}`);
  console.log(`Headline: ${feature.headline}`);
  console.log(`Stat: ${feature.stat} ${feature.stat_context}\n`);

  // 3. Generate 7 slides with Puppeteer
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const usedPhotos = new Set();
  const heroBg = findBestImage(feature.photo_keyword || feature.feature, usedPhotos);

  const slides = [
    { name: 'hero', html: slideHeroHtml(feature, heroBg) },
    { name: 'benefit', html: slideBenefitHtml(feature) },
    { name: 'points-1', html: slidePoints1Html(feature) },
    { name: 'points-2', html: slidePoints2Html(feature) },
    { name: 'stat', html: slideStatHtml(feature) },
    { name: 'social-proof', html: slideSocialProofHtml() },
    { name: 'cta', html: slideCtaHtml() },
  ];

  const pngFiles = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const page = await browser.newPage();
    await page.setViewport({ width: SIZE, height: SIZE });
    await page.setContent(slide.html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);

    const outPath = path.join(OUT_DIR, `slide-${i + 1}-${slide.name}.png`);
    await page.screenshot({ path: outPath, type: 'png' });
    await page.close();

    pngFiles.push(outPath);
    console.log(`  Generated: slide-${i + 1}-${slide.name}.png`);
  }

  await browser.close();
  console.log(`\nAll ${pngFiles.length} slides generated in ${OUT_DIR}`);

  const caption = generateCaption(feature);
  console.log(`\nCaption:\n${caption}\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Skipping upload, publish, and JSON update.');
    console.log('Files:', pngFiles.map(f => path.basename(f)).join(', '));
    process.exit(0);
  }

  if (!IG_TOKEN) {
    console.error('Missing INSTAGRAM_ACCESS_TOKEN env var');
    process.exit(1);
  }

  // 4. Upload to Supabase Storage
  console.log('Uploading slides to Supabase Storage...');
  const imageUrls = [];
  for (let i = 0; i < pngFiles.length; i++) {
    const objPath = `features/${feature.slug}/slide-${i + 1}.png`;
    try {
      const url = await uploadToSupabase(pngFiles[i], 'instagram-posts', objPath);
      imageUrls.push(url);
      console.log(`  Uploaded: slide-${i + 1}.png`);
    } catch (err) {
      console.error(`  Upload failed for slide-${i + 1}.png: ${err.message}`);
      if (err.message.includes('not found') || err.message.includes('Bucket')) {
        console.log('  Attempting to create bucket...');
        await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 'instagram-posts', name: 'instagram-posts', public: true }),
        });
        try {
          const url = await uploadToSupabase(pngFiles[i], 'instagram-posts', objPath);
          imageUrls.push(url);
          console.log(`  Uploaded (retry): slide-${i + 1}.png`);
        } catch (err2) {
          console.error(`  Retry failed: ${err2.message}`);
        }
      }
    }
  }

  if (imageUrls.length === 0) {
    console.error('No images uploaded successfully.');
    process.exit(1);
  }

  // 5. Publish as carousel via Meta Graph API
  console.log('\nCreating Instagram containers...');
  const containerIds = [];
  for (const url of imageUrls) {
    const params = new URLSearchParams({
      image_url: url,
      is_carousel_item: 'true',
      access_token: IG_TOKEN,
    });
    const res = await fetch(`${GRAPH_API}/${IG_USER_ID}/media?${params}`, { method: 'POST' });
    if (res.data.error) throw new Error(`IG container error: ${JSON.stringify(res.data.error)}`);
    containerIds.push(res.data.id);
    console.log(`  Container: ${res.data.id}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\nCreating carousel...');
  const carouselParams = new URLSearchParams({
    media_type: 'CAROUSEL',
    caption: caption,
    children: containerIds.join(','),
    access_token: IG_TOKEN,
  });
  const carouselRes = await fetch(`${GRAPH_API}/${IG_USER_ID}/media?${carouselParams}`, { method: 'POST' });
  if (carouselRes.data.error) throw new Error(`IG carousel error: ${JSON.stringify(carouselRes.data.error)}`);
  const carouselId = carouselRes.data.id;
  console.log(`  Carousel ID: ${carouselId}`);

  console.log('Waiting for processing (10s)...');
  await new Promise(r => setTimeout(r, 10000));

  console.log('Publishing...');
  const pubParams = new URLSearchParams({
    creation_id: carouselId,
    access_token: IG_TOKEN,
  });
  const pubRes = await fetch(`${GRAPH_API}/${IG_USER_ID}/media_publish?${pubParams}`, { method: 'POST' });
  if (pubRes.data.error) throw new Error(`IG publish error: ${JSON.stringify(pubRes.data.error)}`);
  const mediaId = pubRes.data.id;
  console.log(`\nPublished! Media ID: ${mediaId}`);

  // 6. Mark as published in feature-posts.json
  feature.status = 'published';
  feature.published_at = new Date().toISOString();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`Updated feature-posts.json: ${feature.slug} → published`);

  // 7. Commit the JSON change
  try {
    execSync(`git add "${jsonPath}"`, { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    execSync(`git commit -m "feat(instagram): publish feature carousel - ${feature.slug}"`, { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    console.log('Committed JSON change.');
  } catch (e) {
    console.warn('Could not commit JSON change (may not be in a git repo):', e.message);
  }

  console.log(`\nhttps://www.instagram.com/lumi.ed/`);
  return mediaId;
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Instagram Stories Publisher for Lumied (@lumi.ed)
 * Usage: node scripts/instagram-stories.js [--dry-run]
 *
 * Generates 5 story images (1080x1920, 9:16 vertical) and publishes them to Instagram.
 * Reads story-bank.json, picks today's batch by dayOfYear % totalBatches.
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

const IG_USER_ID = process.env.INSTAGRAM_USER_ID || '17841436678488566';
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || '';
const SUPABASE_URL = 'https://brgorknbrjlfwvrrlwxj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE';
const GRAPH_API = 'https://graph.facebook.com/v21.0';
const DRY_RUN = process.argv.includes('--dry-run');
const OUT_DIR = process.platform === 'win32' ? path.join(process.env.TEMP || 'C:\\Temp', 'ig-stories') : '/tmp/ig-stories';

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
  'aprendizagem': 'photo-1488190211105-8b0e65b80b4e',
  'pedagogia': 'photo-1509062522246-3755977927d7',
  'financeiro': 'photo-1554224155-6726b3ff858f',
  'inadimplência': 'photo-1554224155-6726b3ff858f',
  'cobrança': 'photo-1554224155-6726b3ff858f',
  'mensalidade': 'photo-1526304640581-d334cdbbf45e',
  'boleto': 'photo-1526304640581-d334cdbbf45e',
  'PIX': 'photo-1556742049-0cfed4f6a45d',
  'DRE': 'photo-1460925895917-afdab827c52f',
  'LGPD': 'photo-1589829545856-d10d557cf95f',
  'compliance': 'photo-1450101499163-c8848c66ca85',
  'CLT': 'photo-1450101499163-c8848c66ca85',
  'lei': 'photo-1589829545856-d10d557cf95f',
  'contrato': 'photo-1450101499163-c8848c66ca85',
  'jurídico': 'photo-1589829545856-d10d557cf95f',
  'certificação': 'photo-1554224155-8d2636023188',
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
};

const IMAGE_BANK_KEYS_SORTED = Object.keys(IMAGE_BANK).sort((a, b) => b.length - a.length);

function findBestImage(text, usedPhotos) {
  const lower = (text || '').toLowerCase();
  for (const keyword of IMAGE_BANK_KEYS_SORTED) {
    if (lower.includes(keyword.toLowerCase())) {
      const photoId = IMAGE_BANK[keyword];
      if (!usedPhotos.has(photoId)) {
        usedPhotos.add(photoId);
        return `https://images.unsplash.com/${photoId}?w=1080&h=1920&fit=crop`;
      }
    }
  }
  // Fallback
  const defaultId = 'photo-1503676260728-1c00da094a0b';
  usedPhotos.add(defaultId);
  return `https://images.unsplash.com/${defaultId}?w=1080&h=1920&fit=crop`;
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

// --- Day of year ---
function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

// --- Story HTML templates ---
function logoHtml(height = 56) {
  if (LOGO_DATA_URI) {
    return `<img src="${LOGO_DATA_URI}" style="height:${height}px;object-fit:contain;" />`;
  }
  return `<span style="font-family:'Playfair Display',serif;font-size:${height * 0.7}px;font-weight:700;color:white;">Lumied</span>`;
}

function pillHtml(label, color) {
  return `<div style="display:inline-block;padding:10px 24px;border-radius:20px;background:${color};color:white;font-family:'Inter',sans-serif;font-size:18px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">${label}</div>`;
}

function storyTipHtml(story, bgUrl) {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:1080px;height:1920px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:url('${bgUrl}') center/cover no-repeat;position:absolute;top:0;left:0;"></div>
  <div style="width:100%;height:100%;position:absolute;top:0;left:0;background:linear-gradient(to bottom,rgba(0,0,0,0.5) 0%,rgba(0,0,0,0.9) 100%);"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;padding:80px 60px;">
    <div style="margin-bottom:24px;">${logoHtml(56)}</div>
    <div style="margin-bottom:60px;">${pillHtml('DICA LUMIED', '#6C63FF')}</div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
      <div style="font-size:80px;margin-bottom:32px;text-shadow:0 0 60px rgba(108,99,255,0.5);">💡</div>
      <div style="font-size:52px;font-weight:700;color:white;line-height:1.3;max-width:880px;margin-bottom:32px;padding:0 40px;">${story.text}</div>
      <div style="font-size:28px;color:rgba(255,255,255,0.7);line-height:1.5;max-width:800px;">${story.subtext || ''}</div>
    </div>
    <div style="text-align:center;padding-bottom:40px;">
      <div style="font-size:28px;color:rgba(255,255,255,0.5);margin-bottom:12px;">↑</div>
      <div style="font-size:18px;color:rgba(255,255,255,0.6);font-weight:600;">lumied.com.br</div>
    </div>
  </div>
</body></html>`;
}

function storyStatHtml(story, bgUrl) {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:1080px;height:1920px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:#6C63FF;position:absolute;top:0;left:0;"></div>
  <div style="width:100%;height:100%;background:url('${bgUrl}') center/cover no-repeat;position:absolute;top:0;left:0;opacity:0.15;"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;padding:80px 60px;">
    <div style="margin-bottom:24px;">${pillHtml('NUMERO DO DIA', '#10B981')}</div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
      <div style="width:60%;height:2px;background:rgba(255,255,255,0.2);margin-bottom:40px;"></div>
      <div style="font-family:'Playfair Display',serif;font-size:180px;font-weight:700;color:white;line-height:1.0;margin-bottom:16px;text-shadow:0 4px 30px rgba(0,0,0,0.3);">${story.number}</div>
      <div style="font-size:36px;font-weight:700;color:white;margin-bottom:24px;">${story.unit || ''}</div>
      <div style="width:60%;height:2px;background:rgba(255,255,255,0.2);margin-bottom:32px;"></div>
      <div style="font-size:26px;color:rgba(255,255,255,0.85);line-height:1.5;max-width:70%;">${story.context || ''}</div>
    </div>
    <div style="padding-bottom:40px;">${logoHtml(56)}</div>
  </div>
</body></html>`;
}

function storyBeforeAfterHtml(story, bgUrl) {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:1080px;height:1920px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <!-- Top half - ANTES -->
  <div style="width:100%;height:50%;position:absolute;top:0;left:0;background:url('${bgUrl}') center top/cover no-repeat;"></div>
  <div style="width:100%;height:50%;position:absolute;top:0;left:0;background:rgba(220,38,38,0.7);"></div>
  <!-- Bottom half - DEPOIS -->
  <div style="width:100%;height:50%;position:absolute;bottom:0;left:0;background:url('${bgUrl}') center bottom/cover no-repeat;"></div>
  <div style="width:100%;height:50%;position:absolute;bottom:0;left:0;background:rgba(16,185,129,0.6);"></div>
  <!-- Zigzag divider -->
  <svg style="position:absolute;top:calc(50% - 20px);left:0;width:100%;height:40px;z-index:3;" viewBox="0 0 1080 40">
    <path d="M0,20 ${Array.from({length:27},(_,i)=>`L${i*40+20},${i%2===0?0:40}`).join(' ')} L1080,20" fill="none" stroke="white" stroke-width="4"/>
  </svg>
  <div style="position:relative;z-index:4;width:100%;height:100%;display:flex;flex-direction:column;">
    <!-- Logo at very top -->
    <div style="text-align:center;padding-top:60px;">${logoHtml(56)}</div>
    <div style="text-align:center;margin-top:16px;">${pillHtml('ANTES vs DEPOIS', '#F59E0B')}</div>
    <!-- ANTES section -->
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 80px;text-align:center;">
      <div style="font-size:24px;font-weight:700;color:rgba(255,255,255,0.9);letter-spacing:4px;margin-bottom:20px;text-transform:uppercase;">&#10060; ANTES</div>
      <div style="font-size:38px;font-weight:700;color:white;line-height:1.3;">${story.before}</div>
    </div>
    <!-- DEPOIS section -->
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 80px;text-align:center;">
      <div style="font-size:24px;font-weight:700;color:rgba(255,255,255,0.9);letter-spacing:4px;margin-bottom:20px;text-transform:uppercase;">&#9989; DEPOIS</div>
      <div style="font-size:38px;font-weight:700;color:white;line-height:1.3;">${story.after}</div>
    </div>
  </div>
</body></html>`;
}

function storyFaqHtml(story, bgUrl) {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:1080px;height:1920px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:url('${bgUrl}') center/cover no-repeat;position:absolute;top:0;left:0;"></div>
  <div style="width:100%;height:100%;position:absolute;top:0;left:0;background:rgba(0,0,0,0.75);"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;padding:80px 60px;">
    <div style="margin-bottom:60px;">${pillHtml('PERGUNTA FREQUENTE', '#0284C7')}</div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;max-width:920px;">
      <div style="font-size:80px;margin-bottom:28px;">&#10067;</div>
      <div style="font-family:'Playfair Display',serif;font-size:56px;font-weight:700;color:white;line-height:1.3;margin-bottom:48px;">${story.question}</div>
      <div style="background:rgba(255,255,255,0.1);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,0.25);border-radius:20px;padding:40px;width:85%;">
        <div style="font-size:30px;color:rgba(255,255,255,0.9);line-height:1.6;">${story.answer}</div>
      </div>
    </div>
    <div style="padding-bottom:40px;">${logoHtml(56)}</div>
  </div>
</body></html>`;
}

function storyCtaHtml(story) {
  return `<!DOCTYPE html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Playfair+Display:wght@700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>
</head><body style="width:1080px;height:1920px;overflow:hidden;position:relative;font-family:'Inter',sans-serif;">
  <div style="width:100%;height:100%;background:#0F172A;position:absolute;top:0;left:0;"></div>
  <!-- Purple glow orb -->
  <div style="position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);width:600px;height:600px;background:radial-gradient(circle,rgba(108,99,255,0.4) 0%,transparent 70%);border-radius:50%;filter:blur(60px);"></div>
  <div style="position:relative;z-index:2;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 60px;text-align:center;">
    <div style="margin-bottom:48px;">${logoHtml(72)}</div>
    <div style="font-family:'Playfair Display',serif;font-size:52px;font-weight:700;color:white;line-height:1.3;max-width:860px;margin-bottom:24px;">${story.text}</div>
    <div style="font-family:'Inter',sans-serif;font-size:30px;font-weight:700;color:#94A3B8;line-height:1.4;max-width:780px;margin-bottom:48px;">${story.subtext || ''}</div>
    <div style="display:inline-block;padding:20px 48px;border-radius:12px;background:linear-gradient(135deg,#6C63FF,#3B82F6);color:white;font-size:24px;font-weight:700;margin-bottom:24px;box-shadow:0 0 40px rgba(108,99,255,0.5);">Agende uma Demo &rarr;</div>
    <div style="font-size:24px;color:rgba(255,255,255,0.7);margin-bottom:auto;font-weight:600;">Link na bio &#128070;</div>
    <div style="font-size:18px;color:rgba(255,255,255,0.4);padding-bottom:40px;">lumied.com.br</div>
  </div>
</body></html>`;
}

function generateStoryHtml(story, bgUrl) {
  switch (story.type) {
    case 'tip': return storyTipHtml(story, bgUrl);
    case 'stat': return storyStatHtml(story, bgUrl);
    case 'before_after': return storyBeforeAfterHtml(story, bgUrl);
    case 'faq': return storyFaqHtml(story, bgUrl);
    case 'cta': return storyCtaHtml(story);
    default: return storyTipHtml(story, bgUrl);
  }
}

// --- Main ---
async function main() {
  // 1. Read story bank
  const bankPath = path.join(__dirname, 'story-bank.json');
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf-8'));
  const batches = bank.batches;
  const totalBatches = batches.length;

  // 2. Pick today's batch
  const batchIndex = dayOfYear() % totalBatches;
  const batch = batches[batchIndex];

  console.log(`\nStory Bank: ${totalBatches} batches, 5 stories each`);
  console.log(`Today: day ${dayOfYear()}, batch index: ${batchIndex}`);
  console.log(`Stories: ${batch.map(s => s.type).join(', ')}\n`);

  // 3. Generate PNGs with Puppeteer
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const usedPhotos = new Set();
  const pngFiles = [];
  const today = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < batch.length; i++) {
    const story = batch[i];
    const bgUrl = findBestImage(story.keyword || story.text || '', usedPhotos);
    const html = generateStoryHtml(story, bgUrl);

    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    // Wait for fonts
    await page.evaluate(() => document.fonts.ready);

    const outPath = path.join(OUT_DIR, `story-${i + 1}-${story.type}.png`);
    await page.screenshot({ path: outPath, type: 'png' });
    await page.close();

    pngFiles.push(outPath);
    console.log(`  Generated: story-${i + 1}-${story.type}.png`);
  }

  await browser.close();
  console.log(`\nAll ${pngFiles.length} stories generated in ${OUT_DIR}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Skipping upload and publish.');
    console.log('Files:', pngFiles.map(f => path.basename(f)).join(', '));
    process.exit(0);
  }

  if (!IG_TOKEN) {
    console.error('\nMissing INSTAGRAM_ACCESS_TOKEN env var');
    process.exit(1);
  }

  // 4. Upload to Supabase Storage
  console.log('\nUploading stories to Supabase Storage...');
  const imageUrls = [];
  for (let i = 0; i < pngFiles.length; i++) {
    const objPath = `stories/${today}/story-${i + 1}.png`;
    try {
      const url = await uploadToSupabase(pngFiles[i], 'instagram-posts', objPath);
      imageUrls.push(url);
      console.log(`  Uploaded: story-${i + 1}.png`);
    } catch (err) {
      console.error(`  Upload failed for story-${i + 1}.png: ${err.message}`);
      // Try creating bucket
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
          console.log(`  Uploaded (retry): story-${i + 1}.png`);
        } catch (err2) {
          console.error(`  Retry failed: ${err2.message}`);
        }
      }
    }
  }

  if (imageUrls.length === 0) {
    console.error('\nNo images uploaded successfully.');
    process.exit(1);
  }

  // 5. Publish each as Instagram Story
  console.log('\nPublishing stories to Instagram...');
  let published = 0;
  let failed = 0;

  for (let i = 0; i < imageUrls.length; i++) {
    try {
      // Create story container
      const createParams = new URLSearchParams({
        image_url: imageUrls[i],
        media_type: 'STORIES',
        access_token: IG_TOKEN,
      });
      const createRes = await fetch(`${GRAPH_API}/${IG_USER_ID}/media?${createParams}`, { method: 'POST' });
      if (createRes.data.error) throw new Error(JSON.stringify(createRes.data.error));
      const containerId = createRes.data.id;
      console.log(`  Container ${i + 1}: ${containerId}`);

      // Wait for processing
      await new Promise(r => setTimeout(r, 3000));

      // Publish
      const pubParams = new URLSearchParams({
        creation_id: containerId,
        access_token: IG_TOKEN,
      });
      const pubRes = await fetch(`${GRAPH_API}/${IG_USER_ID}/media_publish?${pubParams}`, { method: 'POST' });
      if (pubRes.data.error) throw new Error(JSON.stringify(pubRes.data.error));

      console.log(`  Published story ${i + 1}: ${pubRes.data.id}`);
      published++;

      // Rate limiting between stories
      if (i < imageUrls.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error(`  Failed to publish story ${i + 1}: ${err.message}`);
      failed++;
    }
  }

  // 6. Summary
  console.log(`\n--- Summary ---`);
  console.log(`Batch: ${batchIndex} (day ${dayOfYear()})`);
  console.log(`Stories: ${batch.map(s => s.type).join(', ')}`);
  console.log(`Published: ${published}/${imageUrls.length}`);
  if (failed > 0) console.log(`Failed: ${failed}`);
  console.log(`https://www.instagram.com/lumi.ed/`);

  if (published === 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

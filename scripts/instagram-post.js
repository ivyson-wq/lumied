#!/usr/bin/env node
// Instagram Carousel Publisher for Lumied Blog
// Usage: node scripts/instagram-post.js <slug> [--dry-run]
//
// Requires env vars:
//   INSTAGRAM_USER_ID, INSTAGRAM_ACCESS_TOKEN
//   SUPABASE_URL (optional, defaults to Lumied prod)
//   SUPABASE_SERVICE_ROLE_KEY (for storage upload)
//
// Flow: read PNGs → upload to Supabase Storage → create IG carousel → publish

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const IG_USER_ID = process.env.INSTAGRAM_USER_ID || '17841436678488566';
const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://brgorknbrjlfwvrrlwxj.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE';
const GRAPH_API = 'https://graph.facebook.com/v21.0';
const DRY_RUN = process.argv.includes('--dry-run');

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

function fetchMultipart(url, headers, boundary, bodyBuffer) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': bodyBuffer.length },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

async function uploadToSupabase(filePath, bucket, objectPath) {
  const fileBuffer = fs.readFileSync(filePath);
  const boundary = '----FormBoundary' + Date.now();
  const fileName = path.basename(filePath);

  // Use the Supabase Storage REST API
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

async function createIGContainer(imageUrl, caption) {
  const params = new URLSearchParams({
    image_url: imageUrl,
    is_carousel_item: 'true',
    access_token: IG_TOKEN,
  });
  const res = await fetch(`${GRAPH_API}/${IG_USER_ID}/media?${params}`, { method: 'POST' });
  if (res.data.error) throw new Error(`IG container error: ${JSON.stringify(res.data.error)}`);
  return res.data.id;
}

async function createIGCarousel(containerIds, caption) {
  const params = new URLSearchParams({
    media_type: 'CAROUSEL',
    caption: caption,
    children: containerIds.join(','),
    access_token: IG_TOKEN,
  });
  const res = await fetch(`${GRAPH_API}/${IG_USER_ID}/media?${params}`, { method: 'POST' });
  if (res.data.error) throw new Error(`IG carousel error: ${JSON.stringify(res.data.error)}`);
  return res.data.id;
}

async function publishIGCarousel(carouselId) {
  const params = new URLSearchParams({
    creation_id: carouselId,
    access_token: IG_TOKEN,
  });
  const res = await fetch(`${GRAPH_API}/${IG_USER_ID}/media_publish?${params}`, { method: 'POST' });
  if (res.data.error) throw new Error(`IG publish error: ${JSON.stringify(res.data.error)}`);
  return res.data.id;
}

function generateCaption(slug, title, category, lead) {
  const hashtags = {
    'Compliance': '#compliance #gestaoescolar #lgpd #clt #escolabilingue',
    'Pedagogia': '#pedagogia #educacao #bncc #escolabilingue #ensinobilingue',
    'Financeiro': '#financeiro #gestaoescolar #inadimplencia #escola #edtech',
    'Gestão': '#gestao #gestaoescolar #liderancaeducacional #escola #direcaoescolar',
    'Comercial': '#matriculas #crm #captacaoalunos #marketingescolar #escola',
    'EdTech': '#edtech #tecnologiaeducacional #softwareescolar #inovacao #escola',
    'Comunicação': '#comunicacao #whatsapp #escolafamilia #educacao #escola',
    'Segurança': '#segurancaescolar #acessoescolar #biometria #lgpd #escola',
    'Legal': '#direitoeducacional #lgpd #contratoescolar #escola #compliance',
    'Legal e Compliance': '#compliance #lgpd #gestaoescolar #escola #regulamentacao',
    'Operacional': '#operacional #gestaoescolar #manutencao #escola #eficiencia',
    'Marketing': '#marketingescolar #instagram #googleads #captacao #escola',
    'RH': '#rhescolar #professor #recrutamento #educacao #escola',
  };

  const tags = hashtags[category] || '#gestaoescolar #escola #educacao #edtech #lumied';
  const shortLead = lead.length > 200 ? lead.substring(0, 197) + '...' : lead;

  return `${title}\n\n${shortLead}\n\nArrasta pro lado para ver os destaques do artigo →\n\nArtigo completo no link da bio 👆\nlumied.com.br/site/blog/${slug}/\n\n${tags} #lumied`;
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node scripts/instagram-post.js <slug> [--dry-run]');
    process.exit(1);
  }

  // Read article to extract data for caption
  const articlePath = path.join(__dirname, '..', 'site', 'blog', slug, 'index.html');
  if (!fs.existsSync(articlePath)) {
    console.error(`Article not found: ${articlePath}`);
    process.exit(1);
  }
  const html = fs.readFileSync(articlePath, 'utf-8');
  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : slug;
  const catMatch = html.match(/<meta\s+property="article:section"\s+content="([^"]+)"/);
  const category = catMatch ? catMatch[1] : 'Gestão';
  const leadMatch = html.match(/<p class="article-lead">([\s\S]*?)<\/p>/) || html.match(/<div class="article-content">\s*<[^>]+>[\s\S]*?<\/[^>]+>\s*<p>([\s\S]*?)<\/p>/);
  const lead = leadMatch ? (leadMatch[1] || leadMatch[2] || '').replace(/<[^>]+>/g, '').trim() : '';

  const caption = generateCaption(slug, title, category, lead);

  // Find slide PNGs
  const tmpDir = path.join(require('os').tmpdir(), 'ig-slides');
  const slideFiles = [
    'slide-1-hero.png', 'slide-2-stat.png', 'slide-3-quote.png',
    'slide-4-list.png', 'slide-5-cta.png'
  ].map(f => path.join(tmpDir, f)).filter(f => fs.existsSync(f));

  if (slideFiles.length === 0) {
    console.error('No slide PNGs found. Run instagram-render.js first.');
    process.exit(1);
  }

  console.log(`\nSlug: ${slug}`);
  console.log(`Title: ${title}`);
  console.log(`Category: ${category}`);
  console.log(`Slides: ${slideFiles.length}`);
  console.log(`Caption:\n${caption}\n`);

  if (DRY_RUN) {
    console.log('[DRY RUN] Would upload to Supabase and publish to Instagram.');
    console.log('Slides:', slideFiles.map(f => path.basename(f)).join(', '));
    process.exit(0);
  }

  if (!IG_TOKEN) {
    console.error('Missing INSTAGRAM_ACCESS_TOKEN env var');
    process.exit(1);
  }

  // Step 1: Upload to Supabase Storage (if key available) or warn
  let imageUrls = [];
  if (SUPABASE_KEY) {
    console.log('Uploading slides to Supabase Storage...');
    for (const file of slideFiles) {
      const objPath = `instagram-posts/${slug}/${path.basename(file)}`;
      try {
        const url = await uploadToSupabase(file, 'instagram-posts', objPath);
        imageUrls.push(url);
        console.log(`  Uploaded: ${path.basename(file)}`);
      } catch (err) {
        console.error(`  Upload failed for ${path.basename(file)}: ${err.message}`);
        // Try creating the bucket and retrying
        if (err.message.includes('not found') || err.message.includes('Bucket')) {
          console.log('  Attempting to create bucket...');
          await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'instagram-posts', name: 'instagram-posts', public: true }),
          });
          const url = await uploadToSupabase(file, 'instagram-posts', objPath);
          imageUrls.push(url);
          console.log(`  Uploaded (retry): ${path.basename(file)}`);
        }
      }
    }
  } else {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Cannot upload images.');
    console.error('Set the env var and retry.');
    process.exit(1);
  }

  if (imageUrls.length === 0) {
    console.error('No images uploaded successfully.');
    process.exit(1);
  }

  // Step 2: Create individual containers
  console.log('\nCreating Instagram containers...');
  const containerIds = [];
  for (const url of imageUrls) {
    const id = await createIGContainer(url);
    containerIds.push(id);
    console.log(`  Container: ${id}`);
    // Wait a bit between requests (IG rate limiting)
    await new Promise(r => setTimeout(r, 1000));
  }

  // Step 3: Create carousel
  console.log('\nCreating carousel...');
  const carouselId = await createIGCarousel(containerIds, caption);
  console.log(`  Carousel ID: ${carouselId}`);

  // Wait for processing
  console.log('Waiting for processing (10s)...');
  await new Promise(r => setTimeout(r, 10000));

  // Step 4: Publish
  console.log('Publishing...');
  const mediaId = await publishIGCarousel(carouselId);
  console.log(`\n✓ Published! Media ID: ${mediaId}`);
  console.log(`  https://www.instagram.com/lumi.ed/`);

  return mediaId;
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

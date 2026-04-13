#!/usr/bin/env node
/**
 * Instagram Carousel Image Generator for Lumied Blog
 * Usage: node scripts/instagram-render.js <slug>
 * Generates 7 slides (1080x1080) as PNGs in /tmp/ig-slides/
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

// --- Keyword-based Image Bank (~80 keywords mapped to Unsplash photo IDs) ---
const IMAGE_BANK = {
  // Education
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
  'bncc': 'photo-1456513080510-7bf3a84b82f8',
  'currículo': 'photo-1456513080510-7bf3a84b82f8',
  // Finance
  'financeiro': 'photo-1554224155-6726b3ff858f',
  'inadimplência': 'photo-1554224155-6726b3ff858f',
  'cobrança': 'photo-1554224155-6726b3ff858f',
  'mensalidade': 'photo-1526304640581-d334cdbbf45e',
  'boleto': 'photo-1526304640581-d334cdbbf45e',
  'dinheiro': 'photo-1526304640581-d334cdbbf45e',
  'PIX': 'photo-1556742049-0cfed4f6a45d',
  'DRE': 'photo-1460925895917-afdab827c52f',
  'orçamento': 'photo-1460925895917-afdab827c52f',
  'receita': 'photo-1579621970563-ebec7560ff3e',
  'investimento': 'photo-1579621970563-ebec7560ff3e',
  // Legal/Compliance
  'LGPD': 'photo-1589829545856-d10d557cf95f',
  'compliance': 'photo-1450101499163-c8848c66ca85',
  'CLT': 'photo-1450101499163-c8848c66ca85',
  'lei': 'photo-1589829545856-d10d557cf95f',
  'contrato': 'photo-1450101499163-c8848c66ca85',
  'jurídico': 'photo-1589829545856-d10d557cf95f',
  'ANPD': 'photo-1563013544-824ae1b704d3',
  'auditoria': 'photo-1563013544-824ae1b704d3',
  'eSocial': 'photo-1554224155-8d2636023188',
  'AVCB': 'photo-1558618666-fcd25c85f82e',
  'certificação': 'photo-1554224155-8d2636023188',
  // Technology
  'IA': 'photo-1677442135703-1787eea5ce01',
  'inteligência artificial': 'photo-1677442135703-1787eea5ce01',
  'tecnologia': 'photo-1581091226825-a6a2a5aee158',
  'software': 'photo-1517694712202-14dd9538aa97',
  'sistema': 'photo-1517694712202-14dd9538aa97',
  'digital': 'photo-1518770660439-4636190af475',
  'app': 'photo-1512941937669-90a1b58e7e9c',
  'automação': 'photo-1485827404703-89b55fcc595e',
  'dashboard': 'photo-1551288049-bebda4e38f71',
  'dados': 'photo-1551288049-bebda4e38f71',
  // Communication
  'WhatsApp': 'photo-1611605698335-8b1569810432',
  'comunicação': 'photo-1577563908411-5077b6dc7624',
  'família': 'photo-1609220136736-443140cffec6',
  'reunião': 'photo-1552664730-d307ca884978',
  'email': 'photo-1596526131083-e8c633c948d2',
  // Management
  'gestão': 'photo-1552664730-d307ca884978',
  'liderança': 'photo-1519389950473-47ba0277781c',
  'equipe': 'photo-1521737604893-d14cc237f11d',
  'KPI': 'photo-1551288049-bebda4e38f71',
  'meta': 'photo-1454165804606-c3d57bc86b40',
  'planejamento': 'photo-1484480974693-6ca0a78fb36b',
  'estratégia': 'photo-1454165804606-c3d57bc86b40',
  // Security
  'segurança': 'photo-1558002038-1055907df827',
  'biometria': 'photo-1558002038-1055907df827',
  'acesso': 'photo-1558002038-1055907df827',
  'portaria': 'photo-1497366216548-37526070297c',
  // HR
  'recrutamento': 'photo-1521737604893-d14cc237f11d',
  'professor bilíngue': 'photo-1544717305-2782549b5136',
  'entrevista': 'photo-1573497620053-ea5300f94f21',
  'desempenho': 'photo-1552664730-d307ca884978',
  // Operations
  'manutenção': 'photo-1581091226825-a6a2a5aee158',
  'almoxarifado': 'photo-1497366216548-37526070297c',
  'biblioteca': 'photo-1507842217343-583bb7270b66',
  'cantina': 'photo-1567521464027-f127ff144326',
  'transporte': 'photo-1570125909232-eb263c188f7e',
  // Marketing
  'marketing': 'photo-1460925895917-afdab827c52f',
  'Instagram': 'photo-1611162616305-c69b3fa7fbe0',
  'Google': 'photo-1573804633927-bfcbcd909acd',
  'SEO': 'photo-1460925895917-afdab827c52f',
  'captação': 'photo-1556742049-0cfed4f6a45d',
  'matrícula': 'photo-1556742049-0cfed4f6a45d',
  'CRM': 'photo-1556742049-0cfed4f6a45d',
  // General
  'sucesso': 'photo-1533227268428-f9ed0900fb3b',
  'resultado': 'photo-1533227268428-f9ed0900fb3b',
  'crescimento': 'photo-1543286386-713bdd548da4',
  'inovação': 'photo-1485827404703-89b55fcc595e',
  'futuro': 'photo-1485827404703-89b55fcc595e',
};

// Pre-sort keywords by length descending for longest-match-first
const IMAGE_BANK_KEYS_SORTED = Object.keys(IMAGE_BANK).sort((a, b) => b.length - a.length);

/**
 * Find the best matching Unsplash image for a given text.
 * Uses keyword matching (longest match first), deduplicates via usedPhotos set,
 * falls back to category image, then default.
 */
function findBestImage(text, usedPhotos, category) {
  const lower = (text || '').toLowerCase();

  // Scan IMAGE_BANK keys (longest first for specificity)
  for (const keyword of IMAGE_BANK_KEYS_SORTED) {
    if (lower.includes(keyword.toLowerCase())) {
      const photoId = IMAGE_BANK[keyword];
      if (!usedPhotos.has(photoId)) {
        usedPhotos.add(photoId);
        return `https://images.unsplash.com/${photoId}?w=1080&h=1080&fit=crop`;
      }
    }
  }

  // Second pass: allow any keyword match even if we need to find a different one
  // (all best matches were used, try next best)
  for (const keyword of IMAGE_BANK_KEYS_SORTED) {
    if (lower.includes(keyword.toLowerCase())) {
      const photoId = IMAGE_BANK[keyword];
      // Already used but still a match — continue to find another keyword match
      continue;
    }
  }

  // Fallback: category image
  if (category) {
    const catUrl = getCategoryImage(category);
    const catPhotoId = catUrl.match(/unsplash\.com\/(photo-[^?]+)/);
    if (catPhotoId && !usedPhotos.has(catPhotoId[1])) {
      usedPhotos.add(catPhotoId[1]);
      return catUrl;
    }
  }

  // Final fallback: default education photo
  const defaultPhotoId = 'photo-1503676260728-1c00da094a0b';
  if (!usedPhotos.has(defaultPhotoId)) {
    usedPhotos.add(defaultPhotoId);
    return DEFAULT_BG_IMAGE;
  }

  // Absolute last resort: return any unused photo from the bank
  for (const key of IMAGE_BANK_KEYS_SORTED) {
    const photoId = IMAGE_BANK[key];
    if (!usedPhotos.has(photoId)) {
      usedPhotos.add(photoId);
      return `https://images.unsplash.com/${photoId}?w=1080&h=1080&fit=crop`;
    }
  }

  // Truly exhausted — return default (will repeat, but at least we tried)
  return DEFAULT_BG_IMAGE;
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

/**
 * Extract 2-3 impactful short phrases ("insights") from the article HTML.
 * Looks for:
 *  - <strong> inside <p> with stats/numbers/strong claims
 *  - <td> elements with numbers/percentages
 *  - <li> items starting with <strong>
 * Prefers phrases 8-15 words long.
 * Returns array of { text, context } where context = the H2 section it was found in.
 */
function extractInsights(html) {
  const insights = [];
  const candidates = [];

  // Determine H2 sections for context mapping
  const h2Regex = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  const h2Positions = [];
  let h2m;
  while ((h2m = h2Regex.exec(html)) !== null) {
    h2Positions.push({
      index: h2m.index,
      text: h2m[1].replace(/<[^>]+>/g, '').trim(),
    });
  }

  function getContextForIndex(idx) {
    let ctx = '';
    for (const h2 of h2Positions) {
      if (h2.index < idx) ctx = h2.text;
      else break;
    }
    return ctx || 'Destaque';
  }

  function wordCount(str) {
    return str.split(/\s+/).filter(w => w.length > 0).length;
  }

  function hasImpact(str) {
    // Contains a number, percentage, currency, or strong claim word
    return /\d/.test(str) || /R\$/.test(str) || /%/.test(str) ||
           /\b(reduz|aumenta|elimina|garante|economiz|diminui|melhora|transforma|impacta|evita|previne|dobr|tripl|quadruplic)\w*/i.test(str);
  }

  // Strategy 1: <strong> inside <p> tags
  const strongInPRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = strongInPRegex.exec(html)) !== null) {
    const pContent = pm[1];
    const strongRegex = /<strong[^>]*>([\s\S]*?)<\/strong>/gi;
    let sm;
    while ((sm = strongRegex.exec(pContent)) !== null) {
      const text = sm[1].replace(/<[^>]+>/g, '').trim();
      const wc = wordCount(text);
      if (wc >= 4 && wc <= 20 && hasImpact(text)) {
        candidates.push({
          text,
          context: getContextForIndex(pm.index),
          score: (wc >= 8 && wc <= 15 ? 10 : 5) + (hasImpact(text) ? 5 : 0),
        });
      }
    }
  }

  // Strategy 2: <td> elements with numbers/percentages
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tdm;
  while ((tdm = tdRegex.exec(html)) !== null) {
    const text = tdm[1].replace(/<[^>]+>/g, '').trim();
    const wc = wordCount(text);
    if (wc >= 4 && wc <= 20 && hasImpact(text)) {
      candidates.push({
        text,
        context: getContextForIndex(tdm.index),
        score: 7,
      });
    }
  }

  // Strategy 3: <li> items starting with <strong>
  const liStrongRegex = /<li[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong>([\s\S]*?)<\/li>/gi;
  let lsm;
  while ((lsm = liStrongRegex.exec(html)) !== null) {
    const strongText = lsm[1].replace(/<[^>]+>/g, '').trim();
    const restText = lsm[2].replace(/<[^>]+>/g, '').trim();
    // Combine strong + a bit of rest for context
    // Clean trailing colons/punctuation from strong text
    let cleanStrong = strongText.replace(/[:;,.\s]+$/, '').trim();
    let combined = cleanStrong;
    if (restText) {
      const cleanRest = restText.replace(/^[:;,.\s]+/, '').trim();
      const restWords = cleanRest.split(/\s+/).slice(0, 8).join(' ');
      combined = cleanStrong + ': ' + restWords;
    }
    const wc = wordCount(combined);
    if (wc >= 4 && wc <= 20) {
      candidates.push({
        text: combined,
        context: getContextForIndex(lsm.index),
        score: (hasImpact(combined) ? 12 : 6),
      });
    }
  }

  // Strategy 4: Sentences with numbers/stats from <p> tags (broader net)
  const pRegex2 = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm2;
  while ((pm2 = pRegex2.exec(html)) !== null) {
    const plainText = pm2[1].replace(/<[^>]+>/g, '').trim();
    // Split into sentences
    const sentences = plainText.split(/(?<=[.!?])\s+/).filter(s => s.length > 20);
    for (const sentence of sentences) {
      const wc = wordCount(sentence);
      if (wc >= 8 && wc <= 18 && hasImpact(sentence)) {
        candidates.push({
          text: sentence.replace(/[.!?]+$/, ''),
          context: getContextForIndex(pm2.index),
          score: 4,
        });
      }
    }
  }

  // Sort by score descending, deduplicate, take top 3
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set();
  for (const c of candidates) {
    const key = c.text.toLowerCase().substring(0, 40);
    if (!seen.has(key) && insights.length < 3) {
      seen.add(key);
      insights.push({ text: c.text, context: c.context });
    }
  }

  // Fallback if we couldn't find enough
  if (insights.length === 0) {
    insights.push({ text: 'Dados que todo gestor escolar precisa conhecer', context: 'Destaque' });
  }
  if (insights.length === 1) {
    insights.push({ text: 'Tecnologia transforma a gestao educacional', context: 'Destaque' });
  }

  return insights;
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

function slideHero(data, photoUrl) {
  const title = truncateTitle(data.title);
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  font-family: 'Inter', sans-serif;
  color: #fff;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(180deg, rgba(15,23,42,0.6) 0%, rgba(15,23,42,0.9) 100%), url('${photoUrl}');
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

function slideInsightCard1(insight, photoUrl) {
  // Insight Card 1: badge "Voce sabia?" at top, text centered, heavy dark overlay
  const insightText = insight.text.length > 120
    ? insight.text.substring(0, 117).replace(/\s+\S*$/, '') + '...'
    : insight.text;
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  font-family: 'Inter', sans-serif;
  color: #fff;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(180deg, rgba(15,23,42,0.75) 0%, rgba(15,23,42,0.75) 100%), url('${photoUrl}');
  background-size: cover;
  background-position: center;
  z-index: 0;
}
.content {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  justify-content: center; align-items: center;
  height: 100%; padding: 80px 72px;
  text-align: center;
}
.badge {
  display: inline-block;
  background: ${BRAND.primary};
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  padding: 6px 20px;
  border-radius: 100px;
  font-family: 'Inter', sans-serif;
  margin-bottom: 48px;
}
.insight-text {
  font-family: 'Inter', sans-serif;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.4;
  max-width: 850px;
  text-shadow: 0 2px 20px rgba(0,0,0,0.5);
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
  <div class="badge">Voc&ecirc; sabia?</div>
  <div class="insight-text">${insightText}</div>
</div>
<div class="brand-logo">${logoImg(28)}</div>
</body></html>`;
}

function slideInsightCard2(insight, photoUrl) {
  // Insight Card 2: accent bar on left, text left-aligned
  const insightText = insight.text.length > 120
    ? insight.text.substring(0, 117).replace(/\s+\S*$/, '') + '...'
    : insight.text;
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  font-family: 'Inter', sans-serif;
  color: #fff;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(180deg, rgba(15,23,42,0.75) 0%, rgba(15,23,42,0.75) 100%), url('${photoUrl}');
  background-size: cover;
  background-position: center;
  z-index: 0;
}
.content {
  position: relative; z-index: 1;
  display: flex; flex-direction: column;
  justify-content: center;
  height: 100%; padding: 80px 80px 80px 96px;
  position: relative;
}
.accent-bar {
  position: absolute;
  left: 72px; top: 50%; transform: translateY(-50%);
  width: 5px; height: 200px;
  background: ${BRAND.primary};
  border-radius: 3px;
  box-shadow: 0 0 20px rgba(108,99,255,0.4);
}
.context-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 2px;
  color: ${BRAND.primary};
  margin-bottom: 24px;
  font-family: 'Inter', sans-serif;
}
.insight-text {
  font-family: 'Inter', sans-serif;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.4;
  max-width: 850px;
  text-shadow: 0 2px 20px rgba(0,0,0,0.5);
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
  <div class="accent-bar"></div>
  <div class="context-label">Dado importante</div>
  <div class="insight-text">${insightText}</div>
</div>
<div class="brand-logo">${logoImg(28)}</div>
</body></html>`;
}

function slideStat(data, photoUrl) {
  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  font-family: 'Inter', sans-serif;
  color: #fff;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(135deg, rgba(108,99,255,0.88) 0%, rgba(59,130,246,0.88) 100%), url('${photoUrl}');
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

function slideQuote(data, photoUrl) {
  // Truncate quote to ~200 chars for readability
  let quote = data.quote;
  if (quote.length > 220) {
    quote = quote.substring(0, 220).replace(/\s+\S*$/, '') + '...';
  }
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
  background-image: url('${photoUrl}');
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

function slideList(data, photoUrl) {
  const items = data.tocItems.map((item, i) => `
    <div class="item">
      <div class="num">${i + 1}</div>
      <div class="text">${item}</div>
    </div>
    ${i < data.tocItems.length - 1 ? '<div class="separator"></div>' : ''}
  `).join('');

  return `<!DOCTYPE html><html><head><style>
${BASE_STYLE}
body {
  font-family: 'Inter', sans-serif;
  color: #fff;
  position: relative;
}
.bg {
  position: absolute; inset: 0;
  background-image: linear-gradient(180deg, rgba(15,23,42,0.85) 0%, rgba(15,23,42,0.92) 100%), url('${photoUrl}');
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
  const insights = extractInsights(html);

  console.log(`Title: ${data.title}`);
  console.log(`Category: ${data.category}`);
  console.log(`Stat: ${data.stat.number} — ${data.stat.context}`);
  console.log(`TOC items: ${data.tocItems.length}`);
  console.log(`Insights found: ${insights.length}`);
  for (let i = 0; i < insights.length; i++) {
    console.log(`  Insight ${i + 1}: "${insights[i].text}" [${insights[i].context}]`);
  }

  // Track used photos across all slides for visual variety
  const usedPhotos = new Set();

  // Pick photos for each slide
  const heroPhoto = findBestImage(data.title, usedPhotos, data.category);
  const insight1Photo = findBestImage(
    (insights[0] ? insights[0].context + ' ' + insights[0].text : data.category),
    usedPhotos, data.category
  );
  const statPhoto = findBestImage(data.stat.context || data.category, usedPhotos, data.category);
  const insight2Photo = findBestImage(
    (insights[1] ? insights[1].context + ' ' + insights[1].text : data.title),
    usedPhotos, data.category
  );
  const quotePhoto = findBestImage(data.quote, usedPhotos, data.category);
  const listPhoto = findBestImage(data.tocItems.join(' '), usedPhotos, data.category);

  console.log(`\nPhoto assignments:`);
  console.log(`  Hero: ${heroPhoto}`);
  console.log(`  Insight 1: ${insight1Photo}`);
  console.log(`  Stat: ${statPhoto}`);
  console.log(`  Insight 2: ${insight2Photo}`);
  console.log(`  Quote: ${quotePhoto}`);
  console.log(`  List: ${listPhoto}`);

  // Generate slide HTML — 7 slides
  const slides = [
    { name: 'slide-1-hero', html: slideHero(data, heroPhoto) },
    { name: 'slide-2-insight1', html: slideInsightCard1(insights[0] || { text: 'Dados que todo gestor escolar precisa conhecer', context: 'Destaque' }, insight1Photo) },
    { name: 'slide-3-stat', html: slideStat(data, statPhoto) },
    { name: 'slide-4-insight2', html: slideInsightCard2(insights[1] || { text: 'Tecnologia transforma a gestao educacional', context: 'Destaque' }, insight2Photo) },
    { name: 'slide-5-quote', html: slideQuote(data, quotePhoto) },
    { name: 'slide-6-list', html: slideList(data, listPhoto) },
    { name: 'slide-7-cta', html: slideCTA(data) },
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

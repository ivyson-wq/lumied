const https = require('https');

// CORS headers
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function respond(res, status, data) {
  res.writeHead(status, CORS);
  res.end(JSON.stringify(data));
}

function parsePem(raw) {
  if (!raw) return undefined;
  // Se o valor contém \n literal (string), converte para quebra de linha real
  let pem = raw.replace(/\\n/g, '\n');
  // Se ainda não tem quebras de linha entre header e conteúdo, adiciona
  if (!pem.includes('\n')) {
    pem = pem
      .replace(/(-----BEGIN [^-]+-----)/, '$1\n')
      .replace(/(-----END [^-]+-----)/, '\n$1');
  }
  return pem;
}

function interRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const cert = parsePem(process.env.INTER_CERT);
    const key = parsePem(process.env.INTER_KEY);

    const urlObj = new URL(`https://cdpj.partners.bancointer.com.br${path}`);
    const reqOpts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    if (cert && key) {
      reqOpts.cert = cert;
      reqOpts.key = key;
    }

    const req = https.request(reqOpts, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => resolve({ status: resp.statusCode, body: data }));
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (req.method !== 'POST') {
    return respond(res, 405, { error: 'Method not allowed' });
  }

  try {
    // Parse body
    let body = '';
    await new Promise((resolve) => {
      req.on('data', chunk => body += chunk);
      req.on('end', resolve);
    });
    const { cpf: rawCpf } = JSON.parse(body || '{}');
    const cpf = (rawCpf || '').replace(/\D/g, '');

    if (!cpf || cpf.length !== 11) {
      return respond(res, 400, { error: 'CPF inválido.' });
    }

    console.log('Sync boletos para CPF:', cpf);

    const clientId = process.env.INTER_CLIENT_ID;
    const clientSecret = process.env.INTER_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return respond(res, 500, { error: 'Credenciais Inter não configuradas.' });
    }

    // OAuth — tenta múltiplos scopes
    const scopes = [
      'cobranca.boleto.read cobranca.boleto.pdf',
      'boleto-cobranca.read boleto-cobranca.write',
      'cobranca.read',
      'boleto-cobranca.read',
    ];

    let accessToken = '';
    let scopeUsado = '';

    for (const scope of scopes) {
      console.log('Tentando scope:', scope);

      const tokenBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope,
        grant_type: 'client_credentials',
      }).toString();

      const tokenRes = await interRequest('/oauth/v2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenBody,
      });

      if (tokenRes.status === 200) {
        const data = JSON.parse(tokenRes.body);
        accessToken = data.access_token;
        scopeUsado = scope;
        console.log('Scope aceito:', scope);
        break;
      }

      console.log('Scope rejeitado:', scope, tokenRes.status, tokenRes.body);
    }

    if (!accessToken) {
      return respond(res, 502, {
        error: 'Nenhum scope aceito pelo Inter. Verifique certificado e permissões.',
        scopes_tentados: scopes,
      });
    }

    // Buscar boletos (últimos 12 meses)
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setMonth(inicio.getMonth() - 12);
    const dataInicial = inicio.toISOString().split('T')[0];
    const dataFinal = hoje.toISOString().split('T')[0];

    const boletosPath = `/cobranca/v3/cobrancas?cpfCnpj=${cpf}&dataInicial=${dataInicial}&dataFinal=${dataFinal}&itensPorPagina=100`;
    console.log('Buscando boletos...');

    const boletosRes = await interRequest(boletosPath, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (boletosRes.status !== 200) {
      console.error('Consulta falhou:', boletosRes.status, boletosRes.body);
      if (boletosRes.status === 404) {
        return respond(res, 200, { ok: true, sincronizados: 0, total: 0 });
      }
      return respond(res, 502, { error: 'Consulta Inter falhou: ' + boletosRes.status, detail: boletosRes.body });
    }

    const resData = JSON.parse(boletosRes.body);
    const cobrancas = resData.cobrancas || resData.content || resData || [];
    const lista = Array.isArray(cobrancas) ? cobrancas : [];
    console.log('Inter retornou', lista.length, 'boleto(s)');

    // Sincronizar com Supabase
    const { createClient } = require('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const cpfFmt = cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    let sincronizados = 0;

    for (const bol of lista) {
      const nossoNumero = bol.nossoNumero || bol.codigoBarras || '';
      if (!nossoNumero) continue;

      const { data: existe } = await sb.from('boletos').select('id, situacao').eq('nosso_numero', nossoNumero).maybeSingle();
      const situacao = bol.situacao || 'EMITIDO';

      if (existe) {
        if (existe.situacao !== situacao) await sb.from('boletos').update({ situacao }).eq('id', existe.id);
        continue;
      }

      // PDF
      let pdfUrl = null;
      try {
        const pdfRes = await interRequest(`/cobranca/v3/cobrancas/${nossoNumero}/pdf`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (pdfRes.status === 200) {
          const pdfData = JSON.parse(pdfRes.body);
          if (pdfData.pdf) {
            const bytes = Buffer.from(pdfData.pdf, 'base64');
            await sb.storage.createBucket('boletos', { public: true }).catch(() => {});
            const fileName = `${cpf}/${nossoNumero}.pdf`;
            const { error: upErr } = await sb.storage.from('boletos').upload(fileName, bytes, { contentType: 'application/pdf', upsert: true });
            if (!upErr) {
              const { data: urlData } = sb.storage.from('boletos').getPublicUrl(fileName);
              pdfUrl = urlData.publicUrl;
            }
          }
        }
      } catch (e) { console.warn('PDF falhou:', nossoNumero, e.message); }

      const { error: dbErr } = await sb.from('boletos').insert({
        cpf: cpfFmt, nosso_numero: nossoNumero,
        valor: bol.valorNominal || bol.valor || 0,
        vencimento: bol.dataVencimento || null,
        linha_digitavel: bol.linhaDigitavel || '',
        situacao, pdf_url: pdfUrl,
      });
      if (!dbErr) sincronizados++;
      else console.error('Insert falhou:', dbErr.message);
    }

    console.log('Sync OK:', sincronizados, 'novos,', lista.length, 'total');
    return respond(res, 200, { ok: true, sincronizados, total: lista.length });

  } catch (err) {
    console.error('Erro geral:', err);
    return respond(res, 500, { error: String(err) });
  }
};

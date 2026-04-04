// ═══════════════════════════════════════════════════════════════
//  Feature: Document Intake via WhatsApp
//  Staff envia documento → download → classificação IA → confirmação
// ═══════════════════════════════════════════════════════════════
import type { Env } from '../types';
import { enviarTextoLivre, enviarBotoesClassificacao } from '../services/whatsapp';

const GRAPH_URL = 'https://graph.facebook.com/v19.0';

interface StaffInfo {
  id: string;
  escola_id: string;
  nome: string;
  papel: string;
  whatsapp: string;
}

interface MediaInfo {
  id: string;
  mime_type: string;
  sha256?: string;
  file_size?: number;
  filename?: string;
}

// ── Categorias de classificação ──
const CLASSIFICACOES: Record<string, { label: string; destino: string }> = {
  atestado_medico:   { label: 'Atestado Médico',     destino: 'atestados_professoras' },
  certificacao:      { label: 'Certificação/Diploma', destino: 'compliance_certificacoes' },
  politica:          { label: 'Política/Protocolo',   destino: 'compliance_politicas' },
  inspecao:          { label: 'Relatório de Inspeção', destino: 'compliance_inspecoes' },
  documento_aluno:   { label: 'Documento do Aluno',   destino: 'matricula_documentos' },
  ata_aluno:         { label: 'Ata do Aluno',         destino: 'aluno_historico' },
  contrato:          { label: 'Contrato',             destino: 'documentos_escola' },
  nota_fiscal:       { label: 'Nota Fiscal',          destino: 'documentos_escola' },
  comprovante:       { label: 'Comprovante',          destino: 'documentos_escola' },
  comunicado:        { label: 'Comunicado/Circular',  destino: 'documentos_escola' },
  ata_reuniao:       { label: 'Ata de Reunião',       destino: 'documentos_escola' },
  relatorio:         { label: 'Relatório',            destino: 'documentos_escola' },
  outro:             { label: 'Outro',                destino: 'documentos_escola' },
};

/**
 * Download media from Meta API
 */
async function downloadMedia(env: Env, mediaId: string): Promise<{ buffer: ArrayBuffer; mime: string; filename?: string } | null> {
  // Step 1: Get media URL
  const metaRes = await fetch(`${GRAPH_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });
  if (!metaRes.ok) { console.error('[DOC] Failed to get media URL:', await metaRes.text()); return null; }
  const meta = await metaRes.json() as { url: string; mime_type: string; file_size: number; id: string };

  // Step 2: Download binary
  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
  });
  if (!fileRes.ok) { console.error('[DOC] Failed to download media'); return null; }

  return {
    buffer: await fileRes.arrayBuffer(),
    mime: meta.mime_type,
    filename: `wa_${mediaId}.${getExt(meta.mime_type)}`,
  };
}

function getExt(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[mime] || mime.split('/')[1] || 'bin';
}

/**
 * Upload to Supabase Storage via REST API
 */
async function uploadToStorage(env: Env, buffer: ArrayBuffer, filename: string, mime: string): Promise<string | null> {
  const bucket = 'wa-documentos';
  const path = `intake/${Date.now()}_${filename}`;

  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': mime,
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!res.ok) {
    console.error('[DOC] Storage upload failed:', await res.text());
    return null;
  }

  // Get public URL
  return `${env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Classify document using Claude AI
 */
async function classificarDocumento(
  env: Env,
  mime: string,
  filename: string,
  contexto: string,
  bufferBase64: string,
): Promise<{ classificacao: string; confianca: number; motivo: string; contextoExtraido: Record<string, any> }> {
  const isImage = mime.startsWith('image/');

  const systemPrompt = `Você é um assistente de classificação de documentos escolares. Analise o documento e classifique em UMA das categorias:
- atestado_medico: Atestados médicos, laudos, declarações de saúde
- certificacao: Certificados de cursos, diplomas, habilitações profissionais
- politica: Políticas internas, protocolos, regulamentos, procedimentos
- inspecao: Relatórios de inspeção, checklists de conformidade, vistorias
- documento_aluno: RG, CPF, certidão nascimento, comprovante, histórico escolar
- ata_aluno: Atas de ocorrência do aluno, registros de comportamento, acompanhamento pedagógico individual, reunião com responsáveis sobre o aluno
- contrato: Contratos de matrícula, prestação de serviços, trabalhistas
- nota_fiscal: Notas fiscais, recibos, cupons fiscais
- comprovante: Comprovantes de pagamento, depósito, transferência
- comunicado: Circulares, comunicados oficiais, avisos
- ata_reuniao: Atas de reunião, assembleias, conselhos
- relatorio: Relatórios pedagógicos, financeiros, administrativos
- outro: Documentos que não se encaixam nas categorias acima

Responda APENAS em JSON válido:
{"classificacao":"<categoria>","confianca":<0.0-1.0>,"motivo":"<explicação curta>","contexto":{"pessoa":"<nome se visível>","tipo_especifico":"<detalhe>","data":"<data se visível>","validade":"<validade se aplicável>"}}`;

  const userContent: any[] = [];

  if (isImage) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: mime, data: bufferBase64 },
    });
  }

  userContent.push({
    type: 'text',
    text: `Arquivo: ${filename} (${mime})${contexto ? `\nMensagem do remetente: "${contexto}"` : ''}\n\nClassifique este documento.`,
  });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!res.ok) {
      console.error('[DOC] Claude API error:', await res.text());
      return { classificacao: 'outro', confianca: 0, motivo: 'Erro na classificação automática', contextoExtraido: {} };
    }

    const data = await res.json() as any;
    const rawText = data.content?.[0]?.text || '{}';
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : '{}');

    return {
      classificacao: parsed.classificacao || 'outro',
      confianca: parsed.confianca || 0.5,
      motivo: parsed.motivo || 'Classificado automaticamente',
      contextoExtraido: parsed.contexto || {},
    };
  } catch (e) {
    console.error('[DOC] Classification error:', e);
    return { classificacao: 'outro', confianca: 0, motivo: 'Erro no processamento', contextoExtraido: {} };
  }
}

/**
 * Main handler: process incoming document from staff
 */
export async function processarDocumento(
  db: any,
  env: Env,
  phoneId: string,
  staff: StaffInfo,
  media: MediaInfo,
  mensagemContexto?: string,
): Promise<void> {
  const waId = staff.whatsapp;

  // 1. Acknowledge receipt
  await enviarTextoLivre(env, phoneId, waId,
    `📄 Documento recebido! Estou analisando para classificar automaticamente...\n\n_Aguarde alguns segundos._`);

  // 2. Download media from Meta
  const downloaded = await downloadMedia(env, media.id);
  if (!downloaded) {
    await enviarTextoLivre(env, phoneId, waId, '❌ Não consegui baixar o arquivo. Tente enviar novamente.');
    return;
  }

  // 3. Upload to Supabase Storage
  const arquivoUrl = await uploadToStorage(env, downloaded.buffer, downloaded.filename || 'doc', downloaded.mime);
  if (!arquivoUrl) {
    await enviarTextoLivre(env, phoneId, waId, '❌ Erro ao salvar o arquivo. Tente novamente em instantes.');
    return;
  }

  // 4. Classify with AI (only for images; PDFs get text-only classification)
  const isImage = downloaded.mime.startsWith('image/');
  const bufferBase64 = isImage
    ? btoa(String.fromCharCode(...new Uint8Array(downloaded.buffer)))
    : '';

  const result = await classificarDocumento(
    env,
    downloaded.mime,
    downloaded.filename || 'documento',
    mensagemContexto || '',
    bufferBase64,
  );

  const info = CLASSIFICACOES[result.classificacao] || CLASSIFICACOES.outro;

  // 5. Save to wa_documentos
  const docRecord = {
    escola_id: staff.escola_id,
    remetente_whatsapp: waId,
    remetente_nome: staff.nome,
    remetente_papel: staff.papel,
    media_id: media.id,
    media_type: downloaded.mime,
    arquivo_url: arquivoUrl,
    arquivo_nome: downloaded.filename,
    arquivo_tamanho_kb: Math.round(downloaded.buffer.byteLength / 1024),
    classificacao: result.classificacao,
    classificacao_confianca: result.confianca,
    classificacao_motivo: result.motivo,
    destino_sugerido: info.destino,
    contexto: result.contextoExtraido,
    mensagem_contexto: mensagemContexto,
    status: 'aguardando_confirmacao',
  };

  const { data: inserted } = await db.from('wa_documentos').insert(docRecord).select();
  const docId = inserted?.[0]?.id;

  // 6. Send classification result + confirmation buttons
  const confiancaPct = Math.round(result.confianca * 100);
  const contextoStr = result.contextoExtraido.pessoa
    ? `\n👤 *Pessoa:* ${result.contextoExtraido.pessoa}`
    : '';
  const validadeStr = result.contextoExtraido.validade
    ? `\n📅 *Validade:* ${result.contextoExtraido.validade}`
    : '';

  const msg = `✅ *Documento analisado!*\n\n` +
    `📂 *Classificação:* ${info.label}\n` +
    `🎯 *Confiança:* ${confiancaPct}%\n` +
    `💬 *Motivo:* ${result.motivo}` +
    contextoStr + validadeStr +
    `\n\n📁 *Destino sugerido:* ${info.destino}\n\n` +
    `Está correto? Confirme para arquivar ou rejeite para reclassificar.`;

  await enviarBotoesClassificacao(env, phoneId, waId, msg, docId || 'unknown');
}

/**
 * Handle confirmation/rejection button response
 */
export async function processarConfirmacaoDocumento(
  db: any,
  env: Env,
  phoneId: string,
  waId: string,
  buttonId: string,
): Promise<void> {
  // buttonId format: "doc_<id>_confirmar" or "doc_<id>_rejeitar"
  const parts = buttonId.split('_');
  const docId = parts[1];
  const acao = parts[2]; // confirmar | rejeitar

  if (acao === 'confirmar') {
    await db.from('wa_documentos').update({
      status: 'confirmado',
      atualizado_em: new Date().toISOString(),
    }).eq('id', docId).execute();

    await enviarTextoLivre(env, phoneId, waId,
      `✅ *Documento arquivado com sucesso!*\n\nVocê pode visualizá-lo no painel do gerente, na seção correspondente.\n\n_Envie outro documento quando quiser._`);
  } else {
    await db.from('wa_documentos').update({
      status: 'rejeitado',
      atualizado_em: new Date().toISOString(),
    }).eq('id', docId).execute();

    await enviarTextoLivre(env, phoneId, waId,
      `🔄 *Classificação rejeitada.*\n\nPor favor, reenvie o documento com uma descrição mais detalhada do que é, ex:\n\n_"Atestado médico da professora Maria"_\n_"Certificado de primeiros socorros do João"_\n_"Política de uso de celular"_`);
  }
}

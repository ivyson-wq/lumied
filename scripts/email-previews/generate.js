const fs = require('fs');
const path = require('path');

const LOGO = 'https://lumied.com.br/lumied-logo.png';
const GRAD = 'linear-gradient(135deg,#6C63FF,#3B82F6)';
const CLR = '#6C63FF';

function layout(body, pre) {
  const ph = pre ? `<div style="display:none;max-height:0;overflow:hidden;">${pre}</div>` : '';
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Email Preview</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
${ph}
<table role="presentation" width="100%" style="background:#F3F4F6;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" style="max-width:600px;width:100%;">
  <tr><td style="background:${GRAD};padding:24px 32px;border-radius:16px 16px 0 0;text-align:center;">
    <img src="${LOGO}" alt="Lumied" width="120" style="display:inline-block;height:auto;max-width:120px;" />
  </td></tr>
  <tr><td style="background:#FFFFFF;padding:32px;border-left:1px solid #E5E7EB;border-right:1px solid #E5E7EB;">
    ${body}
  </td></tr>
  <tr><td style="background:#0F172A;padding:24px 32px;border-radius:0 0 16px 16px;text-align:center;">
    <img src="${LOGO}" alt="Lumied" width="80" style="display:inline-block;height:auto;max-width:80px;margin-bottom:12px;opacity:.8;" /><br>
    <p style="font-size:13px;color:#94A3B8;margin:0 0 8px;line-height:1.6;">
      <a href="https://lumied.com.br" style="color:#38BDF8;text-decoration:none;">lumied.com.br</a> &middot;
      <a href="https://lumied.com.br/blog/" style="color:#38BDF8;text-decoration:none;">Blog</a> &middot;
      <a href="https://www.instagram.com/lumi.ed/" style="color:#38BDF8;text-decoration:none;">Instagram</a> &middot;
      <a href="https://www.linkedin.com/company/lumied/" style="color:#38BDF8;text-decoration:none;">LinkedIn</a>
    </p>
    <p style="font-size:11px;color:#64748B;margin:0;line-height:1.5;">
      contato@lumied.com.br<br>
      Lumied Tecnologia &middot; Caxias do Sul, RS &middot; Brasil<br>
      <a href="https://lumied.com.br/privacidade/" style="color:#64748B;text-decoration:underline;">Pol&iacute;tica de Privacidade</a>
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

const dir = __dirname;

const emails = [
  {
    file: '01-welcome-newsletter.html',
    label: 'EMAIL 1/7 &mdash; Boas-vindas Newsletter',
    body: `
      <h2 style="font-size:22px;color:#1E1B4B;margin:0 0 16px;text-align:center;">Bem-vindo ao Blog Lumied!</h2>
      <p style="font-size:15px;line-height:1.7;color:#475569;">Obrigado por se inscrever! A partir de agora voc&ecirc; receber&aacute; conte&uacute;dos pr&aacute;ticos sobre gest&atilde;o escolar, compliance e EdTech.</p>
      <div style="background:#F0EDFF;border:1px solid #D4CAFE;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="font-size:18px;margin:0 0 12px;color:#1E1B4B;">&#x1F4CB; Checklist Compliance Escolar 2026</h3>
        <p style="font-size:14px;color:#475569;margin:0 0 16px;">Os 6 itens obrigat&oacute;rios que toda escola precisa cumprir:</p>
        <ol style="font-size:14px;color:#1E1B4B;line-height:2.2;padding-left:20px;margin:0;">
          <li><strong>Ponto CLT</strong> &mdash; Registro eletr&ocirc;nico, hora extra 50%/100%</li>
          <li><strong>LGPD</strong> &mdash; Consentimento, dados de menores, DPO</li>
          <li><strong>eSocial</strong> &mdash; Folha eletr&ocirc;nica em tempo real</li>
          <li><strong>AVCB</strong> &mdash; Bombeiros, Vigil&acirc;ncia Sanit&aacute;ria</li>
          <li><strong>MEC</strong> &mdash; Censo Escolar, autoriza&ccedil;&atilde;o, PPP</li>
          <li><strong>Contratos</strong> &mdash; Assinatura eletr&ocirc;nica (Lei 14.063)</li>
        </ol>
      </div>
      <h3 style="font-size:16px;color:#1E1B4B;margin:24px 0 12px;">Artigos mais lidos:</h3>
      <ul style="list-style:none;padding:0;margin:0;">
        <li style="margin-bottom:12px;"><a href="#" style="color:${CLR};font-weight:600;text-decoration:none;">Compliance Escolar 2026: Guia Completo &rarr;</a></li>
        <li style="margin-bottom:12px;"><a href="#" style="color:${CLR};font-weight:600;text-decoration:none;">Inadimpl&ecirc;ncia Escolar: Como Reduzir 40% &rarr;</a></li>
        <li style="margin-bottom:12px;"><a href="#" style="color:${CLR};font-weight:600;text-decoration:none;">LGPD na Escola: Guia Definitivo &rarr;</a></li>
      </ul>
      <div style="text-align:center;margin-top:28px;">
        <a href="#" style="display:inline-block;padding:12px 28px;background:${GRAD};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">Ver todos os artigos &rarr;</a>
      </div>`
  },
  {
    file: '02-novo-artigo.html',
    label: 'EMAIL 2/7 &mdash; Novo Artigo Publicado',
    body: `
      <p style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:${CLR};font-weight:700;margin:0 0 8px;">Novo no blog &middot; Compliance</p>
      <h1 style="font-size:22px;line-height:1.3;margin:0 0 12px;color:#1E1B4B;">Folha de Pagamento Escolar: Guia CLT para Professores 2026</h1>
      <p style="font-size:14px;color:#475569;line-height:1.7;margin:0 0 24px;">Tudo que sua escola precisa saber sobre folha de pagamento de professores CLT em 2026: hora-aula, d&eacute;cimo terceiro, f&eacute;rias e eSocial.</p>
      <div style="text-align:center;">
        <a href="#" style="display:inline-block;padding:12px 28px;background:${GRAD};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:14px;">Ler artigo completo &rarr;</a>
      </div>`
  },
  {
    file: '03-reativacao-lead-frio.html',
    label: 'EMAIL 3/7 &mdash; Reativa&ccedil;&atilde;o Lead Frio',
    body: `
      <h2 style="font-size:22px;color:#1E1B4B;margin:0 0 8px;text-align:center;">Ainda pensando?</h2>
      <p style="font-size:14px;color:#475569;text-align:center;margin:0 0 24px;">Veja o que aconteceu com uma escola que deu o passo.</p>
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:20px;margin-bottom:24px;">
        <h3 style="font-size:16px;color:#166534;margin:0 0 12px;">Maple Bear Caxias do Sul &mdash; 90 dias com Lumied</h3>
        <ul style="list-style:none;padding:0;margin:0;font-size:14px;color:#1E1B4B;line-height:2;">
          <li>&#x2705; Inadimpl&ecirc;ncia: <strong>14% &rarr; 8,3%</strong> (-40%)</li>
          <li>&#x2705; Tempo economizado: <strong>12h/semana</strong></li>
          <li>&#x2705; Receita recuperada: <strong>R$ 31k/m&ecirc;s</strong></li>
          <li>&#x2705; Tempo de resposta: <strong>4h &rarr; 8min</strong></li>
        </ul>
      </div>
      <p style="font-size:14px;color:#475569;line-height:1.7;">Se Escola Exemplo est&aacute; enfrentando desafios semelhantes, podemos mostrar como o Lumied resolve &mdash; em 20 minutos, sem compromisso.</p>
      <div style="text-align:center;margin-top:24px;">
        <a href="#" style="display:inline-block;padding:14px 32px;background:${GRAD};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Agendar Demo Gratuita &rarr;</a>
      </div>`
  },
  {
    file: '04-followup-day1.html',
    label: 'EMAIL 4/7 &mdash; Follow-up Day+1',
    body: `
      <h2 style="font-size:20px;color:#1E1B4B;margin:0 0 16px;">Obrigado por assistir a demo!</h2>
      <p style="font-size:14px;color:#475569;line-height:1.7;">Foi &oacute;timo conversar sobre as necessidades de Escola Exemplo. Aqui est&aacute; um resumo:</p>
      <ul style="font-size:14px;color:#1E1B4B;line-height:2;padding-left:20px;">
        <li>23 m&oacute;dulos integrados em uma plataforma</li>
        <li>IA que analisa dados e sugere a&ccedil;&otilde;es</li>
        <li>WhatsApp oficial integrado</li>
        <li>Compliance CLT e LGPD automatizado</li>
      </ul>
      <p style="font-size:14px;color:#475569;">Alguma d&uacute;vida? Responda este email ou fale conosco no WhatsApp.</p>
      <div style="text-align:center;margin-top:24px;">
        <a href="#" style="display:inline-block;padding:12px 28px;background:${GRAD};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;">Ver planos e pre&ccedil;os &rarr;</a>
      </div>`
  },
  {
    file: '05-followup-day3.html',
    label: 'EMAIL 5/7 &mdash; Follow-up Day+3 (Proposta)',
    body: `
      <h2 style="font-size:20px;color:#1E1B4B;margin:0 0 16px;">Pronto para dar o pr&oacute;ximo passo?</h2>
      <p style="font-size:14px;color:#475569;line-height:1.7;">Com base na nossa conversa, o <strong>plano Evolu&ccedil;&atilde;o</strong> parece ideal para Escola Exemplo:</p>
      <div style="background:#F0EDFF;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
        <p style="font-size:28px;font-weight:800;color:${CLR};margin:0;">R$ 997<span style="font-size:14px;font-weight:400;color:#475569;">/m&ecirc;s (anual)</span></p>
        <p style="font-size:13px;color:#475569;margin:8px 0 0;">23 m&oacute;dulos &middot; at&eacute; 800 alunos &middot; WhatsApp 500 msgs/m&ecirc;s &middot; IA inclusa</p>
      </div>
      <p style="font-size:14px;color:#475569;">Implanta&ccedil;&atilde;o em 7-15 dias &uacute;teis, com migra&ccedil;&atilde;o e treinamento inclu&iacute;dos.</p>
      <div style="text-align:center;margin-top:24px;">
        <a href="#" style="display:inline-block;padding:12px 28px;background:${GRAD};color:#fff;border-radius:8px;font-weight:700;text-decoration:none;">Come&ccedil;ar agora &rarr;</a>
      </div>`
  },
  {
    file: '06-followup-day7.html',
    label: 'EMAIL 6/7 &mdash; Follow-up Day+7 (Oferta)',
    body: `
      <h2 style="font-size:20px;color:#1E1B4B;margin:0 0 16px;">Condi&ccedil;&atilde;o especial expira em breve</h2>
      <p style="font-size:14px;color:#475569;line-height:1.7;">Para escolas que agendam a implanta&ccedil;&atilde;o esta semana:</p>
      <div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:12px;padding:20px;margin:20px 0;">
        <ul style="list-style:none;padding:0;margin:0;font-size:14px;color:#92400E;line-height:2;">
          <li>&#x2B50; <strong>1 m&ecirc;s gr&aacute;tis</strong> no plano escolhido</li>
          <li>&#x2B50; <strong>Migra&ccedil;&atilde;o express</strong> (7 dias &uacute;teis)</li>
          <li>&#x2B50; <strong>Treinamento extra</strong> (+1 sess&atilde;o individual)</li>
        </ul>
      </div>
      <div style="text-align:center;margin-top:24px;">
        <a href="#" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#F59E0B,#F97316);color:#fff;border-radius:8px;font-weight:700;text-decoration:none;font-size:15px;">Garantir condi&ccedil;&atilde;o especial &rarr;</a>
      </div>`
  },
  {
    file: '07-notificacao-lead.html',
    label: 'EMAIL 7/7 &mdash; Notifica&ccedil;&atilde;o Interna',
    body: `
      <h2 style="font-size:20px;color:#1E1B4B;margin:0 0 20px;">Novo Lead Comercial</h2>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;width:140px;">Escola:</td><td style="padding:12px 16px;">Maple Bear Bento Gon&ccedil;alves</td></tr>
        <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;">Email:</td><td style="padding:12px 16px;">diretora@maplebear-bg.com.br</td></tr>
        <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;">WhatsApp:</td><td style="padding:12px 16px;">(54) 99123-4567</td></tr>
        <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;">Mensagem:</td><td style="padding:12px 16px;">Gostaria de saber mais sobre o plano Evolu&ccedil;&atilde;o para 250 alunos.</td></tr>
        <tr><td style="padding:12px 16px;font-weight:bold;background:#F9FAFB;">Origem:</td><td style="padding:12px 16px;">vs_escolaweb</td></tr>
      </table>
      <div style="text-align:center;margin-top:24px;">
        <a href="#" style="display:inline-block;background:${GRAD};color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Abrir Painel Central &rarr;</a>
      </div>`
  },
];

for (const e of emails) {
  const html = `<p style="text-align:center;color:#999;font-size:12px;margin:8px 0;">${e.label}</p>\n` + layout(e.body, '');
  fs.writeFileSync(path.join(dir, e.file), html, 'utf8');
}
console.log('7 previews regenerados com identidade visual Lumied');

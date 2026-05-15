// ═══════════════════════════════════════════════════════════════
//  LAP — Welcome Kit (Sprint 11)
//
//  E-mail + payload WhatsApp pra primeira conversa com o cliente
//  recém-onboardado. Disparado a partir do staff_criar_escola.
// ═══════════════════════════════════════════════════════════════

export type WelcomeKitInput = {
  escola_nome: string;
  escola_slug: string;
  gerente_nome: string;
  gerente_email: string;
  plano: string;
  url_admin: string;
  url_gerente: string;
};

const BRAND_PURPLE = "#2D1B4E";
const BRAND_LIGHT = "#6C63FF";

export function welcomeKitEmailHtml(input: WelcomeKitInput): string {
  const welcomeUrl = `https://${input.escola_slug}.lumied.com.br/welcome.html`;
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:'Inter',-apple-system,Roboto,sans-serif;">
<table role="presentation" width="100%" style="background:#F3F4F6"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="600" style="max-width:600px;width:100%;">
  <tr><td style="background:${BRAND_PURPLE};padding:36px 28px;border-radius:16px 16px 0 0;text-align:center;">
    <img src="https://lumied.com.br/lumied-logo-branco.png" alt="Lumied" width="180" style="display:inline-block;max-width:180px;">
    <p style="color:rgba(255,255,255,.7);font-size:13px;margin:14px 0 0;letter-spacing:0.4px">Gestão escolar inteligente</p>
  </td></tr>
  <tr><td style="background:#fff;padding:36px 32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb">
    <h1 style="font-size:24px;font-weight:800;color:#1a1a1a;margin:0 0 14px;line-height:1.25">
      Bem-vindo(a), ${escapeHtml(input.gerente_nome)} 🎉
    </h1>
    <p style="font-size:15px;line-height:1.55;color:#475569;margin:0 0 14px">
      A escola <b>${escapeHtml(input.escola_nome)}</b> está oficialmente no Lumied.
      Em até 1 minuto você já está vendo seu painel rodando.
    </p>
    <div style="background:#f3f0ff;border-left:4px solid ${BRAND_LIGHT};padding:14px 18px;border-radius:6px;margin:18px 0">
      <p style="font-size:13.5px;color:#1a1a1a;margin:0 0 6px"><b>Plano contratado:</b> ${escapeHtml(input.plano)}</p>
      <p style="font-size:13.5px;color:#1a1a1a;margin:0"><b>Seu acesso:</b> ${escapeHtml(input.gerente_email)} (define sua senha no primeiro login)</p>
    </div>
    <p style="font-size:14.5px;line-height:1.55;color:#1a1a1a;margin:18px 0 10px;font-weight:700">Próximos 3 passos:</p>
    <ol style="font-size:13.5px;line-height:1.7;color:#475569;padding-left:22px;margin:0 0 22px">
      <li><b>Setup Wizard:</b> 2 minutos pra personalizar seu painel pelo papel, qtd de alunos e mês do ano letivo.</li>
      <li><b>Checklist 🚀:</b> 12 itens guiando até a ativação completa. Cada ✓ tira um motivo de churn.</li>
      <li><b>Convide colegas:</b> botão "Convidar" envia link mágico — entram sem senha, papel já configurado.</li>
    </ol>
    <div style="text-align:center;margin:26px 0 18px">
      <a href="${welcomeUrl}" style="display:inline-block;background:linear-gradient(135deg,${BRAND_LIGHT},#3B82F6);color:#fff;padding:13px 28px;border-radius:9px;font-weight:700;font-size:14px;text-decoration:none">
        Começar agora →
      </a>
    </div>
    <p style="font-size:12.5px;line-height:1.5;color:#94a3b8;margin:20px 0 0;text-align:center">
      Dúvidas? Responda este e-mail ou fale com a gente no WhatsApp:
      <a href="https://wa.me/5554997021634" style="color:${BRAND_LIGHT};text-decoration:none;font-weight:600">+55 54 9 9702-1634</a>
    </p>
  </td></tr>
  <tr><td style="background:${BRAND_PURPLE};padding:24px 32px;border-radius:0 0 16px 16px;text-align:center">
    <p style="color:rgba(255,255,255,.5);font-size:11.5px;margin:0">© ${new Date().getFullYear()} Lumied · lumied.com.br</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function welcomeKitWhatsappText(input: WelcomeKitInput): string {
  return `Oi ${input.gerente_nome}! 👋

A ${input.escola_nome} já tá ativa no Lumied 🎉

📱 Próximos 3 passos:
1. Entra em ${input.url_gerente} (defina sua senha no 1º login)
2. Faça o Setup Wizard de 2 min — personaliza seu painel
3. Convide seus colegas pelo botão "👥 Convidar" (eles entram sem senha)

Estou aqui no WhatsApp se precisar de qualquer coisa.
Bem-vindo(a) à Lumied! 🚀`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

// Auto-extraído do gerente.html (Onda 4 — batch final).
// Biblioteca — acervo + empréstimos
  // ── BIBLIOTECA ─────────────────────────────────────────
  var bibAcervo = [];
  var OP_URL = SUPABASE_URL + '/functions/v1/operacional';
  async function opApi(body) {
    const r = await fetch(OP_URL, { method:'POST', headers:{'Content-Type':'application/json','apikey':ANON,'Authorization':'Bearer '+ANON}, body:JSON.stringify({...body,_token:getToken()}) });
    return r.json();
  }

  async function loadBibAcervo() {
    const d = await opApi({ action:'acervo_list' });
    bibAcervo = Array.isArray(d) ? d : (d.data || []);
    renderBibAcervo(bibAcervo);
  }
  function filtrarBiblioteca() {
    const q = (document.getElementById('bibBusca')?.value || '').toLowerCase();
    renderBibAcervo(q ? bibAcervo.filter(b => (b.titulo||'').toLowerCase().includes(q) || (b.autor||'').toLowerCase().includes(q) || (b.isbn||'').includes(q)) : bibAcervo);
  }
  function renderBibAcervo(lista) {
    const body = document.getElementById('bibAcervoBody');
    if (!lista.length) { body.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted);">Nenhum livro no acervo. Adicione o primeiro!</td></tr>'; return; }
    body.innerHTML = lista.map(b => `<tr style="border-bottom:1px solid #f0ece6;">
      <td style="padding:10px;"><strong>${esc(b.titulo)}</strong></td>
      <td style="padding:10px;font-size:12px;">${esc(b.autor||'—')}</td>
      <td style="padding:10px;font-size:12px;">${esc(b.categoria||'—')}</td>
      <td style="padding:10px;text-align:center;">${b.quantidade||0}</td>
      <td style="padding:10px;text-align:center;font-weight:600;color:${(b.disponivel||0)>0?'var(--green)':'var(--red)'};">${b.disponivel||0}</td>
      <td style="padding:10px;"><button class="action-btn" onclick="deletarLivro('${b.id}')" title="Remover">🗑️</button></td>
    </tr>`).join('');
  }
  async function abrirNovoBib() {
    const titulo = prompt('Título do livro:'); if (!titulo) return;
    const autor = prompt('Autor:') || '';
    const categoria = prompt('Categoria (ficção, didático, infantil, referência):') || 'didático';
    const qtd = parseInt(prompt('Quantidade:') || '1') || 1;
    const d = await opApi({ action:'acervo_create', titulo, autor, categoria, quantidade:qtd });
    if (d.error) return showToast(d.error,'error');
    showToast('Livro adicionado!','success');
    loadBibAcervo();
  }
  async function deletarLivro(id) {
    if (!await _lumiedConfirm('Remover este livro do acervo?')) return;
    await opApi({ action:'acervo_update', id, ativo:false });
    loadBibAcervo();
  }

  async function loadBibEmprestimos() {
    const d = await opApi({ action:'biblioteca_emprestimos' });
    const lista = Array.isArray(d) ? d : (d.data || []);
    const body = document.getElementById('bibEmprestimosBody');
    if (!lista.length) { body.innerHTML = '<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--muted);">Nenhum empréstimo registrado.</td></tr>'; return; }
    body.innerHTML = lista.map(e => {
      const livro = e.biblioteca_acervo?.titulo || '—';
      const status = e.status === 'devolvido' ? '<span style="color:var(--green);">Devolvido</span>' : e.data_devolucao_prevista && new Date(e.data_devolucao_prevista) < new Date() ? '<span style="color:var(--red);">Atrasado</span>' : '<span style="color:var(--blue);">Emprestado</span>';
      return `<tr style="border-bottom:1px solid #f0ece6;">
        <td style="padding:10px;"><strong>${esc(livro)}</strong></td>
        <td style="padding:10px;font-size:12px;">${esc(e.aluno_nome||'—')}</td>
        <td style="padding:10px;font-size:12px;">${e.data_emprestimo ? new Date(e.data_emprestimo).toLocaleDateString('pt-BR') : '—'}</td>
        <td style="padding:10px;font-size:12px;">${e.data_devolucao_prevista ? new Date(e.data_devolucao_prevista).toLocaleDateString('pt-BR') : '—'}</td>
        <td style="padding:10px;">${status}</td>
        <td style="padding:10px;">${e.status !== 'devolvido' ? `<button class="action-btn" onclick="devolverLivro('${e.id}')" title="Devolver">📥</button>` : ''}</td>
      </tr>`;
    }).join('');
  }
  async function novoEmprestimo() {
    const aluno = prompt('Nome do aluno:'); if (!aluno) return;
    const email = prompt('Email do aluno:') || '';
    if (!bibAcervo.length) await loadBibAcervo();
    const disponiveis = bibAcervo.filter(b => (b.disponivel||0) > 0);
    if (!disponiveis.length) return showToast('Nenhum livro disponível','error');
    const livro = prompt('ID do livro (ou título):\n' + disponiveis.map(b => `${b.id.substring(0,8)}... ${b.titulo} (${b.disponivel} disp.)`).join('\n'));
    if (!livro) return;
    const acervoId = disponiveis.find(b => b.id.startsWith(livro) || b.titulo.toLowerCase().includes(livro.toLowerCase()))?.id;
    if (!acervoId) return showToast('Livro não encontrado','error');
    const d = await opApi({ action:'data_emprestimo', acervo_id:acervoId, aluno_nome:aluno, aluno_email:email });
    if (d.error) return showToast(d.error,'error');
    showToast('Empréstimo registrado!','success');
    loadBibEmprestimos();
  }
  async function devolverLivro(id) {
    const d = await opApi({ action:'devolvido', id });
    if (d.error) return showToast(d.error,'error');
    showToast('Livro devolvido!','success');
    loadBibEmprestimos();
  }



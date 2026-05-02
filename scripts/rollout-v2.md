# Rollout V2 — Portal dos Pais + Dashboard Gerente

## Objetivo
Efetivar o redesign v2 como experiência padrão para todos os usuários.

## Passos

### 1. Backup dos originais
```bash
cp familia.html familia-legacy.html
cp gerente.html gerente-legacy.html
```

### 2. Atualizar links do gerente-v2
No arquivo `gerente-v2.html`, trocar todos os `gerente.html#` por `gerente-legacy.html#` para que os painéis antigos continuem funcionando.

### 3. Renomear arquivos
```bash
cp familia-v2.html familia.html
cp gerente-v2.html gerente.html
```

### 4. Verificar vercel.json
O rewrite `"/" → "/familia.html"` já aponta para o arquivo correto (que agora é o v2).

### 5. Commit e push
```bash
git add -A
git commit -m "feat: rollout redesign v2 for pais portal + gerente dashboard"
git push origin main
```

### 6. Verificação pós-deploy
- Acessar `escola.lumied.com.br` — deve mostrar o novo portal dos pais
- Acessar `escola.lumied.com.br/gerente.html` — deve mostrar o novo dashboard
- Verificar que sidebar links navegam para `gerente-legacy.html#panel`
- Verificar login funciona em ambos
- Verificar que `familia-legacy.html` e `gerente-legacy.html` ainda funcionam como fallback

### 7. Enviar email de confirmação
Usar edge function `send-email` via Supabase para notificar o resultado.

import { test, expect } from '@playwright/test';

// Testes de contrato de erro nos login paths. Pegam regressões das famílias
// de bugs corrigidos em Abr/2026 — FK em sync_sessao_to_legacy, token
// "undefined" por INSERT sem check de erro, mensagens genéricas que mascaram
// bugs estruturais.
//
// Estratégia: só testamos caminhos de ERRO (não precisam de usuário real).
// Todos usam credenciais inexistentes para validar que o backend retorna
// {error, code} com o código correto e status HTTP certo.

const API = 'https://brgorknbrjlfwvrrlwxj.supabase.co/functions/v1';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJyZ29ya25icmpsZnd2cnJsd3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjU0NTUsImV4cCI6MjA4OTM0MTQ1NX0.QKX_6ZSfied60ZpB8VOx03hwiyD9J5lskKwfl-oXPYE';
const HEADERS = { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` };
const NONEXISTENT = 'nao-existe-' + Date.now() + '@test.invalid';

test.describe('Auth error contract — credenciais', () => {
  test('unified_login: email inexistente → AUTH_BAD_CREDENTIALS 401', async ({ request }) => {
    const res = await request.post(`${API}/diplomas`, {
      headers: HEADERS,
      data: { action: 'unified_login', email: NONEXISTENT, senha: 'whatever' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_BAD_CREDENTIALS');
  });

  test('unified_login: sem email → VALIDATION_FAILED 400', async ({ request }) => {
    const res = await request.post(`${API}/diplomas`, {
      headers: HEADERS,
      data: { action: 'unified_login', senha: 'x' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION_FAILED');
  });

  test('professora_login: email inexistente → AUTH_BAD_CREDENTIALS 401', async ({ request }) => {
    const res = await request.post(`${API}/diplomas`, {
      headers: HEADERS,
      data: { action: 'professora_login', email: NONEXISTENT, senha: 'whatever' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_BAD_CREDENTIALS');
  });

  test('secretaria_login: email inexistente → AUTH_BAD_CREDENTIALS 401', async ({ request }) => {
    const res = await request.post(`${API}/diplomas`, {
      headers: HEADERS,
      data: { action: 'secretaria_login', email: NONEXISTENT, senha: 'whatever' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_BAD_CREDENTIALS');
  });

  test('gerente login: email inexistente → AUTH_BAD_CREDENTIALS 401', async ({ request }) => {
    const res = await request.post(`${API}/api`, {
      headers: HEADERS,
      data: { action: 'login', email: NONEXISTENT, senha: 'whatever' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('AUTH_BAD_CREDENTIALS');
  });

  test('aluno_login: email inexistente → AUTH_BAD_CREDENTIALS 401', async ({ request }) => {
    const res = await request.post(`${API}/academico`, {
      headers: HEADERS,
      data: { action: 'aluno_login', email: NONEXISTENT, senha: 'whatever' },
    });
    // Pode ser 403 (módulo portal_aluno desabilitado na escola) ou 401 (credencial).
    // Aceita ambos. Quando for 401, valida o code estruturado.
    expect([401, 403]).toContain(res.status());
    if (res.status() === 401) {
      const body = await res.json();
      expect(body.code).toBe('AUTH_BAD_CREDENTIALS');
    }
  });
});

test.describe('Auth error contract — papel', () => {
  test('unified_login com papel inexistente → AUTH_ROLE_MISMATCH 401', async ({ request }) => {
    // Este teste precisa de um usuário real para validar o fluxo completo.
    // Sem fixture, validamos só que papel obviamente inválido nunca retorna sucesso.
    const res = await request.post(`${API}/diplomas`, {
      headers: HEADERS,
      data: { action: 'unified_login', email: NONEXISTENT, senha: 'x', papel: 'NAOEXISTE' },
    });
    // Como email não existe, vai cair em AUTH_BAD_CREDENTIALS antes de checar papel.
    // Se no futuro quisermos um teste dedicado a AUTH_ROLE_MISMATCH, precisa fixture.
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(['AUTH_BAD_CREDENTIALS', 'AUTH_ROLE_MISMATCH']).toContain(body.code);
  });
});

test.describe('Auth error contract — formato da resposta', () => {
  test('resposta de erro sempre tem { error, code }', async ({ request }) => {
    const endpoints = [
      { fn: 'diplomas', action: 'unified_login' },
      { fn: 'diplomas', action: 'professora_login' },
      { fn: 'diplomas', action: 'secretaria_login' },
      { fn: 'api', action: 'login' },
    ];
    for (const { fn, action } of endpoints) {
      const res = await request.post(`${API}/${fn}`, {
        headers: HEADERS,
        data: { action, email: NONEXISTENT, senha: 'x' },
      });
      const body = await res.json();
      expect(body, `${fn}/${action} deve ter body.error`).toHaveProperty('error');
      expect(body, `${fn}/${action} deve ter body.code`).toHaveProperty('code');
      expect(typeof body.error).toBe('string');
      expect(typeof body.code).toBe('string');
    }
  });
});

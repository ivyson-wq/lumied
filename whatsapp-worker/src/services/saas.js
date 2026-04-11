// ═══════════════════════════════════════════════════════
//  SaaS Escolar API Client
// ═══════════════════════════════════════════════════════

async function fetchWithTimeout(url, init, ms = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export class SaasAPI {
  constructor(env) {
    this.url = env.SAAS_API_URL;
    this.key = env.SAAS_API_KEY;
  }

  async _get(path) {
    if (!this.url || !this.key) return null;
    try {
      const resp = await fetchWithTimeout(`${this.url}${path}`, {
        headers: { 'apikey': this.key, 'Authorization': `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      }, 10000);
      if (!resp.ok) return null;
      return resp.json();
    } catch (e) {
      console.error('[SAAS] Error:', e?.message || 'unknown');
      return null;
    }
  }

  async _post(path, body) {
    if (!this.url || !this.key) return null;
    try {
      const resp = await fetchWithTimeout(`${this.url}${path}`, {
        method: 'POST',
        headers: { 'apikey': this.key, 'Authorization': `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, 10000);
      if (!resp.ok) return null;
      return resp.json();
    } catch (e) {
      console.error('[SAAS] Error:', e?.message || 'unknown');
      return null;
    }
  }

  // Buscar família por número de telefone
  async getFamilyByPhone(phone) {
    return this._post('/functions/v1/api', { action: 'wa_family_by_phone', phone });
  }

  // Saldo/boletos do aluno
  async getStudentBalance(studentId) {
    return this._post('/functions/v1/api', { action: 'wa_student_balance', student_id: studentId });
  }

  // Presença do dia
  async getStudentAttendanceToday(studentId) {
    return this._post('/functions/v1/api', { action: 'wa_student_attendance_today', student_id: studentId });
  }

  // Próximos eventos da turma
  async getClassEvents(classId) {
    return this._post('/functions/v1/api', { action: 'wa_class_events', class_id: classId });
  }

  // Reuniões agendadas
  async getScheduledMeetings() {
    return this._post('/functions/v1/api', { action: 'wa_meetings_scheduled' });
  }
}

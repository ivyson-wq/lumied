// ═══════════════════════════════════════════════════════
//  SaaS Escolar API Client
// ═══════════════════════════════════════════════════════

export class SaasAPI {
  constructor(env) {
    this.url = env.SAAS_API_URL;
    this.key = env.SAAS_API_KEY;
  }

  async _get(path) {
    try {
      const resp = await fetch(`${this.url}${path}`, {
        headers: { 'apikey': this.key, 'Authorization': `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      });
      if (!resp.ok) return null;
      return resp.json();
    } catch (e) {
      console.error('[SAAS] Error:', e.message);
      return null;
    }
  }

  async _post(path, body) {
    try {
      const resp = await fetch(`${this.url}${path}`, {
        method: 'POST',
        headers: { 'apikey': this.key, 'Authorization': `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) return null;
      return resp.json();
    } catch (e) {
      console.error('[SAAS] Error:', e.message);
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

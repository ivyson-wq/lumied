// ═══════════════════════════════════════════════════════
//  Supabase Client — WhatsApp Worker
// ═══════════════════════════════════════════════════════

export class SupabaseClient {
  constructor(env) {
    this.url = env.SUPABASE_URL;
    this.key = env.SUPABASE_SERVICE_KEY;
  }

  async query(table, { select = '*', filters = {}, order, limit, single = false } = {}) {
    let url = `${this.url}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
    for (const [key, val] of Object.entries(filters)) {
      url += `&${key}=${encodeURIComponent(val)}`;
    }
    if (order) url += `&order=${order}`;
    if (limit) url += `&limit=${limit}`;
    const headers = { 'apikey': this.key, 'Authorization': `Bearer ${this.key}`, 'Content-Type': 'application/json' };
    if (single) headers['Accept'] = 'application/vnd.pgrst.object+json';
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const err = await resp.text();
      console.error(`[SUPABASE] Query ${table} error:`, err);
      return null;
    }
    return resp.json();
  }

  async insert(table, data) {
    const resp = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      console.error(`[SUPABASE] Insert ${table} error:`, await resp.text());
      return null;
    }
    const result = await resp.json();
    return Array.isArray(result) ? result[0] : result;
  }

  async update(table, filters, data) {
    let url = `${this.url}/rest/v1/${table}?`;
    for (const [key, val] of Object.entries(filters)) {
      url += `${key}=eq.${encodeURIComponent(val)}&`;
    }
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': this.key,
        'Authorization': `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(data),
    });
    if (!resp.ok) {
      console.error(`[SUPABASE] Update ${table} error:`, await resp.text());
      return null;
    }
    return resp.json();
  }

  // Convenience: get conversation state by phone
  async getConversation(phone) {
    return this.query('wa_conversation_state', { filters: { phone: `eq.${phone}` }, single: true });
  }

  async upsertConversation(phone, data) {
    const existing = await this.getConversation(phone);
    if (existing) {
      return this.update('wa_conversation_state', { phone }, { ...data, last_message_at: new Date().toISOString() });
    }
    return this.insert('wa_conversation_state', { phone, ...data, last_message_at: new Date().toISOString() });
  }

  async getDepartments() {
    return this.query('wa_departments', { filters: { active: 'eq.true' }, order: 'shortcut' });
  }

  async getUrgencyKeywords() {
    return this.query('wa_urgency_keywords', { filters: { active: 'eq.true' } });
  }

  async getRoutingKeywords() {
    return this.query('wa_routing_keywords', { filters: { active: 'eq.true' } });
  }

  async getConfig() {
    return this.query('wa_config', { limit: 1, single: true });
  }

  async logMessage(phone, direction, content, extra = {}) {
    return this.insert('wa_messages_log', { phone, direction, content, ...extra });
  }

  async getPendingMeetings(hoursAhead, reminderField) {
    const now = new Date();
    const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
    return this.query('wa_scheduled_meetings', {
      filters: {
        meeting_at: `lte.${future.toISOString()}`,
        [reminderField]: 'eq.false',
      },
    });
  }
}

import type { Env } from '../types';

export function getSupabase(env: Env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };

  return {
    from(table: string) {
      let params = '';
      let method = 'GET';
      let body: string | undefined;

      const builder = {
        select(cols = '*') { params += `?select=${encodeURIComponent(cols)}`; return builder; },
        eq(col: string, val: any) { params += `&${col}=eq.${encodeURIComponent(val)}`; return builder; },
        gte(col: string, val: any) { params += `&${col}=gte.${encodeURIComponent(val)}`; return builder; },
        lte(col: string, val: any) { params += `&${col}=lte.${encodeURIComponent(val)}`; return builder; },
        order(col: string, opts?: { ascending?: boolean }) {
          params += `&order=${col}.${opts?.ascending === false ? 'desc' : 'asc'}`;
          return builder;
        },
        limit(n: number) { params += `&limit=${n}`; return builder; },
        async single() {
          const res = await fetch(`${url}/rest/v1/${table}${params}`, {
            headers: { ...headers, 'Accept': 'application/vnd.pgrst.object+json' },
          });
          if (!res.ok) return { data: null, error: await res.text() };
          return { data: await res.json(), error: null };
        },
        async execute() {
          const res = await fetch(`${url}/rest/v1/${table}${params}`, { method, headers, body });
          if (!res.ok) return { data: null, error: await res.text() };
          return { data: await res.json(), error: null };
        },
        insert(data: any) {
          method = 'POST';
          body = JSON.stringify(data);
          return {
            async select() {
              const res = await fetch(`${url}/rest/v1/${table}`, {
                method: 'POST', headers: { ...headers, 'Prefer': 'return=representation' }, body,
              });
              const d = await res.json();
              return { data: Array.isArray(d) ? d : [d], error: res.ok ? null : d };
            },
          };
        },
        update(data: any) {
          return {
            eq(col: string, val: any) {
              return {
                async execute() {
                  const res = await fetch(`${url}/rest/v1/${table}?${col}=eq.${encodeURIComponent(val)}`, {
                    method: 'PATCH', headers: { ...headers, 'Prefer': 'return=representation' },
                    body: JSON.stringify(data),
                  });
                  return { data: res.ok ? await res.json() : null, error: res.ok ? null : await res.text() };
                },
              };
            },
          };
        },
        upsert(data: any, opts?: { onConflict?: string }) {
          const conflict = opts?.onConflict ? `&on_conflict=${opts.onConflict}` : '';
          return {
            async execute() {
              const res = await fetch(`${url}/rest/v1/${table}?${conflict}`, {
                method: 'POST',
                headers: { ...headers, 'Prefer': 'return=representation,resolution=merge-duplicates' },
                body: JSON.stringify(data),
              });
              return { data: res.ok ? await res.json() : null, error: res.ok ? null : await res.text() };
            },
          };
        },
      };
      return builder;
    },
  };
}

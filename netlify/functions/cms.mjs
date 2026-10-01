// GET  /api/cms                      → current CMS content (JSON)
// POST /api/cms  { password, data }  → replace CMS content
//
// Read by assets/js/warmelo-cms.min.js on every page, written by admin.html.
import { getStore } from '@netlify/blobs';
import seed from '../lib/cms-seed.mjs';
import { authError, json, readJson } from '../lib/http.mjs';

const KEY = 'content';

export default async (req) => {
  const store = getStore({ name: 'warmelo-cms', consistency: 'strong' });

  if (req.method === 'GET') {
    const data = await store.get(KEY, { type: 'json' });
    return json(data ?? seed);
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    const denied = authError(body);
    if (denied) return denied;

    const data = body.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return json({ error: 'Ongeldige inhoud' }, 400);
    }

    // Keep the version being overwritten so a bad save can be recovered.
    const previous = await store.get(KEY, { type: 'json' });
    if (previous) await store.setJSON(KEY + '-previous', previous);

    await store.setJSON(KEY, data);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
};

export const config = { path: '/api/cms' };

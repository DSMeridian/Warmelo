// POST /api/cms-login  { password }  → 200 if the password is correct
//
// Used by the admin.html login screen, so the password never has to be in the page.
import { authError, json, readJson } from '../lib/http.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  return authError(await readJson(req)) ?? json({ ok: true });
};

export const config = { path: '/api/cms-login' };

import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(s).digest();

// Returns an error response if the request body doesn't carry the CMS password
// (Netlify env var CMS_PASSWORD), or null when it does.
export function authError(body) {
  const expected = process.env.CMS_PASSWORD;
  if (!expected) return json({ error: 'CMS_PASSWORD is niet ingesteld op Netlify' }, 500);

  const given = typeof body?.password === 'string' ? body.password : '';
  if (!timingSafeEqual(digest(given), digest(expected))) {
    return json({ error: 'Ongeldig wachtwoord' }, 401);
  }
  return null;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// GET  /api/cms-img?id=…                          → uploaded image
// POST /api/cms-img?id=…  { password, data }      → store image (data: base64 data URL)
//
// admin.html uploads an image as soon as it is picked, then saves the returned
// URL in the CMS content (images / backgrounds).
import { getStore } from '@netlify/blobs';
import { authError, json, readJson } from '../lib/http.mjs';

// No SVG: it can carry scripts and would be served from the site's own origin.
const DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif|avif));base64,(.+)$/s;

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[a-z0-9_-]{1,200}$/i.test(id)) return json({ error: 'Ongeldige id' }, 400);

  const store = getStore({ name: 'warmelo-cms-images', consistency: 'strong' });

  if (req.method === 'GET') {
    const entry = await store.getWithMetadata(id, { type: 'arrayBuffer' });
    if (!entry) return new Response('Not found', { status: 404 });
    return new Response(entry.data, {
      headers: {
        'Content-Type': entry.metadata.contentType || 'application/octet-stream',
        // Same id is reused when an image is replaced, so keep caching short.
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    const denied = authError(body);
    if (denied) return denied;

    const match = typeof body.data === 'string' && DATA_URL.exec(body.data);
    if (!match) return json({ error: 'Alleen JPG, PNG, WebP, GIF of AVIF' }, 400);

    const [, contentType, base64] = match;
    await store.set(id, new Blob([Buffer.from(base64, 'base64')]), { metadata: { contentType } });
    return json({ url: '/api/cms-img?id=' + encodeURIComponent(id) });
  }

  return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST' });
};

export const config = { path: '/api/cms-img' };

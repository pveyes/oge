import { parse } from './parse.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, s-maxage=86400, max-age=60, stale-while-revalidate=86400',
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

async function handleApi(req: Request): Promise<Response> {
  const url = new URL(req.url).searchParams.get('url') ?? '';

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch (err) {
    return json({ error: 'Invalid URL' }, 400);
  }

  let body: string;
  let finalURL = url;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        Pragma: 'no-cache',
        Referer: 'https://oge.fatihkalifa.com/',
        'Cache-Control': 'no-cache',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.53 Safari/537.36 Edg/103.0.1264.37',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new Error(`Response code ${res.status} (${res.statusText})`);
    }
    body = await res.text();
    finalURL = res.url || url;
  } catch (err: any) {
    return json({ error: `Cannot fetch ${url}`, originResponse: { message: err?.message } }, 500);
  }

  return json(parse(body, finalURL));
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } });
    }
    return handleApi(req);
  },
};

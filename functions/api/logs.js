// WINNING Shipping AI - Pages Function: /api/logs
// 查询最近对话日志

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  if (!env.WSAI_LOG) {
    return new Response(JSON.stringify({ error: 'KV未绑定' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }

  try {
    const logs = await env.WSAI_LOG.list({ prefix: 'log:', limit: 50 });
    const entries = await Promise.all(logs.keys.map(async k => {
      const val = await env.WSAI_LOG.get(k.name);
      return JSON.parse(val);
    }));
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return new Response(JSON.stringify({ total: entries.length, logs: entries }), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

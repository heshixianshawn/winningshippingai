// WINNING Shipping AI - Pages Function: /api/health

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({
    status: 'ok',
    version: '4.0',
    mode: 'pages-function',
    knowledge: { shipReady: true, techReady: true }
  }), {
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}

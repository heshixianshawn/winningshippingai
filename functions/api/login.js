// POST /api/login {password} → 校验并下发 cookie
const CORS = { 'Content-Type': 'application/json; charset=utf-8' };

async function tokenOf(env) {
  const data = new TextEncoder().encode('wsai:' + env.SITE_PASSWORD);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (!env.SITE_PASSWORD) {
    return new Response(JSON.stringify({ ok: false, error: '未配置口令，平台当前为公开访问' }), { status: 500, headers: CORS });
  }
  let pwd = '';
  try { pwd = (await request.json()).password || ''; } catch (e) {}
  if (pwd !== env.SITE_PASSWORD) {
    await new Promise(r => setTimeout(r, 400));   // 轻微延时，降低爆破速度
    return new Response(JSON.stringify({ ok: false, error: '口令错误' }), { status: 401, headers: CORS });
  }
  const tok = await tokenOf(env);
  const cookie = `wsai_auth=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...CORS, 'Set-Cookie': cookie } });
}

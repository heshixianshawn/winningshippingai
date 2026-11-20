// WINNING Shipping AI - 统一口令门禁（Shawn 2026-11-15：先用统一口令，后续可换 Cloudflare Access）
// 机制：环境变量 SITE_PASSWORD（Secret）→ 计算 sha256 → 与 cookie 比对
// 未设置 SITE_PASSWORD 时自动放行（便于平滑上线/回退）

const ALLOW = [
  /^\/login\/?$/,
  /^\/api\/login\/?$/,
  /^\/api\/logout\/?$/,
  /^\/api\/health\/?$/,
  /^\/(css|js|static|img|images|fonts|assets)\//,
  /^\/favicon\.ico$/,
  /^\/robots\.txt$/,
  /^\/sitemap\.xml$/,
  /^\/llms\.txt$/,
];

function getCookie(request, name) {
  const h = request.headers.get('Cookie') || '';
  for (const part of h.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return '';
}

async function tokenOf(env) {
  if (!env.SITE_PASSWORD) return '';
  const data = new TextEncoder().encode('wsai:' + env.SITE_PASSWORD);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (!env.SITE_PASSWORD) return next();               // 未配置口令 → 不拦截
  if (ALLOW.some(re => re.test(url.pathname))) return next();

  const expect = await tokenOf(env);
  const got = getCookie(request, 'wsai_auth');
  if (expect && got === expect) return next();

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'unauthorized', hint: '请先访问 /login 登录' }), {
      status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
  const nextUrl = encodeURIComponent(url.pathname + url.search);
  // 302 加 no-store：避免 Safari/浏览器把重定向缓存住（曾出现“刷新后空白页”）
  return new Response(null, {
    status: 302,
    headers: { 'Location': `${url.origin}/login?next=${nextUrl}`, 'Cache-Control': 'no-store, must-revalidate' },
  });
}

// GET /login —— 统一口令登录页
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const next = url.searchParams.get('next') || '/';
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WINNING Shipping AI · 登录</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
       background:linear-gradient(160deg,#0b2a45,#123a5e 45%,#1d5b86);color:#eaf2f8}
  .card{width:360px;max-width:92vw;background:rgba(255,255,255,.08);backdrop-filter:blur(8px);
        border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:28px 26px}
  h1{font-size:18px;margin:0 0 4px;font-weight:600}
  p.sub{font-size:12px;color:#a9c4d6;margin:0 0 20px}
  input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.25);
        background:rgba(0,0,0,.2);color:#fff;font-size:15px;outline:none}
  input:focus{border-color:#5fb3e8}
  button{width:100%;margin-top:14px;padding:12px;border:0;border-radius:10px;cursor:pointer;
         background:#2f8fd0;color:#fff;font-size:15px;font-weight:600}
  button:disabled{opacity:.6;cursor:default}
  .err{margin-top:12px;font-size:13px;color:#ffb4b4;min-height:18px}
  .tip{margin-top:16px;font-size:11px;color:#8fb0c6;line-height:1.6}
</style></head>
<body>
  <form class="card" id="f">
    <h1>WINNING Shipping AI</h1>
    <p class="sub">请输入访问口令</p>
    <input id="pw" type="password" placeholder="访问口令" autocomplete="current-password" autofocus>
    <button id="btn" type="submit">进入平台</button>
    <div class="err" id="err"></div>
    <div class="tip">仅限授权人员使用。忘记口令请联系平台管理员。</div>
  </form>
<script>
const next = ${JSON.stringify(next)};
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn'), err = document.getElementById('err');
  btn.disabled = true; err.textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ password: document.getElementById('pw').value })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) { location.replace(next.startsWith('/') ? next : '/'); return; }
    err.textContent = j.error || '登录失败，请重试';
  } catch (e2) { err.textContent = '网络错误，请重试'; }
  btn.disabled = false;
});
</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function onRequest() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'wsai_auth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    },
  });
}

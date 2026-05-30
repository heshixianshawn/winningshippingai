// WINNING Shipping AI - KV 日志工具

/** 将对话记录写入 KV */
export async function logToKV(env, logData) {
  if (!env.WSAI_LOG) return;
  try {
    const key = `log:${Date.now()}`;
    await env.WSAI_LOG.put(key, JSON.stringify(logData), {
      expirationTtl: 604800
    });
  } catch (e) {
    console.error('KV log error:', e);
  }
}

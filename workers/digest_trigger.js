// WINNING Shipping AI - Digest Cron Trigger
// This Worker runs on a schedule (daily at 02:00) and triggers the
// knowledge digestion process via the Pages Function endpoint.
//
// Environment variables needed:
//   DIGEST_URL - URL of the digestion endpoint (set in Dashboard)
//   DIGEST_KEY - Shared secret key for authentication (set in Dashboard)

export default {
  async scheduled(event, env, ctx) {
    const url = env.DIGEST_URL || 'https://api.winningshippingai.com/api/memory/digest';
    const key = env.DIGEST_KEY;
    
    if (!key) {
      console.error('[DigestTrigger] DIGEST_KEY not configured');
      return;
    }
    
    console.log(`[DigestTrigger] Triggering digestion at ${url}...`);
    
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (resp.ok) {
        const body = await resp.text();
        console.log(`[DigestTrigger] Success (${resp.status}): ${body.slice(0, 200)}`);
      } else {
        console.error(`[DigestTrigger] Failed (${resp.status}): ${await resp.text()}`);
      }
    } catch (e) {
      console.error(`[DigestTrigger] Network error: ${e.message}`);
    }
  }
};

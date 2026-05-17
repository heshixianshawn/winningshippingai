// WINNING Shipping AI - Cloudflare Worker (ES Modules)
import { 
  REGULATIONS_SYSTEM_PROMPT, 
  SYSTEM_SYSTEM_PROMPT, 
  TECH_SYSTEM_PROMPT, 
  SHIP_SYSTEM_PROMPT 
} from './prompts.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/api/chat' && request.method === 'POST') {
      return handleChat(request, env, ctx, corsHeaders);
    }

    if (url.pathname === '/api/logs' && request.method === 'GET') {
      return handleLogs(request, env, ctx, corsHeaders);
    }

    // 🚢 实时采集船舶动态（从HiFleet获取最新数据）
    if (url.pathname === '/api/refresh-fleet' && request.method === 'POST') {
      return handleFleetRefresh(request, env, ctx, corsHeaders);
    }

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', version: '2.1' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

// ====== AI 调用配置 ======
// DeepSeek API（备用）
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL_TEXT = 'deepseek-chat';

// API易 OpenAI 代理（主模型）
const APIYI_BASE = 'https://api.apiyi.com/v1';
const APIYI_MODEL_VISION = 'gpt-4o-2024-11-20';
const APIYI_MODEL_TEXT = 'gpt-4o-mini-2024-07-18';

async function handleChat(request, env, ctx, corsHeaders) {
  try {
    const body = await request.json();
    const { message, module = 'regulations', imageUrl, history = [], context } = body;

    const hasImage = !!imageUrl && (imageUrl.startsWith('data:image') || imageUrl.startsWith('http'));
    const apiKey = env.DEEPSEEK_API_KEY_ENV;
    const apiYiKey = env.APIYI_API_KEY_ENV;

const systemPrompts = {
      'regulations': REGULATIONS_SYSTEM_PROMPT,
      'systems': SYSTEM_SYSTEM_PROMPT,
      'tech': TECH_SYSTEM_PROMPT,
      'ships': SHIP_SYSTEM_PROMPT
    };

    let systemContent = systemPrompts[module] || REGULATIONS_SYSTEM_PROMPT;

    // 如果有知识库 context，在 system prompt 末尾追加约束指令（增强版）
    if (context) {
      systemContent += '\n\n【知识库约束指令 — 必须严格遵守】\n';
      systemContent += '以下是用户从知识库中检索到的原始文档内容。用户消息开头已包含这些原文。\n';
      systemContent += '你的回答必须遵守：\n';
      systemContent += '1. 严格基于知识库原文回答，不添加原文中没有的信息\n';
      systemContent += '2. 原文中不存在的信息（证书编号、有效期、签发机构等），回答"知识库中未找到相关记录"\n';
      systemContent += '3. 禁止使用你的训练数据补充或编造\n';
      systemContent += '4. 将原文信息整理成易读的格式（分组、列表、高亮）\n';
      systemContent += '5. 回答末尾标注"以上信息来自WINNING知识库，请以原始文件为准"\n';
      systemContent += '\n注意：如果原文中只有部分信息（如只有船名没有证书详情），只报告你看到的内容。';
    }

    const systemMsg = { role: 'system', content: systemContent };
    const historyMsgs = history.slice(-10);
    const messages = [systemMsg, ...historyMsgs];

    // 构建用户消息
    let userMsg;
    if (hasImage && apiYiKey) {
      userMsg = {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: message }
        ]
      };
    } else if (context) {
      // 有知识库：context + 用户问题合并为一条 user 消息（增强约束）
      userMsg = {
        role: 'user',
        content: context + '\n\n[用户问题]\n' + message
      };
    } else {
      userMsg = { role: 'user', content: message };
    }

    messages.push(userMsg);

    let response;
    let apiUsed;

    // 优先用 API易（GPT-4o / GPT-4o-mini）
    if (apiYiKey) {
      const model = hasImage ? APIYI_MODEL_VISION : APIYI_MODEL_TEXT;
      apiUsed = hasImage ? 'API易 GPT-4o' : 'API易 GPT-4o-mini';
      response = await fetch(`${APIYI_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiYiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          temperature: 0.2,
          max_tokens: 4096,
          stream: false
        })
      });
    } else {
      // 无 API易 → 回退 DeepSeek
      apiUsed = 'DeepSeek';
      response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL_TEXT,
          messages: messages,
          temperature: 0.3,
          max_tokens: 4096,
          stream: false
        })
      });
    }

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({ error: 'API调用失败', detail: error, api: apiUsed }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;
    
    // 日志
    ctx.waitUntil(logToKV(env, {
      timestamp: new Date().toISOString(),
      message: message.slice(0, 200),
      module,
      hasImage,
      api: apiUsed,
      hasContext: !!context,
      replyPreview: reply.slice(0, 300),
      model: data.model,
      usage: data.usage ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens } : null
    }));
    
    return new Response(JSON.stringify({
      reply,
      model: data.model,
      usage: data.usage
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    if (env.WSAI_LOG) {
      ctx.waitUntil(env.WSAI_LOG.put(
        `error:${Date.now()}`, 
        JSON.stringify({ timestamp: new Date().toISOString(), error: err.message })
      ));
    }
    return new Response(JSON.stringify({ error: '服务器内部错误', detail: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// ====== 查看日志 API ======
async function handleLogs(request, env, ctx, corsHeaders) {
  if (!env.WSAI_LOG) {
    return new Response(JSON.stringify({ error: 'KV未绑定' }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
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
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// ====== 🚢 HiFleet 实时船舶动态采集 ======
// 直接从Worker调HiFleet REST API（与hifleet_daily_cron.py同逻辑）
// 无需本地脚本，不依赖KV缓存，每次都采集最新数据
async function handleFleetRefresh(request, env, ctx, corsHeaders) {
  try {
    // 从环境变量读取凭证（CF Pages > Settings > Environment Variables）
    const USERNAME = env.HIFLEET_USER || 'winningsub002';
    const PASSWORD = env.HIFLEET_PASS || 'sub002';

    const HIFLEET_BASE = 'https://www.hifleet.com/hifleetapi';

    // Step 1: 登录
    const loginUrl = `${HIFLEET_BASE}/generalUserLoginAction.do?&i18n=en&_v=5.4.335`;
    const reqId = `0.${Math.random()}`.padEnd(20, '0');
    const loginResp = await fetch(loginUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `id=${reqId}&email=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`
    });
    const loginText = await loginResp.text();
    let loginData;
    try { loginData = JSON.parse(loginText); } catch(e) {}
    if (!loginData || loginData.msg !== 'Login success') {
      return new Response(JSON.stringify({ error: 'HiFleet登录失败', detail: loginText }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 从Set-Cookie提取cookie
    const cookies = loginResp.headers.get('Set-Cookie') || '';
    const cookieParts = cookies.split(';').map(c => c.trim()).filter(Boolean);
    const cookieHeader = cookieParts.length > 0 ? cookieParts.join('; ') : '';

    // Step 2: 获取船队列表
    const fleetResp = await fetch(`${HIFLEET_BASE}/getMyFleetsListAction.do`, {
      headers: { 'Cookie': cookieHeader }
    });
    const fleets = await fleetResp.json();
    const fleet = fleets.find(f => f.name === 'A.WINNING FLEET');
    if (!fleet) {
      return new Response(JSON.stringify({ error: '未找到A.WINNING FLEET' }), {
        status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // Step 3: 获取所有船舶数据
    const shipsResp = await fetch(
      `${HIFLEET_BASE}/queryMyFleetsShips.do?fleetId=${fleet.id}&_v=5.4.335`,
      { headers: { 'Cookie': cookieHeader } }
    );
    const allShips = await shipsResp.json();

    // Step 4: 匹配已知船名
    const KNOWN_SUNNY = [
      'SUNNY BEYLA','SUNNY BOFFA','SUNNY BOKE','SUNNY CONAKRY','SUNNY COYAH',
      'SUNNY DABOLA','SUNNY FARANAH','SUNNY FRIA','SUNNY KALOUM','SUNNY KAMSAR',
      'SUNNY KANKAN','SUNNY KEROUANE','SUNNY KINDIA','SUNNY KOGON','SUNNY LABE',
      'SUNNY LINK','SUNNY MAMOU','SUNNY MOREBAYA','SUNNY NZKORE','SUNNY RIVER',
      'SUNNY ROUTE','SUNNY SAILOR','SUNNY SIGUIRI','SUNNY SKY','SUNNY STAR'
    ];
    const KNOWN_WINNING = [
      'WINNING ANGEL','WINNING BRIGHT','WINNING BROTHER','WINNING CONFIDENCE',
      'WINNING DILIGENCE','WINNING ENDURANCE','WINNING EXCELLENCE','WINNING FAITH',
      'WINNING GRACE','WINNING HOPE','WINNING INTEGRITY','WINNING JOY',
      'WINNING KINDNESS','WINNING LOYALTY','WINNING MISSION','WINNING NATURE',
      'WINNING OCEAN','WINNING PEACE','WINNING PRIDE','WINNING PROGRESS',
      'WINNING QUEEN','WINNING RESILIENCE','WINNING RICH','WINNING RISING',
      'WINNING SEA','WINNING SPIRIT','WINNING TEAM','WINNING UNIVERSE',
      'WINNING VISION','WINNING WEALTH','WINNING WISDOM','WINNING WORLD',
      'WINNING YOUTH','WINNING ZEPHYR'
    ];
    const ALL_NAMES = new Set([...KNOWN_SUNNY, ...KNOWN_WINNING]);

    // 去重 + 匹配
    const seen = {};
    for (const s of allShips) {
      const name = s.name || '';
      if (ALL_NAMES.has(name) && !seen[name]) {
        seen[name] = s;
      }
    }

    // 解析每条船
    function parseVessel(apiShip) {
      const name = apiShip.name || '';
      const lonRaw = apiShip.lon;
      const latRaw = apiShip.lat;
      let lon = null, lat = null;
      if (lonRaw && latRaw) {
        try { lon = parseFloat(lonRaw) / 60.0; lat = parseFloat(latRaw) / 60.0; } catch(e) {}
      }
      const nav = apiShip.navStatus || '';
      let status = '在航';
      if (nav.includes('锚泊')) status = '锚泊';
      else if (nav.includes('系泊') || nav.includes('靠泊') || nav.includes('靠')) status = '系泊';

      return {
        name, status,
        lon: lon ? Math.round(lon * 10000) / 10000 : null,
        lat: lat ? Math.round(lat * 10000) / 10000 : null,
        speed_kn: apiShip.speed ? parseFloat(apiShip.speed) : (apiShip.sog ? parseFloat(apiShip.sog) : null),
        heading_deg: apiShip.heading ? parseFloat(apiShip.heading) : null,
        destination: apiShip.destination || '',
        eta: apiShip.eta || '',
        draught_m: apiShip.draught ? parseFloat(apiShip.draught) : null,
        mmsi: apiShip.mmsi || '',
        imo: apiShip.imo || '',
        updateTime: apiShip.updatetime || ''
      };
    }

    // 按已知列表排序输出
    const vessels = [];
    for (const name of [...KNOWN_WINNING, ...KNOWN_SUNNY]) {
      const api = seen[name];
      if (api) {
        vessels.push(parseVessel(api));
      } else {
        vessels.push({
          name, status: '无数据', lon: null, lat: null, speed_kn: null,
          heading_deg: null, destination: '', eta: '', draught_m: null,
          mmsi: '', imo: '', updateTime: ''
        });
      }
    }

    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const atSea = vessels.filter(v => v.status === '在航').length;
    const anchored = vessels.filter(v => v.status === '锚泊').length;
    const moored = vessels.filter(v => v.status === '系泊').length;

    const result = {
      timestamp: now,
      group: 'A.WINNING FLEET',
      total: vessels.length,
      winning: KNOWN_WINNING.length,
      sunny: KNOWN_SUNNY.length,
      vessels
    };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: '采集船舶动态失败', detail: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
}

// ====== KV 日志写入 ======
async function logToKV(env, logData) {
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

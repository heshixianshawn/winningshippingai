// WINNING Shipping AI - Cloudflare Worker (ES Modules)
// v4.0 — 集成知识库搜索 + API易主模型 + 回退DeepSeek
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

    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        version: '4.0',
        knowledge: { shipReady: true, techReady: true }
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

// ====== AI 调用配置 ======
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL_TEXT = 'deepseek-chat';
const APIYI_BASE = 'https://api.apiyi.com/v1';
const APIYI_MODEL_VISION = 'gpt-4o-2024-11-20';
const APIYI_MODEL_TEXT = 'gpt-4o-mini-2024-07-18';

// ====== 知识库缓存（懒加载） ======
let shipKnowledge = null;
let techIndex = null;

async function ensureShipKnowledge(env) {
  if (shipKnowledge) return;
  // 从 KV 加载（优先）或从公网 URL 回退
  if (env.WSAI_SHIP_KB) {
    const raw = await env.WSAI_SHIP_KB.get('ship_knowledge.json');
    if (raw) { shipKnowledge = JSON.parse(raw); return; }
  }
  // 回退：从 CF Pages 静态资源加载
  const resp = await fetch(`https://${env.CF_PAGES_URL || 'winningshippingai.pages.dev'}/data/ship_knowledge.json`);
  if (resp.ok) shipKnowledge = await resp.json();
}

async function ensureTechIndex(env) {
  if (techIndex) return;
  if (env.WSAI_TECH_KB) {
    const raw = await env.WSAI_TECH_KB.get('tech_index.json');
    if (raw) { techIndex = JSON.parse(raw); return; }
  }
  const resp = await fetch(`https://${env.CF_PAGES_URL || 'winningshippingai.pages.dev'}/data/tech_index.json`);
  if (resp.ok) techIndex = await resp.json();
}

// ====== 知识库搜索 ======

/** 根据用户问题/关键字搜索船舶知识库，返回 context 字符串 */
function searchShipKnowledge(query) {
  if (!shipKnowledge || !shipKnowledge.ships) return '';
  const q = query.toLowerCase();
  const results = [];

  // 先尝试精确匹配船名
  const matchedShip = shipKnowledge.ships.find(s => 
    s.name.toLowerCase().includes(q) || q.includes(s.name.toLowerCase())
  );
  if (matchedShip) {
    let ctx = `【船舶知识库 - ${matchedShip.name}】\n`;
    for (const cert of matchedShip.certs.slice(0, 30)) {
      ctx += `- 证书: ${cert.cert || '(未分类)'}`;
      if (cert.expiry && cert.expiry !== '未明确提及') ctx += ` | 到期: ${cert.expiry}`;
      if (cert.file) ctx += ` | 文件: ${cert.file.slice(0, 80)}`;
      ctx += '\n';
    }
    results.push(ctx);
  }

  // 关键字匹配（证书名/到期日/设备名）
  for (const ship of shipKnowledge.ships) {
    if (matchedShip && ship.name === matchedShip.name) continue;
    const shipMatch = ship.name.toLowerCase().includes(q) || q.includes(ship.name.toLowerCase().split(' ').pop());
    const certMatch = ship.certs.some(c => 
      (c.cert || '').toLowerCase().includes(q) ||
      (c.expiry || '').toLowerCase().includes(q)
    );
    if (certMatch || shipMatch) {
      let ctx = `【船舶知识库 - ${ship.name}】\n`;
      for (const cert of ship.certs.slice(0, 15)) {
        ctx += `- 证书: ${cert.cert || '(未分类)'}`;
        if (cert.expiry && cert.expiry !== '未明确提及') ctx += ` | 到期: ${cert.expiry}`;
        ctx += '\n';
      }
      results.push(ctx);
      if (results.length >= 15) break;
    }
  }

  return results.join('\n');
}

/** 搜索技术知识库 */
function searchTechIndex(query) {
  if (!techIndex || !techIndex.devices) return '';
  const q = query.toLowerCase();
  const results = [];

  // 按设备名/类别匹配
  for (const dev of techIndex.devices) {
    const nameMatch = (dev.name || '').toLowerCase().includes(q) || (dev.category || '').toLowerCase().includes(q);
    const kwMatch = (dev.keywords || []).some(k => k.toLowerCase().includes(q));
    if (nameMatch || kwMatch) {
      results.push(`【技术知识库 - ${dev.name || '未命名'}】(分类: ${dev.category || '未分类'})\n描述: ${(dev.description || '').slice(0, 200)}\n知识条目数: ${(dev.shard_count || dev.files ? (dev.files.length || '?') : '?')}`);
      if (results.length >= 10) break;
    }
  }

  return results.join('\n');
}

/** 根据 module 自动搜索对应知识库 */
async function autoSearchKnowledge(module, message, env) {
  switch (module) {
    case 'ships':
      await ensureShipKnowledge(env);
      return searchShipKnowledge(message);
    case 'tech':
      await ensureTechIndex(env);
      return searchTechIndex(message);
    case 'systems':
    case 'regulations':
      // 体系和法规模块暂不自动搜索（依赖上传文件）
      return '';
    default:
      return '';
  }
}

// ====== 主聊天处理 ======
async function handleChat(request, env, ctx, corsHeaders) {
  try {
    // 从环境变量获取域名（用于加载知识库JSON）
    // CF_PAGES_URL 在 Pages Function 中自动注入，格式如 project.pages.dev
    // 手动部署 Worker 时需要在环境变量中设置
    if (!env.CF_PAGES_URL) {
      env.CF_PAGES_URL = 'winningshippingai.pages.dev';
    }

    const body = await request.json();
    const { message, module = 'regulations', imageUrl, history = [], context: clientContext } = body;

    const hasImage = !!imageUrl && (imageUrl.startsWith('data:image') || imageUrl.startsWith('http'));
    const apiKey = env.DEEPSEEK_API_KEY_ENV;
    const apiYiKey = env.APIYI_API_KEY_ENV;

    // 知识库上下文：优先用客户端传来的 context，否则自动搜索
    let kbContext = clientContext || '';
    if (!kbContext) {
      kbContext = await autoSearchKnowledge(module, message, env);
    }

    const systemPrompts = {
      'regulations': REGULATIONS_SYSTEM_PROMPT,
      'systems': SYSTEM_SYSTEM_PROMPT,
      'tech': TECH_SYSTEM_PROMPT,
      'ships': SHIP_SYSTEM_PROMPT
    };

    let systemContent = systemPrompts[module] || REGULATIONS_SYSTEM_PROMPT;

    // 如果有知识库上下文，追加约束指令
    if (kbContext) {
      systemContent += '\n\n【知识库约束指令 — 必须严格遵守】\n';
      systemContent += '用户消息开头已包含知识库原文。\n';
      systemContent += '你的回答必须遵守：\n';
      systemContent += '1. 严格基于知识库原文回答，不添加原文中没有的信息\n';
      systemContent += '2. 原文中不存在的信息，回答"知识库中未找到相关记录"\n';
      systemContent += '3. 禁止使用你的训练数据补充或编造\n';
      systemContent += '4. 将原文信息整理成易读的格式（分组、列表、高亮）\n';
      systemContent += '5. 回答末尾标注"以上信息来自WINNING知识库，请以原始文件为准"\n';
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
    } else if (kbContext) {
      userMsg = {
        role: 'user',
        content: kbContext + '\n\n[用户问题]\n' + message
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
      hasContext: !!kbContext,
      replyPreview: reply.slice(0, 300),
      model: data.model,
      usage: data.usage ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens } : null
    }));
    
    return new Response(JSON.stringify({
      reply,
      model: data.model,
      usage: data.usage,
      rag: !!kbContext
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

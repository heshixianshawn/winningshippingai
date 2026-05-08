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

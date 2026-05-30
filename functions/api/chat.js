// WINNING Shipping AI - Pages Function: /api/chat
// v4.0 — 集成知识库自动搜索 + API易主模型 + 回退DeepSeek

import {
  REGULATIONS_SYSTEM_PROMPT,
  SYSTEM_SYSTEM_PROMPT,
  TECH_SYSTEM_PROMPT,
  SHIP_SYSTEM_PROMPT
} from './_system_prompts.js';
import { autoSearchKnowledge } from './_knowledge.js';
import { logToKV } from './_logger.js';

// ====== AI 调用配置 ======
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL_TEXT = 'deepseek-chat';
const APIYI_BASE = 'https://api.apiyi.com/v1';
const APIYI_MODEL_VISION = 'gpt-4o-2024-11-20';
const APIYI_MODEL_TEXT = 'gpt-4o-mini-2024-07-18';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const SYSTEM_PROMPTS = {
  'regulations': REGULATIONS_SYSTEM_PROMPT,
  'systems': SYSTEM_SYSTEM_PROMPT,
  'tech': TECH_SYSTEM_PROMPT,
  'ships': SHIP_SYSTEM_PROMPT
};

export async function onRequest(context) {
  const { request, env } = context;

  // OPTIONS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
  }

  try {
    const body = await request.json();
    const { message, module = 'regulations', imageUrl, history = [], context: clientContext } = body;

    const hasImage = !!imageUrl && (imageUrl.startsWith('data:image') || imageUrl.startsWith('http'));
    const apiYiKey = env.APIYI_API_KEY_ENV;

    // ====== 知识库搜索 ======
    let kbContext = clientContext || '';
    let ragUsed = !!kbContext;
    if (!kbContext) {
      kbContext = await autoSearchKnowledge(module, message, request);
      ragUsed = !!kbContext;
    }

    // ====== 构建消息 ======
    let systemContent = SYSTEM_PROMPTS[module] || REGULATIONS_SYSTEM_PROMPT;

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
    const historyMsgs = (history || []).slice(-10);
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
      userMsg = { role: 'user', content: kbContext + '\n\n[用户问题]\n' + message };
    } else {
      userMsg = { role: 'user', content: message };
    }
    messages.push(userMsg);

    // ====== 调用 AI API ======
    let response;
    let apiUsed;

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
          model,
          messages,
          temperature: 0.2,
          max_tokens: 4096,
          stream: false
        })
      });
    } else {
      apiUsed = 'DeepSeek';
      response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY_ENV || ''}`
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL_TEXT,
          messages,
          temperature: 0.3,
          max_tokens: 4096,
          stream: false
        })
      });
    }

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({ error: 'API调用失败', detail: error, api: apiUsed }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;
    const usage = data.usage || {};

    // ====== 写日志（fire-and-forget） ======
    (async () => {
      await logToKV(env, {
        timestamp: new Date().toISOString(),
        message: message.slice(0, 200),
        module,
        hasImage,
        api: apiUsed,
        hasContext: ragUsed,
        replyPreview: reply.slice(0, 300),
        model: data.model,
        usage: { prompt: usage.prompt_tokens, completion: usage.completion_tokens }
      });
    })();

    return new Response(JSON.stringify({
      reply,
      model: data.model,
      usage,
      rag: ragUsed
    }), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: '服务器内部错误', detail: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

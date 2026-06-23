// WINNING Shipping AI - Pages Function: /api/chat
// v5.0 — 思考引擎集成：结构化船舶数据 → 意图分析 → 思维链交付

import {
  REGULATIONS_SYSTEM_PROMPT,
  SYSTEM_SYSTEM_PROMPT,
  TECH_SYSTEM_PROMPT,
  SHIP_SYSTEM_PROMPT
} from './_system_prompts.js';
import { autoSearchKnowledge } from './_knowledge.js';
import { logToKV } from './_logger.js';
import { analyzeIntent, buildThinkingContext } from './_thinking_engine.js';
import { queryMemory, injectMemoryPrompt, logQuery } from './memory/_memory_core.js';

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

    // ====== 思考引擎：检测前端传来的结构化数据 ======
    let isThinkingMode = false;
    let awareData = null;
    
    if (module === 'ships' && clientContext && typeof clientContext === 'string') {
      try {
        const parsed = JSON.parse(clientContext);
        if (parsed && (parsed.type === 'ship_query' || (parsed.ship && parsed.params))) {
          isThinkingMode = true;
          awareData = parsed;
        }
      } catch (e) {
        // 不是JSON，正常字符串处理
      }
    }

    // ====== Knowledge Base Search ======
    let kbContext = '';
    let ragUsed = false;

    if (isThinkingMode && awareData) {
      // 思考引擎模式：前端已分析结构数据，我们在Worker侧再做意图分析
      const intent = analyzeIntent(awareData, message);
      kbContext = buildThinkingContext(awareData, intent);
      ragUsed = true;
    } else if (clientContext && typeof clientContext === 'string' && clientContext.length > 0) {
      kbContext = clientContext;
      ragUsed = true;
    } else {
      kbContext = await autoSearchKnowledge(module, message, request);
      ragUsed = !!kbContext;
    }

    // ====== Build messages ======
    let systemContent = SYSTEM_PROMPTS[module] || REGULATIONS_SYSTEM_PROMPT;

    // ====== Memory System: inject digested long-term memory ======
    let memoryEntries = [];
    if (env && env.DB) {
      try {
        memoryEntries = await queryMemory(env.DB, message, module);
      } catch (e) {
        console.error('[Memory] query failed:', e.message);
      }
    }
    if (memoryEntries.length > 0) {
      systemContent = injectMemoryPrompt(systemContent, memoryEntries);
    }

    if (ragUsed && kbContext) {
      if (isThinkingMode) {
        systemContent += '\n\n【⚠️ 知识库约束】以下用户消息开头包含【思考引擎】预分析的结构化数据，请严格基于该数据分析后回答。原文中不存在的信息回复"未找到"。回答末尾加"以上信息来自WINNING知识库"。';
      } else {
        systemContent += '\n\n【⚠️ 知识库约束】用户消息开头已包含知识库原文。必须严格基于该结果回答，不添加原文中没有的信息。没有的信息回答"未找到"。';
      }
    }

    const systemMsg = { role: 'system', content: systemContent };
    const historyMsgs = (history || []).slice(-10);
    const messages = [systemMsg, ...historyMsgs];

    // User message
    let userMsg;
    if (hasImage && apiYiKey) {
      userMsg = {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: message }
        ]
      };
    } else if (ragUsed && kbContext) {
      userMsg = { role: 'user', content: kbContext + '\n\n[用户问题]\n' + message };
    } else {
      userMsg = { role: 'user', content: message };
    }
    messages.push(userMsg);

    // ====== Call AI ======
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
      return new Response(JSON.stringify({ error: 'API失败', detail: error, api: apiUsed }), {
        status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
      });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;
    const usage = data.usage || {};

    // ====== Log ======
    (async () => {
      await logToKV(env, {
        timestamp: new Date().toISOString(),
        message: message.slice(0, 200),
        module,
        hasImage,
        api: apiUsed,
        hasContext: ragUsed,
        isThinking: isThinkingMode,
        replyPreview: reply.slice(0, 300),
        model: data.model,
        usage: { prompt: usage.prompt_tokens, completion: usage.completion_tokens }
      });
    })();

    // ====== Log query to memory system ======
    if (env && env.DB && memoryEntries.length > 0) {
      ctx.waitUntil(logQuery(env.DB, {
        module,
        question: message.slice(0, 200),
        topics: memoryEntries.map(m => m.topic),
        count: memoryEntries.length
      }));
    }

    return new Response(JSON.stringify({
      reply,
      model: data.model,
      usage,
      rag: ragUsed,
      thinking: isThinkingMode,
      memoryUsed: memoryEntries.length
    }), {
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: '内部错误', detail: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

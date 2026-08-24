// WINNING Shipping AI - Pages Function: /api/chat
// v5.0 — 思考引擎集成：结构化船舶数据 → 意图分析 → 思维链交付

import {
  REGULATIONS_SYSTEM_PROMPT,
  SYSTEM_SYSTEM_PROMPT,
  TECH_SYSTEM_PROMPT,
  SHIP_SYSTEM_PROMPT
} from './_system_prompts.js';
import { querySurveyKnowledge, getAlertSummary } from './_survey_knowledge.js';
import { autoSearchKnowledge, buildPscPrepChecklist, searchImoConventions, searchImoUpdates, searchOfficialSources, searchQuickRef, searchRegsAllKnowledge } from './_knowledge.js';
import { searchFleetKnowledge } from './_fleet_data.js';
import { logToKV } from './_logger.js';
import { analyzeIntent, buildThinkingContext } from './_thinking_engine.js';
import { queryMemory, injectMemoryPrompt, logQuery } from './memory/_memory_core.js';

// ====== AI 调用配置 ======
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL_TEXT = 'deepseek-chat';
const DEEPSEEK_MODEL_VISION = 'deepseek-v4-flash-vision-exp';  // 2026-08-23 DeepSeek 官方多模态视觉模型
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
    const { message, module = 'regulations', imageUrl, ocrText, history = [], context: clientContext } = body;

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
    let quickAnswer = null;  // PSC 速查命中内容（强制原样输出）

    if (isThinkingMode && awareData) {
      // 思考引擎模式：前端已分析结构数据，Worker侧再补充后端权威检索（参数库 + PSC 风险）
      const intent = analyzeIntent(awareData, message);
      kbContext = buildThinkingContext(awareData, intent);
      try {
        const fleetCtx = await searchFleetKnowledge(message, request);
        if (fleetCtx) kbContext += '\n\n' + fleetCtx;
      } catch (e) {
        console.error('[Fleet] thinking-mode search failed:', e.message);
      }
      ragUsed = true;
    } else if (clientContext && typeof clientContext === 'string' && clientContext.length > 0) {
      kbContext = clientContext;
      ragUsed = true;
      // 法规模块：即使有 TYPE 标签也追加法规原文检索（SOLAS 知识库）+ IMO 官方公约信息
      if (module === 'regulations') {
        // ⭐ 速查库最优先（权威答案，防 AI 编造）：命中时直接模板化返回（可靠优先，不依赖模型遵循）
        try {
          const quickInfo = await searchQuickRef(request, message);
          if (quickInfo) {
            return {
              reply: quickInfo + '\n\n⚠️ 以上为 PSC 高频速查权威内容（人工精编，基于 SOLAS 2024 原文，来源可溯）。如需针对特定船型/船队的补充分析或实操建议，请继续追问。',
              model: 'quickref-knowledge',
              source: 'PSC速查库'
            };
          }
        } catch (e) { console.error('[Regs] quickref search failed:', e.message); }
        try {
          const regKb = await autoSearchKnowledge('regulations', message, request);
          if (regKb) kbContext += '\n\n' + regKb;
        } catch (e) { console.error('[Regs] kb search failed:', e.message); }
        try {
          const regsAll = await searchRegsAllKnowledge(request, message);
          if (regsAll) kbContext += '\n\n' + regsAll;
        } catch (e) { console.error('[Regs] regsAll search failed:', e.message); }
        try {
          const updInfo = await searchImoUpdates(request, message);
          if (updInfo) kbContext += '\n\n' + updInfo;
        } catch (e) { console.error('[Regs] imo updates failed:', e.message); }
        try {
          const imoInfo = await searchImoConventions(request, message);
          if (imoInfo) kbContext += '\n\n' + imoInfo;
        } catch (e) { console.error('[Regs] imo search failed:', e.message); }
        try {
          const offInfo = await searchOfficialSources(request, message);
          if (offInfo) kbContext += '\n\n' + offInfo;
        } catch (e) { console.error('[Regs] official search failed:', e.message); }
      }
    } else if (module === 'ships') {
      // 多源检索（合并）：Survey 检验证书 + 参数库(GT/DWT/主机) + TMOU PSC 风险档案
      const parts = [];
      // 🚢 PSC 检查前准备清单（2026-08-23）：识别"PSC准备/检查注意"意图
      const pscPrepPats = /(PSC\s*(检查|准备|注意|要点|风险|注意什么)|检查前准备|检查准备|进港.*检查|检查.*注意|准备.*PSC)/i;
      if (pscPrepPats.test(message)) {
        try {
          const prep = await buildPscPrepChecklist(request, message);
          if (prep) parts.push('【🚢 PSC 检查前准备清单】\n' + prep);
        } catch (e) { console.error('[PscPrep] failed:', e.message); }
      }
      const surveyResult = querySurveyKnowledge(message);
      if (surveyResult) parts.push(surveyResult);
      try {
        const fleetCtx = await searchFleetKnowledge(message, request);
        if (fleetCtx) parts.push(fleetCtx);
      } catch (e) {
        console.error('[Fleet] search failed:', e.message);
      }
      if (parts.length === 0) {
        const kb = await autoSearchKnowledge(module, message, request);
        if (kb) parts.push(kb);
      }
      kbContext = parts.join('\n\n');
      ragUsed = !!kbContext;
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

    // ====== Survey Alert Summary for ships module ======
    if (module === 'ships') {
      try {
        const alerts = getAlertSummary();
        if (alerts) {
          systemContent += '\n\n【📊 当前检验与证书预警状态】\n' + alerts;
        }
      } catch (e) {
        console.error('[Survey] alert summary failed:', e.message);
      }
    }

    if (ragUsed && kbContext) {
      if (isThinkingMode) {
        systemContent += '\n\n【⚠️ 知识库约束】以下用户消息开头包含【思考引擎】预分析的结构化数据，请严格基于该数据分析后回答。原文中不存在的信息回复"未找到"。回答末尾加"以上信息来自WINNING知识库"。';
      } else {
        systemContent += '\n\n【⚠️ 知识库约束】用户消息开头已包含知识库原文。必须严格基于该结果回答，不添加原文中没有的信息。没有的信息回答"未找到"。';
      }
    }

    // 🚨 速查命中强制指令（2026-08-23）：速查条目=标准答案，必须原样输出其【速查：】段内容
    if (quickAnswer) {
      systemContent += '\n\n【🚨 强制指令】用户消息中的【PSC 高频速查】段是标准答案，必须：\n1. 原样完整输出该段中每个「速查：」条目的答案内容（从问号到来源标注之间的全部文字），作为回答主体；\n2. 禁止修改其中的任何周期/数值/条款号（如不得把"每5年"改成"每年"，不得把"释放钩不脱钩"改成"必须脱钩"）；\n3. 速查内容输出后，再补充一段 WINNING 船队适用性分析和实操建议；\n4. 末尾保留免责声明。';
    }

    const systemMsg = { role: 'system', content: systemContent };
    const historyMsgs = (history || []).slice(-10);
    const messages = [systemMsg, ...historyMsgs];

    // User message
    let userMsg;
    if (hasImage && apiYiKey) {
      // 图片 + 法规/体系知识库上下文合并（2026-08-23 修复：图片请求也注入检索结果）+ OCR 文字层
      const textPart = (ragUsed && kbContext ? kbContext + '\n\n[用户问题]\n' : '') + message;
      const ocrPart = ocrText ? '\n\n【图片OCR文字，供引用原文条款】\n' + String(ocrText).substring(0, 3000) : '';
      userMsg = {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: textPart + ocrPart }
        ]
      };
    } else if (ragUsed && kbContext) {
      userMsg = { role: 'user', content: kbContext + '\n\n[用户问题]\n' + message };
    } else {
      userMsg = { role: 'user', content: message };
    }
    messages.push(userMsg);

    // ====== Call AI ======
    // 2026-08-23 策略：无图→DeepSeek(省钱无限)；有图→APIYI vision(必须)；APIYI 失败自动回退 DeepSeek
    let response;
    let apiUsed;

    if (hasImage) {
      // 2026-08-23 策略：图片优先 DeepSeek V4-Flash-Vision（官方多模态，便宜），失败回退 APIYI GPT-4o
      const dsKey = env.DEEPSEEK_API_KEY_ENV || '';
      let dsVisionOk = false;
      if (dsKey) {
        try {
          const dsResp = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dsKey}` },
            body: JSON.stringify({
              model: DEEPSEEK_MODEL_VISION,
              messages,
              temperature: 0.2,
              max_tokens: 4096,
              stream: false
            })
          });
          if (dsResp.ok) {
            apiUsed = 'DeepSeek Vision';
            response = dsResp;
            dsVisionOk = true;
          } else {
            const errText = await dsResp.text().catch(() => '');
            console.error('[DeepSeek vision failed]', dsResp.status, errText.substring(0, 200));
          }
        } catch (e) { console.error('[DeepSeek vision error]', e.message); }
      }
      if (!dsVisionOk && apiYiKey) {
        apiUsed = 'API易 GPT-4o';
        try {
          response = await fetch(`${APIYI_BASE}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiYiKey}` },
            body: JSON.stringify({
              model: APIYI_MODEL_VISION,
              messages,
              temperature: 0.2,
              max_tokens: 4096,
              stream: false
            })
          });
          if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error('[APIYI vision failed]', response.status, errText.substring(0, 200));
            return { reply: '⚠️ 图片分析服务暂时不可用（视觉模型均失败，配额或网络问题），请稍后重试，或直接描述缺陷内容，我将依据法规知识库回答。', model: 'error' };
          }
        } catch (e) {
          console.error('[APIYI vision error]', e.message);
          return { reply: '⚠️ 图片分析服务暂时不可用（视觉模型均失败，配额或网络问题），请稍后重试，或直接描述缺陷内容，我将依据法规知识库回答。', model: 'error' };
        }
      } else if (!dsVisionOk && !apiYiKey) {
        return { reply: '⚠️ 图片分析服务暂时不可用（视觉模型未配置），请稍后重试，或直接描述缺陷内容。', model: 'error' };
      }
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

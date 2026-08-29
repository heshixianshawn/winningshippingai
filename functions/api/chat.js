// WINNING Shipping AI - Pages Function: /api/chat
// v5.0 — 思考引擎集成：结构化船舶数据 → 意图分析 → 思维链交付

import {
  REGULATIONS_SYSTEM_PROMPT,
  SYSTEM_SYSTEM_PROMPT,
  TECH_SYSTEM_PROMPT,
  SHIP_SYSTEM_PROMPT
} from './_system_prompts.js';
import { querySurveyKnowledge, getAlertSummary } from './_survey_knowledge.js';
import { autoSearchKnowledge, buildPscPrepChecklist, searchImoConventions, searchImoUpdates, searchOfficialSources, searchQuickRef, searchRegsAllKnowledge, searchRegulationsKnowledge, searchFullTextShards, matchDefectRegulations } from './_knowledge.js';
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
    // 图片过大/异常拦截：dataURL base64 超 4MB 直接拒绝（大图曾致 Worker 1101 崩溃）
    if (hasImage && imageUrl.startsWith('data:') && imageUrl.length > 4200000) {
      return { reply: '⚠️ 图片文件过大（超过约3MB），无法处理。请压缩图片或上传扫描件时确保清晰度适中后重试。', model: 'error' };
    }
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
    // 2026-08-29：上传文件（PSC报告等）解析场景标记（顶层定义，供各分支复用）
    const isFileUploadParse = /以下是(文件|扫描件PDF)/.test(message);
    let quickAnswer = null;  // PSC 速查命中内容（强制原样输出）

    if (isThinkingMode && awareData) {
      // 思考引擎模式：前端已分析结构数据，Worker侧再补充后端权威检索（参数库 + Survey Status + PSC 风险）
      const intent = analyzeIntent(awareData, message);
      kbContext = buildThinkingContext(awareData, intent);
      try {
        // 2026-08-25：证书/检验信息以最新 Survey Status 知识库为准（前端 OCR 旧证书库已停用），按船名注入权威明细
        if (awareData && awareData.ship) {
          const shipSurvey = querySurveyKnowledge(String(awareData.ship));
          if (shipSurvey) kbContext += '\n\n' + shipSurvey;
        }
        const fleetCtx = await searchFleetKnowledge(message, request);
        if (fleetCtx) kbContext += '\n\n' + fleetCtx;
      } catch (e) {
        console.error('[Fleet] thinking-mode search failed:', e.message);
      }
      ragUsed = true;
    } else if (clientContext && typeof clientContext === 'string' && clientContext.length > 0) {
      kbContext = clientContext;
      ragUsed = true;
      // 2026-08-29：上传文件（PSC报告等）解析场景跳过检索——检索词就是报告内容，会把模型引向法规条文而非解析文档
      if (module === 'regulations' && !isFileUploadParse) {
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
      // 2026-08-29：PSC报告上传解析 → 模型只负责解析缺陷，条款由后端硬附加（防模型编造条款号）
      if (module === 'regulations' && isFileUploadParse) {
        kbContext = '';
        ragUsed = false;
      } else {
        kbContext = await autoSearchKnowledge(module, message, request);
        ragUsed = !!kbContext;
      }
    }

    // ====== Build messages ======
    let systemContent = SYSTEM_PROMPTS[module] || REGULATIONS_SYSTEM_PROMPT;

    // ====== 2026-08-29：注入服务器当前日期（杜绝模型凭训练数据印象计算剩余/过期天数） ======
    try {
      const _now = new Date();
      const _pad = (n) => String(n).padStart(2, '0');
      const _today = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
      const _week = ['日', '一', '二', '三', '四', '五', '六'][_now.getDay()];
      systemContent = `【📅 当前日期】今天是 ${_today}（星期${_week}）。\n所有“剩余天数/已过期/即将到期/还有多久”的计算**必须基于这个日期**，禁止凭印象或训练数据估算。\n\n` + systemContent;
    } catch (e) {
      console.error('[Date] inject failed:', e.message);
    }

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
        // 2026-08-25 修复：单船查询只注入该船预警（全局预警注入导致模型把其他船的过期项串到查询船，如FAITH问出JOY/FRIA的日期）
        const queryShip = (isThinkingMode && awareData && awareData.ship) ? awareData.ship : null;
        const alerts = getAlertSummary(queryShip);
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

    const data = await response.json().catch(() => ({}));
    const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content)
      ? data.choices[0].message.content : null;
    if (!reply) {
      console.error('[API] 空回复/异常结构', apiUsed);
      return { reply: '⚠️ AI 返回异常（' + apiUsed + '），请稍后重试或换种问法。', model: 'error' };
    }
    const usage = data.usage || {};

    // ====== 2026-08-29：法规提问硬附加相关条款原文（借鉴DNV AI引用模式 + 发挥我们全文知识库优势） ======
    // PSC报告解析：附加缺陷条款；普通法规提问：附加命中条款原文（对症优先）
    let finalReply = reply;
    if (module === 'regulations') {
      try {
        if (isFileUploadParse) {
          const defectLaw = await matchDefectRegulations(request, message);
          if (defectLaw) finalReply = reply + '\n\n---\n\n' + defectLaw;
        } else {
          // 普通法规提问：全文词频检索（专有词加权，对症条款优先），硬附加原文（防模型凭记忆编造条款号）
          const isQuickHit = /PSC 高频速查/.test(reply);
          if (!isQuickHit) {
            const sections = [];
            try {
              const hits = await searchFullTextShards(request, message, 3);
              for (const h of hits) {
                const words = message.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length >= 5);
                const body = (h.text || '').slice(0, 1300);
                sections.push(`【${h.title}】\n${body}`);
              }
            } catch (e) { console.error('[Law] fulltext failed:', e.message); }
            if (sections.length === 0) {
              try {
                const solas = await searchRegulationsKnowledge(request, message);
                if (solas) {
                  const parts = solas.split('\n\n---\n\n').filter(s => s.trim() && !s.startsWith('【SOLAS 2024'));
                  for (const p of parts.slice(0, 3)) sections.push(p.slice(0, 1500));
                }
              } catch (e) { /* 忽略 */ }
            }
            if (sections.length > 0) {
              finalReply = reply + '\n\n---\n\n【📖 相关法规原文（知识库检索·对症条款优先，请与官方原文核对）】\n\n' + sections.join('\n\n---\n\n');
            }
          }
        }
      } catch (e) { console.error('[Law] append failed:', e.message); }
    }

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
      reply: finalReply,
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

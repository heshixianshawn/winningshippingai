// WINNING Shipping AI - Memory System Core
// Reads digested knowledge from D1 and injects into AI prompts.
// Also provides the query endpoint for the cron digester.
//
// Usage (in chat.js):
//   import { queryMemory, injectMemoryPrompt } from './memory/_memory_core.js';
//   const memories = await queryMemory(env.DB, message, module);
//   const enhancedPrompt = injectMemoryPrompt(systemContent, memories);

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const DEEPSEEK_MODEL = 'deepseek-chat';
const MEMORY_TOPIEC_LIMIT = 5;  // Max memory entries to inject per query

/**
 * Query D1 for memory entries relevant to the user's question.
 * Uses keyword matching on topic field first, then fallback to summary search.
 * 
 * @param {D1Database} db  - The D1 binding
 * @param {string} question - User's question
 * @param {string} module   - 'ships'|'tech'|'regulations'|'systems'
 * @returns {Promise<Array>} Array of memory entry objects
 */
export async function queryMemory(db, question, module) {
  if (!db) return [];
  
  const q = (question || '').toUpperCase();
  const results = [];
  
  // Phase 1: Exact topic match (ship names, equipment types)
  // Extract likely keywords from user question
  const keywords = extractKeywords(q, module);
  
  if (keywords.length > 0) {
    for (const kw of keywords) {
      const stmt = db.prepare(
        `SELECT id, topic, topic_type, summary, key_facts, has_conflict, conflict_note, source_file
         FROM memory_entries
         WHERE UPPER(topic) LIKE ? OR UPPER(topic) LIKE ? OR UPPER(topic) LIKE ?
         ORDER BY updated_at DESC
         LIMIT 3`
      );
      // Three match patterns: exact, starts-with, contains
      const matches = [kw, kw + '%', '%' + kw + '%'];
      try {
        const { results: rows } = await stmt.bind(kw, kw + '%', '%' + kw + '%').all();
        for (const row of rows) {
          if (!results.find(r => r.id === row.id)) {
            results.push(row);
          }
        }
      } catch (e) {
        console.error('[Memory] Query error:', e.message);
      }
    }
  }
  
  // Phase 2: Module-based fallback - look for general memories in this module's domain
  if (results.length < 2) {
    const topicType = moduleToTopicType(module);
    if (topicType) {
      try {
        const stmt = db.prepare(
          `SELECT id, topic, topic_type, summary, key_facts, has_conflict, conflict_note, source_file
           FROM memory_entries
           WHERE topic_type = ?
           ORDER BY updated_at DESC
           LIMIT 3`
        );
        const { results: rows } = await stmt.bind(topicType).all();
        for (const row of rows) {
          if (!results.find(r => r.id === row.id)) {
            results.push(row);
          }
        }
      } catch (e) {
        console.error('[Memory] Fallback query error:', e.message);
      }
    }
  }
  
  return results.slice(0, MEMORY_TOPIEC_LIMIT);
}

/**
 * Extract potential memory topic keywords from user question.
 * 
 * Key improvement: handles mixed Chinese + English queries like 
 * "BOFFA单船信息" → extracts "BOFFA" as keyword even though it's
 * attached to Chinese characters without spaces.
 */
function extractKeywords(q, module) {
  const keywords = [];
  
  // Phase 1: Extract known ship name patterns that may be attached to Chinese chars
  // Matches WINNING*, SUNNY*, or standalone ALL-CAPS words (ship names, IMO numbers, etc.)
  const shipPrefixMatch = q.match(/(WINNING\w*)|(SUNNY\w*)/g);
  if (shipPrefixMatch) {
    for (const m of shipPrefixMatch) {
      keywords.push(m);
    }
  }
  
  // Phase 2: Split mixed text on word boundaries. Handle cases like:
  // "BOFFA单船" → extract "BOFFA"
  // "加入韦立的时间和particulars" → extract "particulars"
  
  // Extract all-letter English words (2+ chars) from mixed text
  const englishWords = q.match(/[A-Za-z]{2,}/g);
  if (englishWords) {
    for (const w of englishWords) {
      const upper = w.toUpperCase();
      if (upper.startsWith('WINNING') || upper.startsWith('SUNNY')) continue; // Already handled
      if (upper === 'IMO') continue; // Generic, not a ship name
      keywords.push(upper);
    }
  }
  
  // Phase 3: Chinese equipment/facility keywords
  // Don't use space-split here; use character-level matching for Chinese
  if (/锅炉|BOILER|锅炉/.test(q)) keywords.push('锅炉');
  if (/主机|ENGINE|副机|辅机|M\/E|ME[^T]/.test(q)) keywords.push('主机');
  if (/压载|BALLAST|BWT/.test(q)) keywords.push('压载水');
  if (/脱硫|SCRUBBER/.test(q)) keywords.push('脱硫塔');
  if (/锅炉|BOILER/.test(q)) keywords.push('锅炉');
  if (/辅机|发电机|GENERATOR|A[.]?E[^RT]/.test(q)) keywords.push('辅机');
  if (/舵机|STEERING/.test(q)) keywords.push('舵机');
  if (/分油机|PURIFIER|SEPARATOR/.test(q)) keywords.push('分油机');
  if (/泵|PUMP/.test(q)) keywords.push('泵');
  if (/热水器|加热器|HEATER|热水/.test(q)) keywords.push('热水器');
  if (/侧推|THRUSTER/.test(q)) keywords.push('侧推');
  
  // Phase 4: Before returning, if module='ships' and no keywords found,
  // search for any word that could be a ship name fragment
  if (module === 'ships' && keywords.length === 0) {
    // Last resort: grab the first all-caps or capitalized English word
    const anyCaps = q.match(/[A-Za-z]{4,}/);
    if (anyCaps) keywords.push(anyCaps[0].toUpperCase());
  }
  
  // Phase 5: Module-level fallback (no specific match, but we know the domain)
  if (keywords.length === 0) {
    if (module === 'tech') keywords.push('技术资料');
    else if (module === 'regulations') keywords.push('法规');
  }
  
  return [...new Set(keywords)];  // Deduplicate
}

/**
 * Map module name to topic_type.
 */
function moduleToTopicType(module) {
  const map = {
    'ships': 'ship',
    'tech': 'equipment',
    'regulations': 'regulation',
    'systems': 'system'
  };
  return map[module] || null;
}

/**
 * Inject memory entries into system prompt.
 * Returns the enhanced prompt string.
 * 
 * @param {string} systemContent - Original system prompt
 * @param {Array} memories - Memory entries from queryMemory()
 * @returns {string} Enhanced system prompt with memory context
 */
export function injectMemoryPrompt(systemContent, memories) {
  if (!memories || memories.length === 0) {
    return systemContent;
  }
  
  let memorySection = '\n\n【📚 知识库记忆】\n';
  memorySection += '以下是从系统长期记忆中提取的已消化知识摘要：\n\n';
  
  for (const mem of memories) {
    memorySection += `### ${mem.topic}\n`;
    memorySection += `来源: ${mem.source_file}\n`;
    memorySection += `${mem.summary}\n`;
    
    // Include key facts if available
    if (mem.key_facts) {
      try {
        const facts = JSON.parse(mem.key_facts);
        if (facts.length > 0) {
          memorySection += '\n关键事实:\n';
          for (const f of facts.slice(0, 10)) {
            memorySection += `- ${f}\n`;
          }
        }
      } catch (e) {}
    }
    
    // Conflict alert
    if (mem.has_conflict && mem.conflict_note) {
      memorySection += `\n⚠️ **数据冲突警示**: ${mem.conflict_note}\n`;
    }
    
    memorySection += '\n';
  }
  
  memorySection += '【知识库记忆结束】\n\n';
  memorySection += '回答要求：以上知识库记忆是系统预消化的摘要，请基于这些信息和你的训练知识回答。\n';
  memorySection += '如果发现数据矛盾，请指出矛盾之处并做合理推断。\n';
  memorySection += '标注⚠️的内容为可能存在数据冲突，需谨慎引用。\n';
  
  return systemContent + memorySection;
}

/**
 * Digest a chunk of data through DeepSeek to generate memory entry.
 * Used by the cron digester.
 * 
 * @param {Object} params
 * @param {string} params.data - The raw data to digest (JSON string)
 * @param {string} params.topic - Topic name for the entry
 * @param {string} params.topicType - 'ship'|'equipment'|'regulation'|'system'
 * @param {string} params.sourceFile - Source file path
 * @param {string} params.deepseekKey - DeepSeek API key
 * @param {Array} params.existingEntries - Optional existing entries for conflict detection
 * @returns {Promise<Object>} { summary, keyFacts, hasConflict, conflictNote }
 */
export async function digestData(params) {
  const { data, topic, topicType, sourceFile, deepseekKey, existingEntries } = params;
  
  if (!deepseekKey) {
    throw new Error('DEEPSEEK_API_KEY_ENV is required for digestion');
  }
  
  // Build the digestion prompt
  const isConflictCheck = existingEntries && existingEntries.length > 0;
  
  let prompt = `你是一个专业的海事知识消化引擎。请仔细分析以下关于"${topic}"的数据，生成结构化的知识摘要。

## 任务要求
1. 提取最关键的事实信息，用简洁的中文写3-5条
2. 识别数据的主题和范围
3. 如果有明显矛盾或异常数据点，标注出来

## 输出格式（JSON）
{
  "summary": "2-3段的摘要文本，覆盖所有重要信息点，markdown格式",
  "key_facts": ["事实1: 具体内容", "事实2: 具体内容", ...],
  "data_quality_notes": "数据质量评价（如有异常、缺失、矛盾）"
}`;
  
  if (isConflictCheck) {
    prompt += `\n\n## 冲突检测
以下是从现有记忆库中找到的关于同一主题的已有摘要，请对比新数据和旧数据，判断是否存在矛盾或过时信息：

已有知识:
${existingEntries.map(e => `--- 来源: ${e.source_file} ---\n${e.summary}`).join('\n\n')}

请仔细对比新数据和已有知识，如果发现冲突，在输出中添加：
"conflicts": [
  {"field": "冲突字段名", "old": "旧值", "new": "新值", "assessment": "你认为哪个更可信"}
]`;
  }
  
  prompt += `\n\n## 待消化数据\n\`\`\`\n${data.slice(0, 8000)}\n\`\`\``;
  
  // Call DeepSeek
  const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deepseekKey}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: '你是一个数据消化引擎。只输出JSON，不输出任何其他内容。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 4096,
      stream: false
    })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek digestion failed: ${err}`);
  }
  
  const result = await response.json();
  const content = result.choices[0].message.content;
  
  // Parse JSON from response (handle possible markdown fences)
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    // Try extracting from markdown code block
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      parsed = JSON.parse(match[1]);
    } else {
      throw new Error(`Failed to parse digestion output: ${content.slice(0, 200)}`);
    }
  }
  
  return {
    summary: parsed.summary || '',
    keyFacts: JSON.stringify(parsed.key_facts || []),
    hasConflict: !!(parsed.conflicts && parsed.conflicts.length > 0) ? 1 : 0,
    conflictIds: isConflictCheck ? JSON.stringify(existingEntries.map(e => e.id)) : '[]',
    conflictNote: parsed.conflicts 
      ? parsed.conflicts.map(c => `${c.field}: 旧值"${c.old}", 新值"${c.new}" - ${c.assessment}`).join('; ')
      : ''
  };
}

/**
 * Save a memory entry to D1.
 */
export async function saveMemory(db, entry) {
  if (!db) throw new Error('D1 database binding required');
  
  const { sourceFile, sourceUpdatedAt, sourceType, topic, topicType, 
          summary, keyFacts, hasConflict, conflictIds, conflictNote, rawDataSample } = entry;
  
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO memory_entries 
     (source_file, source_updated_at, source_type, topic, topic_type, 
      summary, key_facts, has_conflict, conflict_ids, conflict_note, raw_data_sample)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  
  return await stmt.bind(
    sourceFile, sourceUpdatedAt || null, sourceType || 'json',
    topic, topicType, summary, keyFacts, hasConflict || 0,
    conflictIds || '[]', conflictNote || null, rawDataSample || null
  ).run();
}

/**
 * Update source tracking after successful digestion.
 */
export async function updateSourceTracking(db, filePath, fileSize, hash, docCount) {
  if (!db) return;
  
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO source_tracking 
     (file_path, last_digested_at, file_size, hash, doc_count)
     VALUES (?, datetime('now'), ?, ?, ?)`
  );
  
  return await stmt.bind(filePath, fileSize || 0, hash || '', docCount || 0).run();
}

/**
 * Get source tracking info for a file.
 */
export async function getSourceTracking(db, filePath) {
  if (!db) return null;
  
  const stmt = db.prepare('SELECT * FROM source_tracking WHERE file_path = ?');
  const { results } = await stmt.bind(filePath).all();
  return results.length > 0 ? results[0] : null;
}

/**
 * Log a query for analytics.
 */
export async function logQuery(db, entry) {
  if (!db) return;
  
  const stmt = db.prepare(
    `INSERT INTO query_log (timestamp, module, question, memory_topics_used, memory_count)
     VALUES (datetime('now'), ?, ?, ?, ?)`
  );
  
  return await stmt.bind(
    entry.module,
    (entry.question || '').slice(0, 500),
    JSON.stringify(entry.topics || []),
    entry.count || 0
  ).run();
}

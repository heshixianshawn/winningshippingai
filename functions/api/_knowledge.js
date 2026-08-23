// WINNING Shipping AI - 知识库搜索模块
// 从 CF Pages 静态资源加载 ship_knowledge.json 和 tech_index.json

let shipKnowledge = null;
let techIndex = null;
let kbLoadAttempted = false;

/** 获取 Pages 部署URL */
function getPagesUrl(request) {
  // Pages Function 可以通过 request 获取原始域名
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** 加载船舶知识库 */
async function ensureShipKnowledge(request) {
  if (shipKnowledge) return shipKnowledge;
  if (kbLoadAttempted) return null; // 已经尝试过但失败了
  kbLoadAttempted = true;
  
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/ship_knowledge.json`);
    if (resp.ok) {
      shipKnowledge = await resp.json();
      return shipKnowledge;
    }
  } catch (e) {
    console.error('Failed to load ship_knowledge.json:', e.message);
  }
  return null;
}

/** 加载技术知识库 */
async function ensureTechIndex(request) {
  if (techIndex) return techIndex;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/tech_index.json`);
    if (resp.ok) {
      techIndex = await resp.json();
      return techIndex;
    }
  } catch (e) {
    console.error('Failed to load tech_index.json:', e.message);
  }
  return null;
}

/** 获取证书显示名：处理字符串或对象两种格式 */
function getCertName(cert) {
  if (typeof cert === 'string') return cert;
  if (typeof cert === 'object' && cert !== null) return cert.cert || cert.name || '(未分类)';
  return '(未分类)';
}

/** 获取证书到期日：只对对象格式有效 */
function getCertExpiry(cert) {
  if (typeof cert === 'object' && cert !== null) return cert.expiry || '';
  return '';
}

/** 获取证书文件名：只对对象格式有效 */
function getCertFile(cert) {
  if (typeof cert === 'object' && cert !== null) return cert.file || '';
  return '';
}

/** 搜索船舶知识库 */
function searchShipKnowledge(kb, query) {
  if (!kb || !kb.ships) return '';
  const q = query.toLowerCase().trim();
  const results = [];

  // 先精确匹配船名（忽略大小写）
  const matchedShip = kb.ships.find(s => {
    const sn = s.name.toLowerCase().trim();
    return sn === q || sn.includes(q) || q.includes(sn);
  });
  if (matchedShip) {
    let ctx = `【船舶知识库 - ${matchedShip.name}】\n`;
    for (const cert of matchedShip.certs.slice(0, 30)) {
      const certName = getCertName(cert);
      ctx += `- 证书: ${certName}\n`;
    }
    results.push(ctx);
  }

  // 关键字匹配更多船舶
  for (const ship of kb.ships) {
    if (matchedShip && ship.name === matchedShip.name) continue;
    const sn = ship.name.toLowerCase().trim();
    const lastName = sn.split(' ').pop();
    const shipMatch = sn.includes(q) || q.includes(sn) || q.includes(lastName);
    const certMatch = ship.certs.some(c => {
      const cn = getCertName(c).toLowerCase();
      const ex = getCertExpiry(c).toLowerCase();
      return cn.includes(q) || ex.includes(q);
    });
    if (certMatch || shipMatch) {
      let ctx = `【船舶知识库 - ${ship.name}】\n`;
      for (const cert of ship.certs.slice(0, 15)) {
        ctx += `- 证书: ${getCertName(cert)}\n`;
      }
      results.push(ctx);
      if (results.length >= 15) break;
    }
  }

  return results.flat().join('\n');
}

/** 搜索技术知识库（v2: 兼容 keyword_map/device_shards 格式） */
export function searchTechIndex(ti, query) {
  if (!ti) return '';
  const q = query.toLowerCase();
  const results = [];

  // v1 格式：devices 列表
  if (Array.isArray(ti.devices)) {
    for (const dev of ti.devices) {
      const nameMatch = (dev.name || '').toLowerCase().includes(q) || (dev.category || '').toLowerCase().includes(q);
      const kwMatch = (dev.keywords || []).some(k => k.toLowerCase().includes(q));
      if (nameMatch || kwMatch) {
        results.push(`【技术知识库 - ${dev.name || '未命名'}】(分类: ${dev.category || '未分类'})\n描述: ${(dev.description || '').slice(0, 200)}\n知识条目数: ${(dev.shard_count || (dev.files ? dev.files.length : '?'))}`);
        if (results.length >= 10) break;
      }
    }
    return results.join('\n');
  }

  // v2 格式：keyword_map → device_shards
  const km = ti.keyword_map || {};
  const shards = ti.device_shards || {};
  const matchedDevices = new Set();
  // 1. keyword_map 精确命中
  for (const kw in km) {
    if (q.includes(kw.toLowerCase())) matchedDevices.add(km[kw]);
  }
  // 2. word_index 单分片命中
  const wi = ti.word_index || {};
  for (const w in wi) {
    if (q.includes(w.toLowerCase()) && Array.isArray(wi[w]) && wi[w].length === 1) {
      matchedDevices.add(wi[w][0]);
    }
  }
  // 3. 分片名直接匹配（如“主机”“锅炉”）
  for (const dev in shards) {
    if (dev.toLowerCase().includes(q) || q.includes(dev.toLowerCase())) matchedDevices.add(dev);
  }
  for (const dev of matchedDevices) {
    const info = shards[dev];
    results.push(`【技术知识库 - ${dev}】\n文档数: ${info ? (info.count || '?') : '?'}\n分片大小: ${info ? Math.round((info.size || 0) / 1024) + ' KB' : '?'}\n提示: 前端已加载该分片检索具体文档，此处为后端索引摘要。`);
    if (results.length >= 10) break;
  }
  return results.join('\n');
}

/** 自动搜索知识库（入口函数） */
export async function autoSearchKnowledge(module, message, request) {
  switch (module) {
    case 'ships': {
      const kb = await ensureShipKnowledge(request);
      return kb ? searchShipKnowledge(kb, message) : '';
    }
    case 'tech': {
      const ti = await ensureTechIndex(request);
      return ti ? searchTechIndex(ti, message) : '';
    }
    case 'systems': {
      return await searchSystemsKnowledge(request, message);
    }
    case 'regulations': {
      return await searchRegulationsKnowledge(request, message);
    }
    default:
      return '';
  }
}

/** 重置知识库缓存（用于调试） */
export function resetKbCache() {
  shipKnowledge = null;
  techIndex = null;
  kbLoadAttempted = false;
}

// ═══════════════ 体系知识库检索（2026-08-23 新增） ═══════════════
let systemsIndex = null;
let systemsShards = null;

async function ensureSystemsIndex(request) {
  if (systemsIndex) return systemsIndex;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/systems_index.json`);
    if (resp.ok) systemsIndex = await resp.json();
  } catch (e) {
    console.error('Failed to load systems_index.json:', e.message);
  }
  return systemsIndex;
}

/** 检索体系知识库：关键词命中分片，返回命中分片的标题+内容片段 */
export async function searchSystemsKnowledge(request, query) {
  const index = await ensureSystemsIndex(request);
  if (!index) return '';
  const q = query.toLowerCase();
  const qCn = query.replace(/[^\u4e00-\u9fff]/g, '');
  const km = index.keyword_map || {};
  const shards = index.shard_files || {};

  // 1. 关键词命中（英文词 + 中文词）
  const hitIds = new Set();
  const hits = [];
  // 中文：query 中的 2-4 字片段
  if (qCn.length >= 2) {
    const grams = new Set();
    for (let n = 2; n <= Math.min(4, qCn.length); n++) {
      for (let i = 0; i + n <= qCn.length; i++) grams.add(qCn.substring(i, i + n));
    }
    for (const g of grams) {
      if (km[g]) for (const sid of km[g]) hitIds.add(sid);
    }
  }
  // 英文单词
  const enWords = q.toLowerCase().match(/[a-z][a-z\-]{2,}/g) || [];
  for (const w of enWords) {
    if (km[w]) for (const sid of km[w]) hitIds.add(sid);
  }

  if (hitIds.size === 0) return '';

  // 2. 按命中数排序
  const scored = [...hitIds].map(id => ({ id, score: 0 }));
  for (const g of (qCn.length >= 2 ? Array.from(new Set((() => { const s = new Set(); for (let n = 2; n <= Math.min(4, qCn.length); n++) for (let i = 0; i + n <= qCn.length; i++) s.add(qCn.substring(i, i + n)); return s; })())) : [])) {
    if (km[g] && km[g].includes) for (const sid of km[g]) { const t = scored.find(x => x.id === sid); if (t) t.score += 2; }
  }
  for (const w of enWords) {
    if (km[w]) for (const sid of km[w]) { const t = scored.find(x => x.id === sid); if (t) t.score += 1; }
  }
  scored.sort((a, b) => b.score - a.score);

  // 3. 取 top 3 分片内容（从分片文件加载）
  const topIds = scored.slice(0, 3).map(x => x.id);
  const shardName = id => id.split('_')[0] + '_' + (MANUAL_EN_BY_CODE[id.split('_')[0]] || '');
  // 简化：直接按 id 前缀找分片文件
  const MANUAL_EN_BY_CODE = { '01': 'SAFETY_MANAGEMENT_MANUAL', '02': 'PROCEDURE_MANUAL', '03': 'SHOREBASE_INSTRUCTION_MANUAL', '04': 'SHIPBOARD_MANUAL', '05': 'CONTINGENCY_PLAN', '06': 'ENERGY_EFFICIENCY_MANAGEMENT_MANUAL', '07': 'MARITIME_LABOUR_MANAGEMENT_MANUAL' };
  const needShards = new Set(topIds.map(id => MANUAL_EN_BY_CODE[id.split('_')[0]]));
  if (!systemsShards) systemsShards = {};
  for (const sn of needShards) {
    if (!systemsShards[sn]) {
      try {
        const baseUrl = getPagesUrl(request);
        const resp = await fetch(`${baseUrl}/data/systems_shards/${sn}.json`);
        if (resp.ok) systemsShards[sn] = await resp.json();
      } catch (e) { console.error('shard load fail:', sn, e.message); }
    }
  }

  const out = [];
  for (const id of topIds) {
    const code = id.split('_')[0];
    const sn = MANUAL_EN_BY_CODE[code];
    const sec = systemsShards[sn] && systemsShards[sn][id];
    if (!sec) continue;
    const text = (sec.text || '').slice(0, 1500);
    out.push(`【${sec.manual}·${sec.chapter}】\n${text}`);
  }
  return out.length ? '【公司体系知识库检索结果】\n\n' + out.join('\n\n---\n\n') : '';
}

// ═══════════════ 法规知识库检索（SOLAS 2024，2026-08-23 新增） ═══════════════
let regsIndex = null;
let regsShards = {};

async function ensureRegsIndex(request) {
  if (regsIndex) return regsIndex;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/regulations_index.json`);
    if (resp.ok) regsIndex = await resp.json();
  } catch (e) {
    console.error('Failed to load regulations_index.json:', e.message);
  }
  return regsIndex;
}

/** 检索 SOLAS 法规知识库：关键词 → Regulation 分片命中 */
export async function searchRegulationsKnowledge(request, query) {
  const index = await ensureRegsIndex(request);
  if (!index) return '';
  const km = index.keyword_map || {};
  const q = query.toLowerCase();
  const qCn = query.replace(/[^\u4e00-\u9fff]/g, '');

  const hitIds = new Set();
  // 英文关键词命中（法规条文关键词多为英文）
  const enWords = q.toLowerCase().match(/[a-z][a-z\-]{2,}/g) || [];
  for (const w of enWords) {
    if (km[w]) for (const sid of km[w]) hitIds.add(sid);
  }
  // 中文：用户可能用中文问（如"防火"），索引里无中文关键词，跳过

  if (hitIds.size === 0) return '';

  // 计分：命中词数
  const score = {};
  for (const sid of hitIds) score[sid] = 0;
  for (const w of enWords) {
    if (km[w]) for (const sid of km[w]) score[sid] = (score[sid] || 0) + 1;
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);

  // 加载分片
  const needChapters = new Set(ranked.map(id => id.split('_')[0]));
  for (const ch of needChapters) {
    if (!regsShards[ch]) {
      try {
        const baseUrl = getPagesUrl(request);
        const resp = await fetch(`${baseUrl}/data/regulations_shards/chapter_${ch}.json`);
        if (resp.ok) regsShards[ch] = await resp.json();
      } catch (e) { console.error('regs shard fail:', ch, e.message); }
    }
  }

  const out = [];
  for (const id of ranked) {
    const ch = id.split('_')[0];
    const sec = regsShards[ch] && regsShards[ch][id];
    if (!sec) continue;
    const text = (sec.text || '').slice(0, 2000);
    out.push(`【SOLAS ${sec.chapter} ${sec.reg ? 'Reg.' + sec.reg : ''}${sec.title ? ' - ' + sec.title : ''}】\n${text}`);
  }
  return out.length ? '【SOLAS 2024 法规原文检索结果】\n\n' + out.join('\n\n---\n\n') : '';
}

// ═══════════════ IMO 官方公约检索（2026-08-23 新增） ═══════════════
let imoConvs = null;

async function ensureImoConventions(request) {
  if (imoConvs) return imoConvs;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/imo_conventions.json`);
    if (resp.ok) imoConvs = await resp.json();
  } catch (e) {
    console.error('Failed to load imo_conventions.json:', e.message);
  }
  return imoConvs;
}

const CONV_ALIASES = {
  'solas': ['solas', 'safety of life at sea'],
  'marpol': ['marpol', 'prevention of pollution from ships'],
  'stcw': ['stcw', 'standards of training', 'watchkeeping'],
  'colreg': ['colreg', 'collision'],
  'load line': ['load line', 'loadlines'],
  'bwm': ['ballast water', 'bwm'],
  'afs': ['anti-fouling', 'afs'],
  'mlc': ['maritime labour'],
  'tonnage': ['tonnage'],
  'salvage': ['salvage'],
  'wrecks': ['wrecks', 'removal of wrecks'],
  'bunker': ['bunker oil'],
  'hns': ['hazardous and noxious', 'hns'],
  'csc': ['safe containers', 'csc'],
  'sfv': ['fishing vessels'],
  'sar': ['search and rescue', 'sar'],
  'crc': ['recycling of ships', 'hong kong'],
};

/** 按查询匹配 IMO 公约 → 返回官方链接+摘要 */
export async function searchImoConventions(request, query) {
  const data = await ensureImoConventions(request);
  if (!data || !data.conventions) return '';
  const q = query.toLowerCase();
  const qn = q.replace(/[^\u4e00-\u9fff]/g, '');
  // 中文→英文映射（常见法规中文关键词）
  const CN_MAP = {
    '压载水': 'ballast water', '救生': 'life', '消防': 'fire', '生活污水': 'sewage',
    '油污': 'oil pollution', '垃圾': 'garbage', '防污底': 'anti-fouling', '防污': 'pollution',
    '劳工': 'labour', '配员': 'crew', '载重线': 'load line', '碰撞': 'collision',
    '危险货物': 'dangerous', '拆船': 'recycling', '沉船': 'wrecks', '海难救助': 'salvage',
    '吨位': 'tonnage', '安全': 'safety', '培训': 'training', '保安': 'security'
  };
  let qEn = q;
  for (const cn in CN_MAP) {
    if (qn.includes(cn)) qEn += ' ' + CN_MAP[cn];
  }

  const matched = [];
  for (const name in data.conventions) {
    const c = data.conventions[name];
    const nameLower = name.toLowerCase();
    let hit = false;
    for (const aliasList of Object.values(CONV_ALIASES)) {
      if (aliasList.some(a => qEn.includes(a))) {
        if (aliasList.some(a => nameLower.includes(a))) { hit = true; break; }
      }
    }
    if (!hit) {
      // 直接名称包含匹配
      const words = qEn.match(/[a-z][a-z\-]{2,}/g) || [];
      if (words.some(w => w.length > 3 && nameLower.includes(w))) hit = true;
    }
    if (hit) {
      matched.push({ name, url: c.url, summary: (c.summary || '').slice(0, 600) });
    }
  }

  if (matched.length === 0) return '';
  const lines = matched.slice(0, 3).map(c =>
    `### ${c.name}\n官方原文: ${c.url}\n概述: ${c.summary || '（见IMO官网）'}`
  );
  return '【IMO 官方公约信息（来源：imo.org）】\n\n' + lines.join('\n\n');
}

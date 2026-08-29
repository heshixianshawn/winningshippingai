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

  // ═══ 中文→英文关键词映射（2026-08-23 新增：解决中文提问无法命中英文索引导致 AI 编造） ═══
// 中文→英文关键词映射（模块级，供法规检索共用）
const CN_TO_EN = {
    '救生艇': ['lifeboat', 'rescue boat'], '救生筏': ['life raft', 'liferaft'], '脱钩': ['release gear', 'release mechanism', 'on-load', 'release hook', 'release'],
    '释放': ['release', 'launch', 'lowering'], '降落': ['lowering', 'launch', 'davit'], '吊架': ['davit'],
    '消防': ['fire'], '防火': ['fire'], '灭火': ['fire extinguishing', 'fire extinguisher'], '消防泵': ['fire', 'pump'],
    '压载水': ['ballast'], '压载': ['ballast'], '油水分离': ['oily'], '含油': ['oily'],
    '报警': ['alarm'], '应急': ['emergency'], '逃生': ['escape'], '无线电': ['radio'], '航行灯': ['navigation light'],
    '锚': ['anchor'], '舵': ['steering'], '主机': ['main engine', 'propulsion'], '发电机': ['generator'],
    '水密': ['watertight'], '通风': ['ventilation'], '货舱': ['cargo hold'],
    '检验': ['survey'], '特检': ['special survey'], '坞检': ['docking', 'dry dock'], '年度': ['annual'], '中间': ['intermediate'],
    '证书': ['certificate'], '有效期': ['validity', 'expiry'], '记录': ['record', 'log'],
    '训练': ['drill', 'training'], '演练': ['drill'], '每月': ['monthly'], '每周': ['weekly'], '每季': ['quarterly'],
    '五年': ['5 year', 'five year'], '排放': ['discharge'], '生活污水': ['sewage'], '垃圾': ['garbage'],
    '硫': ['sulphur', 'sulfur'], '能效': ['energy efficiency', 'eedi', 'eexi', 'cii'], '救生衣': ['lifejacket'],
    '保温服': ['immersion suit'], '雷达': ['radar'], '甚高频': ['vhf'], '航行安全': ['navigation'], '操舵': ['steering'],
    '烟火': ['pyrotechnic'], '雷达应答': ['sart'], '双向': ['two-way'], '通风筒': ['ventilator'], '舱口': ['hatch'],
    '防火控制': ['fire control'], '应急照明': ['emergency lighting'], '应急电源': ['emergency power'], '断电': ['blackout'],
    '机舱': ['machinery space', 'engine room'], '泵': ['pump'], '管系': ['piping'], '阀门': ['valve'],
    '稳性': ['stability'], '吃水': ['draft', 'draught'], '吨位': ['tonnage'], '干舷': ['freeboard'],
    '载重线': ['load', 'line'], '防污': ['pollution'], '压舱水': ['ballast']
};

  const hitIds = new Set();
  // 英文关键词命中（法规条文关键词多为英文）
  const enWords = q.toLowerCase().match(/[a-z][a-z\-]{2,}/g) || [];
  for (const w of enWords) {
    if (km[w]) for (const sid of km[w]) hitIds.add(sid);
  }
  // 中文 → 英文映射命中
  for (const cn in CN_TO_EN) {
    if (!qCn.includes(cn)) continue;
    for (const en of CN_TO_EN[cn]) {
      if (km[en]) for (const sid of km[en]) hitIds.add(sid);
    }
  }

  if (hitIds.size === 0) return '';

  // 计分：命中词数
  const score = {};
  for (const sid of hitIds) score[sid] = 0;
  for (const w of enWords) {
    if (km[w]) for (const sid of km[w]) score[sid] = (score[sid] || 0) + 1;
  }
  for (const cn in CN_TO_EN) {
    if (!qCn.includes(cn)) continue;
    for (const en of CN_TO_EN[cn]) {
      if (km[en]) for (const sid of km[en]) score[sid] = (score[sid] || 0) + 1;
    }
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x[0]);

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

// ═══════════════ 官方源索引检索（船旗国/船级社/海事局，2026-08-23 新增） ═══════════════
let officialSources = null;

async function ensureOfficialSources(request) {
  if (officialSources) return officialSources;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/official_sources.json`);
    if (resp.ok) officialSources = await resp.json();
  } catch (e) {
    console.error('Failed to load official_sources.json:', e.message);
  }
  return officialSources;
}

/** 按查询匹配官方源 → 返回官方链接清单（供 AI 附原文支持） */
export async function searchOfficialSources(request, query) {
  const data = await ensureOfficialSources(request);
  if (!data) return '';
  const q = query.toLowerCase();
  const qn = query.replace(/[^\u4e00-\u9fff]/g, '');

  const KEYWORDS = {
    'flag_states': {
      '新加坡': ['singapore', 'mpa', '新加坡', 'srs'],
      '巴拿马': ['panama', 'amp', '巴拿马'],
      '利比里亚': ['liberia', 'liscr', '利比里亚']
    },
    'class_societies': {
      'NK': ['nk', 'classnk', '日本海事', 'nk船级'],
      'CCS': ['ccs', '中国船级', 'ccs船级'],
      'KR': ['kr', 'krs', '韩国船级', 'kr船级'],
      'ABS': ['abs', '美国船级', 'abs船级'],
      'DNV': ['dnv', '挪威船级', 'dnv船级'],
      'BV': ['bv', '法国船级', 'bv船级'],
      'RINA': ['rina', '意大利船级', 'rina船级']
    },
    'china': {
      '海事局': ['海事局', '中国海事', 'msa', '交通运输部']
    },
    'industry': {
      'RightShip': ['rightship', 'right ship'],
      'TokyoMoU': ['tokyo mou', '东京备忘录', 'apcis', '港口国']
    }
  };

  const matched = [];
  for (const cat in KEYWORDS) {
    for (const name in KEYWORDS[cat]) {
      const kws = KEYWORDS[cat][name];
      if (kws.some(k => q.includes(k) || qn.includes(k))) {
        const src = data[cat] && data[cat][name];
        if (src && src.urls) {
          const links = src.urls.map(u => `- ${u.title}：<${u.url}>`).join('\n');
          matched.push(`### ${src.name}\n${links}`);
        }
      }
    }
  }
  return matched.length ? '【官方来源（供原文核对）】\n\n' + matched.join('\n\n') : '';
}

// ═══════════════ PSC 高频速查库检索（2026-08-23 新增，人工精编防编造） ═══════════════
let quickRef = null;

async function ensureQuickRef(request) {
  if (quickRef) return quickRef;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/psc_quick_ref.json`);
    if (resp.ok) quickRef = await resp.json();
  } catch (e) { console.error('Failed to load psc_quick_ref:', e.message); }
  return quickRef;
}

/** 按关键词匹配速查条目 → 返回速查内容（有出处，防 AI 编造） */
export async function searchQuickRef(request, query) {
  const data = await ensureQuickRef(request);
  if (!data || !data.items) return '';
  const q = query.toLowerCase();
  const qCn = query.replace(/[^\u4e00-\u9fff]/g, '');
  const hits = data.items.filter(it =>
    it.keywords.some(k => q.includes(k.toLowerCase()) || (qCn && qCn.includes(k)))
  );
  if (hits.length === 0) return '';
  const out = hits.map(it =>
    `【速查：${it.question}】（来源：${it.source}）\n${it.answer}\n📖 官方原文：<${it.official_url}>`
  ).join('\n\n---\n\n');
  return '【PSC 高频速查（权威依据，引用此内容作答）】\n\n' + out;
}

// ═══════════════ 多公约法规知识库检索（MARPOL/MLC/ISM/LSA/FSS/BWM，2026-08-23 新增） ═══════════════
let regsAllIndex = null;
let regsAllShards = null;

async function ensureRegsAll(request) {
  if (regsAllIndex && regsAllShards) return true;
  try {
    const baseUrl = getPagesUrl(request);
    // 2026-08-29：加 8s 超时保护——线上冷启动回源可达30s+，防止拖垮整个响应
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('fetch timeout')), ms))]);
    const [r1, r2] = await Promise.all([
      withTimeout(fetch(`${baseUrl}/data/regs_all_index.json`), 8000),
      withTimeout(fetch(`${baseUrl}/data/regs_all_shards.json`), 8000)
    ]);
    if (r1.ok && r2.ok) {
      regsAllIndex = await r1.json();
      regsAllShards = await r2.json();
      return true;
    }
  } catch (e) { console.error('regs_all load fail:', e.message); }
  return false;
}

/** 多公约法规检索（MARPOL/MLC/ISM/LSA/FSS/BWM/SOLAS补充），英文词 + 中文映射 */
export async function searchRegsAllKnowledge(request, query) {
  if (!(await ensureRegsAll(request))) return '';
  const km = regsAllIndex.keyword_map || {};
  const q = query.toLowerCase();
  const qCn = query.replace(/[^\u4e00-\u9fff]/g, '');

  const hitIds = new Set();
  const enWords = q.toLowerCase().match(/[a-z][a-z\-]{2,}/g) || [];
  for (const w of enWords) if (km[w]) for (const sid of km[w]) hitIds.add(sid);
  for (const cn in CN_TO_EN) {
    if (!qCn.includes(cn)) continue;
    for (const en of CN_TO_EN[cn]) if (km[en]) for (const sid of km[en]) hitIds.add(sid);
  }
  if (hitIds.size === 0) return '';

  const score = {};
  for (const sid of hitIds) score[sid] = 0;
  for (const w of enWords) if (km[w]) for (const sid of km[w]) score[sid] = (score[sid] || 0) + 1;
  for (const cn in CN_TO_EN) {
    if (!qCn.includes(cn)) continue;
    for (const en of CN_TO_EN[cn]) if (km[en]) for (const sid of km[en]) score[sid] = (score[sid] || 0) + 1;
  }
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
  const out = [];
  for (const sid of ranked) {
    const s = regsAllShards[sid];
    if (!s) continue;
    out.push(`【${s.title}】\n${(s.text || '').slice(0, 1800)}`);
  }
  return out.length ? '【MARPOL/MLC/ISM/LSA 等公约原文检索结果】\n\n' + out.join('\n\n---\n\n') : '';
}

// ═══════════════ PSC 检查前准备清单（2026-08-23 新增） ═══════════════
let fleetParams = null;

async function ensureFleetParams(request) {
  if (fleetParams) return fleetParams;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/fleet_params.json`);
    if (resp.ok) fleetParams = await resp.json();
  } catch (e) { console.error('fleet_params load fail:', e.message); }
  return fleetParams;
}

let pscRisk = null;
async function ensurePscRisk(request) {
  if (pscRisk) return pscRisk;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/psc_risk.json`);
    if (resp.ok) pscRisk = await resp.json();
  } catch (e) { console.error('psc_risk load fail:', e.message); }
  return pscRisk;
}

/** 识别 message 中的船名 → IMO 或 null */
async function detectShipInMessage(request, message) {
  const fp = await ensureFleetParams(request);
  if (!fp || !fp.ships) return null;
  const q = message.toUpperCase();
  for (const [imo, s] of Object.entries(fp.ships)) {
    const names = [s.name_en, s.name_cn, s.name_full, s.imo].filter(Boolean);
    if (names.some(n => n && q.includes(String(n).toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 12)))) {
      return { imo, ship: s };
    }
  }
  // 简化匹配：按 name_en 前 2-3 个词
  for (const [imo, s] of Object.entries(fp.ships)) {
    const en = String(s.name_en || '').toUpperCase();
    const enShort = en.replace(/[^A-Z0-9]/g, '');
    if (enShort.length >= 6 && q.replace(/[^A-Z0-9]/g, '').includes(enShort)) {
      return { imo, ship: s };
    }
  }
  return null;
}

/** 构建 PSC 检查前准备清单 context */
export async function buildPscPrepChecklist(request, message) {
  const det = await detectShipInMessage(request, message);
  if (!det) return '';
  const { imo, ship } = det;
  const parts = [];
  const name = ship.name_en || imo;

  // 1. 船舶参数
  parts.push(`【船舶】${name}（${ship.name_cn || ''}）| 船旗:${ship.flag || '?'} | 船级社:${ship.class_notation || '?'} | 建造:${ship.built || '?'} | IMO:${imo}${ship.gt ? ' | GT:' + ship.gt : ''}${ship.dwt ? ' | DWT:' + ship.dwt : ''}`);

  // 2. PSC 风险档案
  const pr = await ensurePscRisk(request);
  if (pr && pr.ships) {
    const risk = pr.ships[name] || pr.ships[imo];
    if (risk) {
      parts.push(`【PSC风险】等级:${risk.risk_level} | 优先级:${risk.priority} | 检查窗口:${risk.inspection_window || 'N/A'} | 加权分:${risk.weighting_points}`);
      const last = (risk.inspections || [])[0];
      if (last) {
        parts.push(`【最近PSC】${last.date} @ ${last.place} | 缺陷:${last.deficiencies || 0}项 | 滞留:${last.detention || 'no'} | 风险:${last.risk_at_inspection || '?'}`);
      }
      // 历史缺陷分类
      const defects = {};
      (risk.inspections || []).forEach(ins => {
        const d = ins.defects_list || ins.deficiencies_list || [];
        if (Array.isArray(d)) d.forEach(x => { const cat = typeof x === 'string' ? x : (x.category || x.type || '其他'); defects[cat] = (defects[cat] || 0) + 1; });
      });
      if (Object.keys(defects).length) {
        parts.push(`【历史缺陷分布】${Object.entries(defects).map(([k, v]) => `${k}:${v}`).join(' | ')}`);
      }
    }
  }

  // 3. 高频速查（救生/消防/油水分离等）
  const quick = await searchQuickRef(request, message + ' 救生艇 消防 演习');
  if (quick) parts.push(quick.substring(0, 1500));

  return parts.join('\n\n');
}

// ═══════════════ IMO 法规动态检索（2026-08-23 新增，月度抓取） ═══════════════
let imoUpdates = null;
async function ensureImoUpdates(request) {
  if (imoUpdates) return imoUpdates;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/imo_updates.json`);
    if (resp.ok) imoUpdates = await resp.json();
  } catch (e) { console.error('imo_updates load fail:', e.message); }
  return imoUpdates;
}

/** 按关键词匹配最新会议动态 → 返回法规变更信息 */
export async function searchImoUpdates(request, query) {
  const data = await ensureImoUpdates(request);
  if (!data || !data.committees) return '';
  const q = query.toLowerCase();
  const qCn = query.replace(/[^\u4e00-\u9fff]/g, '');
  // 关键词映射：中文问题 → 会议要点匹配
  const KW = {
    '压载水': ['ballast'], '排放控制区': ['emission control', 'eca'], 'ghg': ['ghg', 'greenhouse'],
    '碳': ['carbon'], 'mepc': ['mepc'], 'msc': ['msc'], '修正案': ['amendment'], '新规': ['amendment', 'new requirement'],
    'mas': ['mass code', 'autonomous'], '自主': ['autonomous'], '安全': ['safety'], '能效': ['energy efficiency'],
    '防污': ['pollution'], '船舶回收': ['recycling'], '网络安全': ['cyber']
  };
  const hitItems = [];
  for (const [label, items] of Object.entries(data.committees)) {
    for (const it of items) {
      const text = (it.key_points || []).join(' ').toLowerCase();
      const matched = Object.entries(KW).some(([cn, ens]) =>
        (qCn.includes(cn) || q.includes(cn.toLowerCase())) && ens.some(e => text.includes(e))
      ) || Object.entries(KW).some(([cn, ens]) =>
        (qCn.includes(cn) || q.includes(cn.toLowerCase())) && ens.some(e => (it.meeting + ' ' + it.date).toLowerCase().includes(e))
      );
      if (matched) hitItems.push(it);
    }
  }
  if (hitItems.length === 0) {
    // 兜底：问题含"最新/动态/修正案"时返回最新会议
    const latest = Object.values(data.committees).flatMap(x => x).slice(0, 2);
    if (/最新|动态|法规变化|修正案|updates?|latest/i.test(query)) hitItems.push(...latest);
  }
  if (hitItems.length === 0) return '';
  const out = hitItems.slice(0, 3).map(it => {
    const pts = (it.key_points || []).slice(0, 4).map(p => '- ' + p).join('\n');
    return `【${it.meeting}】（${it.date}）\n${pts}\n📖 会议摘要：<${it.url}>`;
  }).join('\n\n---\n\n');
  return '【IMO 最新法规动态（会议结果）】\n\n' + out;
}

// ═══════════════ PSC 缺陷→法规条款匹配（2026-08-29 新增） ═══════════════
// 从上传的 PSC 报告中提取缺陷（编号+描述），逐条检索法规原文，注入上下文供模型引用（防编造条款号）
// v3：静态映射表（psc_defect_regs.json）优先 → 速查库 → 公约分片检索
let pscDefectRegs = null;

async function ensurePscDefectRegs(request) {
  if (pscDefectRegs) return pscDefectRegs;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/psc_defect_regs.json`);
    if (resp.ok) pscDefectRegs = await resp.json();
  } catch (e) { console.error('psc_defect_regs load fail:', e.message); }
  return pscDefectRegs;
}
const DEFECT_SKIP = new Set(['the','and','for','with','from','that','this','have','has','was','were','not','are','its','his','her','she','all','any','but','can','had','out','per','via','etc','shall','must','ship','vessel','found','failed','failure','due','during','after','before','over','under','into','onto','one','two','new','old','type','code','item','area','part','set','date','number','description','details','action','taken','yes','no','see','attached','form','page','signature','inspection','report','authority','name','master','company']);

/** 提取 PSC 报告文本中的缺陷行。v3：
 *  通道A：编号(4-5位)+大写描述（干净文本）
 *  通道B：FORM B 区域内纯描述行（OCR编号乱码时，按大写短语拼接描述）
 */
export function extractDefectLines(message) {
  const defects = [];
  const lines = String(message || '').split('\n');
  const reA = /(\d{4,5})\s+([A-Z][A-Z0-9 ,\-()/'.:]{25,300})/;
  for (const line of lines) {
    const m = reA.exec(line);
    if (m) {
      const desc = m[2].replace(/\s+/g, ' ').trim();
      if (desc.length >= 25 && !defects.some(d => d.code === m[1])) {
        defects.push({ code: m[1], desc: desc.slice(0, 200) });
        if (defects.length >= 8) break;
        continue;
      }
    }
    // 通道B：行内含≥2个大写短语且总长≥40 → 视为缺陷描述（编号可能被OCR打乱）
    if (defects.length >= 8) break;
    const phrases = (line.match(/[A-Z][A-Z0-9 ,\-()/'.:]{15,}/g) || []);
    if (phrases.length >= 2) {
      const joined = phrases.join(' ').replace(/\s+/g, ' ').trim();
      if (joined.length >= 40 && joined.length <= 300) {
        // 避免把 Form A 表格行（如证书列表）当缺陷：要求含常见缺陷动词/名词
        if (/FOUND|BROKEN|NOT|FAIL|LEAK|OUT OF|DEFECT|CORROD|DAMAGE|MISSING|INOP|DID NOT|CANNOT|UNABLE/i.test(joined)) {
          if (!defects.some(d => d.desc === joined.slice(0, 200))) {
            defects.push({ code: '???', desc: joined.slice(0, 200) });
          }
        }
      }
    }
  }
  return defects;
}

/**
 * 对 PSC 缺陷逐条检索法规原文（速查库 → 公约原文分片），返回**后端硬附加**的条款段。
 * 2026-08-29 v2：不注入给模型（模型会编造/错配条款号），改为模型回复后由后端直接拼接，
 * 来源可溯、未命中明确标注，杜绝“VDR 属于洗涤器记录仪”类幻觉。
 */
export async function matchDefectRegulations(request, message) {
  const defects = extractDefectLines(message);
  if (defects.length === 0) return '';
  const results = [];
  const table = await ensurePscDefectRegs(request);
  const tableItems = (table && table.items) || [];
  for (const d of defects) {
    const descShort = d.desc.slice(0, 110);
    const lines = [`• 缺陷 ${d.code === '???' ? '(编号未识别)' : d.code}（${descShort}）:`];
    let found = false;
    // 0. 静态映射表：优先按缺陷编号精确匹配；编号缺失时按描述关键词匹配
    let hit = tableItems.find(it => it.code === d.code);
    if (!hit && d.code === '???') {
      const dUp = d.desc.toUpperCase();
      hit = tableItems.find(it => (it.desc_en || '').toUpperCase().split(/[\/\s]+/).some(w => w.length > 4 && dUp.includes(w)));
    }
    if (hit) {
      for (const r of hit.regs) lines.push(`  - ${r}（来源：PSC缺陷条款映射表·人工精编）`);
      found = true;
    }
    if (!found) {
      // 1. PSC 速查库（人工精编，置信度高）：提取“速查：”条目行（跳过模板头）
      try {
        const qr = await searchQuickRef(request, d.desc);
        if (qr) {
          const quickLine = qr.split('\n').map(s => s.trim()).find(s => s.startsWith('【速查：')) || '';
          if (quickLine) {
            const qm = quickLine.match(/【速查：(.+?)】（来源：(.+?)）/) || quickLine.match(/【速查：(.+?)】/);
            const label = qm ? qm[1] : quickLine.replace(/^【速查：/, '');
            const src = (qm && qm[2]) ? qm[2] : 'PSC速查库';
            lines.push(`  - ${label.slice(0, 120)}（来源：${src}）`);
            found = true;
          }
        }
      } catch (e) { /* 忽略 */ }
    }
    if (!found) {
      // 2. 公约原文分片（MARPOL/MLC/ISM/LSA/SOLAS）：取命中标题，最多2条
      try {
        const regs = await searchRegsAllKnowledge(request, d.desc);
        if (regs) {
          const titles = regs.split(/\n/).map(s => s.replace(/^【|】$/g, '').trim()).filter(t => t && t.length < 90);
          const uniq = [...new Set(titles)].slice(0, 2);
          for (const t of uniq) lines.push(`  - ${t}（来源：公约原文分片检索）`);
          found = true;
        }
      } catch (e) { /* 忽略 */ }
    }
    if (!found) lines.push('  - 知识库未收录精确条款（建议人工核对 PSC 缺陷代码对应公约）');
    results.push(lines.join('\n'));
  }
  return '【📜 缺陷对应法规条款（知识库自动匹配，请与官方原文核对）】\n\n' + results.join('\n\n');
}

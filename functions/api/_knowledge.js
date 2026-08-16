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

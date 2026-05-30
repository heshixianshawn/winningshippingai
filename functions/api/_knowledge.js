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

/** 搜索船舶知识库 */
function searchShipKnowledge(kb, query) {
  if (!kb || !kb.ships) return '';
  const q = query.toLowerCase();
  const results = [];

  // 先精确匹配船名
  const matchedShip = kb.ships.find(s => 
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

  // 关键字匹配更多船舶
  for (const ship of kb.ships) {
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
function searchTechIndex(ti, query) {
  if (!ti || !ti.devices) return '';
  const q = query.toLowerCase();
  const results = [];

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

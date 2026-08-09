// WINNING Shipping AI - Survey Status Knowledge Module
// 从统一知识库中查询船舶检验状态、证书到期、预警信息

import { SURVEY_DATA } from './_survey_data.js';

/**
 * 根据船名模糊匹配
 */
export function searchShip(query) {
  const q = query.toUpperCase().replace(/\s+/g, '_');
  const results = [];
  
  for (const [key, ship] of Object.entries(SURVEY_DATA.ships)) {
    const name = ship.n?.toUpperCase() || '';
    const imo = ship.imo || '';
    
    if (name.includes(query.toUpperCase()) || imo.includes(query) || key.includes(q)) {
      results.push({ key, ...ship });
    }
  }
  
  return results;
}

/**
 * 获取某船的全部信息（方便 AI 理解）
 */
export function getShipDetails(shipName) {
  const ships = searchShip(shipName);
  if (ships.length === 0) return null;
  
  const ship = ships[0];
  
  // Format surveys
  let surveysText = '';
  for (const s of (ship.surveys || [])) {
    const days = s.days !== null ? 
      (s.days < 0 ? `已过期${-s.days}天` : `剩余${s.days}天`) : '';
    surveysText += `  - ${s.d}: ${s.due} (${days})\n`;
  }
  
  // Format certificates
  let certsText = '';
  for (const c of (ship.certs || [])) {
    const days = c.days !== null ? 
      (c.days < 0 ? `已过期${-c.days}天` : `剩余${c.days}天`) : '';
    certsText += `  - ${c.n}: ${c.exp} (${days})\n`;
  }
  
  return `【船舶信息】
船名: ${ship.n}
IMO: ${ship.imo}
船旗: ${ship.flag}
船级社: ${ship.cs}
周年日: ${ship.ann}

【检验状态】
${surveysText || '  暂无数据'}

【证书到期】
${certsText || '  暂无数据'}
`;
}

/**
 * 获取指定天数内到期/过期预警
 */
export function getAlerts(maxDays = 30) {
  const alerts = [];
  
  for (const item of (SURVEY_DATA.urgent || [])) {
    alerts.push(`🔴 ${item.ship}: ${item.name} | ${item.date} | 仅剩${item.days}天`);
  }
  
  for (const item of (SURVEY_DATA.expired_recent || [])) {
    if (-item.days <= maxDays) {
      alerts.push(`💀 ${item.ship}: ${item.name} | ${item.date} | 已过期${-item.days}天`);
    }
  }
  
  return alerts;
}

/**
 * 获取预警摘要（适合放在系统prompt中）
 */
export function getAlertSummary() {
  const urgent = SURVEY_DATA.urgent || [];
  const expired = SURVEY_DATA.expired_recent || [];
  
  let text = '';
  
  if (urgent.length > 0) {
    text += `\n## 🔴 即将到期预警（7天内）\n`;
    for (const item of urgent) {
      text += `- ${item.ship}: ${item.name} | ${item.date} | 仅剩${item.days}天\n`;
    }
  }
  
  if (expired.length > 0) {
    const recent = expired.filter(e => -e.days <= 30);
    if (recent.length > 0) {
      text += `\n## 💀 近期已过期（30天内）\n`;
      for (const item of recent.slice(0, 10)) {
        text += `- ${item.ship}: ${item.name} | ${item.date} | 已过期${-item.days}天\n`;
      }
    }
  }
  
  return text;
}

/**
 * 统计摘要
 */
export function getStats() {
  const s = SURVEY_DATA.stats || {};
  return `总船舶: ${s.total || 0}艘 | NK:${s.by_class?.NK || 0} CCS:${s.by_class?.CCS || 0} ABS:${s.by_class?.ABS || 0} KR:${s.by_class?.KR || 0}`;
}

/**
 * 综合搜索：根据用户问题匹配相关知识
 */
export function querySurveyKnowledge(question) {
  const q = question.toLowerCase();
  let context = '';
  
  // Check for specific ship
  const shipPatterns = [
    /WINNING\s+(\w+)/i,
    /SUNNY\s+(\w+)/i,
  ];
  
  for (const pattern of shipPatterns) {
    const match = q.match(pattern);
    if (match) {
      const fullName = match[0];
      const details = getShipDetails(fullName);
      if (details) {
        return '\n【Survey Status 知识库匹配】\n' + details;
      }
    }
  }
  
  // Check for alert-related queries
  if (/到期|过期|即将|预警|提醒|告警|alert|expire|due/i.test(q)) {
    const alerts = getAlerts(90);
    if (alerts.length > 0) {
      context = '\n【证书/检验到期预警】\n' + alerts.slice(0, 15).join('\n');
      return context;
    }
  }
  
  // Check for class society queries
  if (/NK|ABS|CCS|KR|DNV|BV|船级社/i.test(q)) {
    const byCs = {};
    for (const [key, ship] of Object.entries(SURVEY_DATA.ships)) {
      const cs = ship.cs || 'Unknown';
      byCs[cs] = (byCs[cs] || 0) + 1;
    }
    return '\n【船级社分布】\n' + Object.entries(byCs).map(([k,v]) => `  ${k}: ${v}艘`).join('\n');
  }
  
  return null;
}

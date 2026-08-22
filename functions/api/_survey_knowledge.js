// WINNING Shipping AI - Survey Status Knowledge Module
// 从统一知识库中查询船舶检验状态、证书到期、预警信息

import { SURVEY_DATA } from './_survey_data.js';

/**
 * 根据船名模糊匹配（兼容新旧字段：name 或 n）
 */
export function searchShip(query) {
  const q = query.toUpperCase().replace(/\s+/g, '_');
  const results = [];
  
  for (const [key, ship] of Object.entries(SURVEY_DATA.ships)) {
    const name = (ship.name || ship.n || '').toUpperCase();
    const imo = ship.imo || '';
    
    if (name.includes(query.toUpperCase()) || imo.includes(query) || key.includes(q)) {
      results.push({ key, ...ship });
    }
  }
  
  return results;
}

/** 解析日期（兼容 YYYY-MM-DD / DD Mon YYYY 等） */
function parseDateStr(s) {
  if (!s) return null;
  const str = String(s).trim();
  const m = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
  const m2 = str.match(/(\d{1,2})\s+[A-Za-z]{3,9}\.?\s+(\d{4})/);
  if (m2) {
    const months = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
    const mm = months[String(m2[1]).toLowerCase().slice(0,3)];
    if (mm !== undefined) return new Date(parseInt(m2[2]), mm, parseInt(m2[1]));
  }
  return null;
}

function daysText(dateStr) {
  const d = parseDateStr(dateStr);
  if (!d) return '';
  const days = Math.round((d - new Date()) / (24*60*60*1000));
  if (days < 0) return `已过期${-days}天`;
  if (days === 0) return '今天到期';
  return `剩余${days}天`;
}

/**
 * 获取某船的全部信息（新结构兼容：name/classSociety/surveys[{description,due_date,last_done}]）
 */
export function getShipDetails(shipName) {
  const ships = searchShip(shipName);
  if (ships.length === 0) return null;
  
  const ship = ships[0];
  
  // Format surveys
  let surveysText = '';
  for (const s of (ship.surveys || [])) {
    const desc = s.description || s.d || '';
    const due = s.due_date || s.due || '';
    const last = s.last_done || '';
    surveysText += `  - ${desc}: ${due} (${daysText(due)})${last ? `，上次 ${last}` : ''}\n`;
  }
  
  // Format certificates
  let certsText = '';
  for (const c of (ship.certificates || ship.certs || [])) {
    const cn = c.name || c.n || '';
    const exp = c.expiry_date || c.exp || '';
    certsText += `  - ${cn}: ${exp} (${daysText(exp)})\n`;
  }
  
  return `【船舶信息】
船名: ${ship.name || ship.n || ''}
IMO: ${ship.imo}
船旗: ${ship.flag}
船级社: ${ship.classSociety || ship.cs || ''}
${ship.buildDate || ship.build_date ? `建造日期: ${ship.buildDate || ship.build_date}` : ''}
${ship.gt ? `总吨GT: ${ship.gt}` : ''}
${ship.dwt ? `载重吨DWT: ${ship.dwt}` : ''}

【检验状态】
${surveysText || '  暂无数据'}

【证书到期】
${certsText || '  暂无数据'}
`;
}

/**
 * 获取指定天数内到期/过期预警（从 ships 实时计算，兼容新结构无预计算字段）
 */
export function getAlerts(maxDays = 30) {
  const alerts = [];
  const now = new Date();
  
  for (const [key, ship] of Object.entries(SURVEY_DATA.ships)) {
    const nm = ship.name || ship.n || key;
    const pushItem = (name, date) => {
      const d = parseDateStr(date);
      if (!d) return;
      const days = Math.round((d - now) / (24*60*60*1000));
      if (days >= 0 && days <= 7) {
        alerts.push({ ship: nm, name, date, days, level: 'urgent' });
      } else if (days < 0 && -days <= maxDays) {
        alerts.push({ ship: nm, name, date, days, level: 'expired' });
      }
    };
    for (const s of (ship.surveys || [])) {
      if (s.due_date) pushItem(s.description || 'Survey', s.due_date);
    }
    for (const c of (ship.certificates || [])) {
      if (c.expiry_date) pushItem(c.name || 'Cert', c.expiry_date);
    }
  }
  
  return alerts.map(a =>
    a.level === 'urgent'
      ? `🔴 ${a.ship}: ${a.name} | ${a.date} | 仅剩${a.days}天`
      : `💀 ${a.ship}: ${a.name} | ${a.date} | 已过期${-a.days}天`
  );
}

/**
 * 获取预警摘要（适合放在系统prompt中）
 */
export function getAlertSummary() {
  const now = new Date();
  const urgent = [];
  const expired = [];
  
  for (const [key, ship] of Object.entries(SURVEY_DATA.ships)) {
    const nm = ship.name || ship.n || key;
    const pushItem = (name, date) => {
      const d = parseDateStr(date);
      if (!d) return;
      const days = Math.round((d - now) / (24*60*60*1000));
      if (days >= 0 && days <= 7) {
        urgent.push({ ship: nm, name, date, days });
      } else if (days < 0 && -days <= 30) {
        expired.push({ ship: nm, name, date, days });
      }
    };
    for (const s of (ship.surveys || [])) {
      if (s.due_date) pushItem(s.description || 'Survey', s.due_date);
    }
    for (const c of (ship.certificates || [])) {
      if (c.expiry_date) pushItem(c.name || 'Cert', c.expiry_date);
    }
  }
  
  let text = '';
  if (urgent.length > 0) {
    text += `\n## 🔴 即将到期预警（7天内）\n`;
    for (const item of urgent.slice(0, 15)) {
      text += `- ${item.ship}: ${item.name} | ${item.date} | 仅剩${item.days}天\n`;
    }
  }
  if (expired.length > 0) {
    text += `\n## 💀 近期已过期（30天内）\n`;
    for (const item of expired.slice(0, 10)) {
      text += `- ${item.ship}: ${item.name} | ${item.date} | 已过期${-item.days}天\n`;
    }
  }
  
  return text;
}

/**
 * 统计摘要
 */
export function getStats() {
  const byClass = {};
  let total = 0;
  for (const [key, ship] of Object.entries(SURVEY_DATA.ships)) {
    total++;
    const cs = ship.classSociety || ship.cs || 'Unknown';
    byClass[cs] = (byClass[cs] || 0) + 1;
  }
  return `总船舶: ${total}艘 | NK:${byClass['NK'] || 0} CCS:${byClass['CCS'] || 0} ABS:${byClass['ABS'] || 0} KR:${byClass['KR'] || 0}`;
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
  
  // Check for docking survey queries (坞检专项，支持年份筛选)
  if (/坞检|坞修|Docking/i.test(q)) {
    const yearMatch = q.match(/20\d{2}/);
    const year = yearMatch ? yearMatch[0] : null;
    const dockShips = [];
    for (const [key, ship] of Object.entries(SURVEY_DATA.ships)) {
      for (const s of (ship.surveys || [])) {
        const desc = String(s.description || '');
        if (s.type === 'dry_docking' || /坞检|Docking|BTS/i.test(desc)) {
          const due = String(s.due_date || '');
          if (year && due.includes(year)) {
            dockShips.push(`  - ${ship.name}: ${desc} 到期 ${due}${s.last_done ? '（上次 ' + s.last_done + '）' : ''}`);
          } else if (!year) {
            dockShips.push(`  - ${ship.name}: ${desc} 到期 ${due}${s.last_done ? '（上次 ' + s.last_done + '）' : ''}`);
          }
        }
      }
    }
    if (dockShips.length > 0) {
      return `\n【坞检（Docking Survey）状态】${year ? ' — ' + year + ' 年到期' : ''}\n` + dockShips.slice(0, 40).join('\n');
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
      const cs = ship.classSociety || ship.cs || 'Unknown';
      byCs[cs] = (byCs[cs] || 0) + 1;
    }
    return '\n【船级社分布】\n' + Object.entries(byCs).map(([k,v]) => `  ${k}: ${v}艘`).join('\n');
  }
  
  return null;
}

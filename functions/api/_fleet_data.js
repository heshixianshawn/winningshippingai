// WINNING Shipping AI - 船舶参数库 & TMOU PSC 风险检索模块（2026-08-22 新增）
// 数据源:
//   - fleet_params.json（权威参数库：GT/NT/DWT/建造年份/主机/船旗/船级社，来自船舶信息统计2026.xlsx）
//   - psc_risk.json（Tokyo MOU APCIS 每周更新的 PSC 风险档案：风险等级/优先级/检查窗口/滞留）

let fleetParams = null;
let pscRisk = null;
let fleetLoadAttempted = false;

/** 获取 Pages 部署URL */
function getPagesUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** 加载参数库（懒加载 + 失败不重复尝试） */
async function ensureFleetParams(request) {
  if (fleetParams) return fleetParams;
  if (fleetLoadAttempted) return null;
  fleetLoadAttempted = true;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/fleet_params.json`);
    if (resp.ok) {
      fleetParams = await resp.json();
      return fleetParams;
    }
  } catch (e) {
    console.error('Failed to load fleet_params.json:', e.message);
  }
  return null;
}

/** 加载 PSC 风险档案 */
async function ensurePscRisk(request) {
  if (pscRisk) return pscRisk;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/psc_risk.json`);
    if (resp.ok) {
      pscRisk = await resp.json();
      return pscRisk;
    }
  } catch (e) {
    console.error('Failed to load psc_risk.json:', e.message);
  }
  return null;
}

/** 规范化船名（去空格、大写） */
function normName(n) {
  return String(n || '').replace(/[\s_\-]+/g, '').toUpperCase();
}

/** 检索船舶基本参数：按船名/IMO 匹配，返回权威参数文本 */
export function searchFleetParams(params, query) {
  if (!params || !params.ships) return '';
  const q = query.toLowerCase().trim();
  const qn = normName(q);
  const ships = params.ships || {};
  const results = [];

  // 1. IMO 精确匹配
  if (/^\d{7}$/.test(qn)) {
    const ship = ships[qn];
    if (ship) {
      return formatShipParams(ship.name_en || `IMO ${qn}`, ship, qn);
    }
  }

  // 2. 船名匹配（精确/包含/尾部词）
  for (const imo in ships) {
    const s = ships[imo];
    const sn = (s.name_en || '').toLowerCase().trim();
    const lastName = sn.split(' ').pop();
    const snNorm = normName(sn);
    if (snNorm === qn || snNorm.includes(qn) || qn.includes(snNorm) || lastName.includes(q) || q.includes(lastName)) {
      results.push(formatShipParams(s.name_en || sn, s, imo));
      if (results.length >= 5) break;
    }
  }
  return results.join('\n\n');
}

/** 格式化单船参数 */
function formatShipParams(name, s, imo) {
  const me = [s.me_make, s.me_model].filter(Boolean).join(' ');
  const ae = [s.ae_make, s.ae_model].filter(Boolean).join(' ');
  const lines = [
    `【船舶参数库 - ${name}】`,
    `- IMO: ${imo}`,
    `- 中文船名: ${s.name_cn || ''}`,
    `- 曾用名: ${s.ex_name || '无'}`,
    `- 呼号: ${s.call_sign || ''}`,
    `- 船旗: ${s.flag || ''}`,
    `- 船级社: ${s.class_notation || ''}`,
    `- 建造年份: ${(s.built || '').slice(0, 4)}`,
    `- 建造厂: ${s.builder || ''}`,
    `- 船厂编号: ${s.hull_no || ''}`,
    `- 总吨 GT: ${s.gt || ''}`,
    `- 净吨 NT: ${s.nt || ''}`,
    `- 载重吨 DWT: ${s.dwt || ''}`,
    `- 空船重量: ${s.light_ton || ''}`,
    `- 船东: ${s.owner || ''}`,
    `- 管理公司: ${s.manager || ''}`,
    `- 接管日期: ${s.takeover_date || ''}`,
    `- 主机: ${me || '未录入'}`,
    `- 辅机: ${ae || '未录入'}`,
    `- 锅炉: ${[s.boiler_make, s.boiler_model].filter(Boolean).join(' ') || '未录入'}`,
    `- 压载水处理: ${[s.bwt_make, s.bwt_model].filter(Boolean).join(' ') || '未录入'}`,
  ];
  return lines.join('\n');
}

/** 检索 TMOU PSC 风险档案：按船名/IMO 匹配 */
export function searchPscRisk(risk, query) {
  if (!risk || !risk.ships) return '';
  const q = query.toLowerCase().trim();
  const qn = normName(q);
  const ships = risk.ships || {};
  const results = [];

  for (const name in ships) {
    const d = ships[name];
    const snNorm = normName(name);
    const sn = name.toLowerCase().trim();
    const lastName = sn.split(' ').pop();
    const imoMatch = d.imo && d.imo === qn;
    if (d.status !== 'ok') continue;
    if (snNorm === qn || snNorm.includes(qn) || qn.includes(snNorm) || lastName.includes(q) || q.includes(lastName) || imoMatch) {
      const insp = (d.inspections || []);
      const last = insp[0] || {};
      const det = insp.filter(x => String(x.detention || '').toLowerCase() === 'yes').length;
      const lines = [
        `【Tokyo MOU PSC 风险档案 - ${name}】(数据源: APCIS, 更新: ${d.scanned_at || ''})`,
        `- 风险等级: ${d.risk_level || '未知'} (High=高风险/Standard=标准/Low=低风险)`,
        `- 检验优先级: ${d.priority || '-'} (I=强制优先检查/II=优先/III=常规)`,
        `- 检查窗口: ${d.inspection_window || '无(无Tokyo MOU检查历史)'}`,
        `- 目标因子: ${d.weighting_points || '?'}`,
        `- 最近检验: ${last.date || '无'} ${last.place || ''} | 缺陷${last.deficiencies || 0} | 滞留${last.detention || 'no'}`,
        `- 36月内检验次数: ${insp.length}`,
        `- 36月内滞留次数: ${det}`,
        `- 未消除缺陷: ${d.outstanding_deficiencies ?? 0}`,
      ];
      if (d.note) lines.push(`- 说明: ${d.note}`);
      if (d.data_issue) lines.push(`- 数据问题: ${d.data_issue}`);
      results.push(lines.join('\n'));
      if (results.length >= 5) break;
    }
  }
  return results.join('\n\n');
}

/** ships 模块综合检索入口：参数库 + PSC 风险 */
export async function searchFleetKnowledge(message, request) {
  const parts = [];
  const params = await ensureFleetParams(request);
  if (params) {
    const p = searchFleetParams(params, message);
    if (p) parts.push(p);
  }
  const risk = await ensurePscRisk(request);
  if (risk) {
    const r = searchPscRisk(risk, message);
    if (r) parts.push(r);
  }
  return parts.join('\n\n');
}

// WINNING Shipping AI - 船队统计直答模块（2026-09-15 新增）
// ---------------------------------------------------------------------------
// 背景：统计/计数类问题（如"船队一共多少条船"）交给模型自由生成会算错
//       （平台曾把 64 艘答成 27 艘，换问法又说"未注入数据源"）。
// 方案：照搬 chat.js 中「PSC 高频速查」的后端直返模式——
//       命中 → 后端从站点数据文件真算 → 模板化回答 → 不经模型、模型无法改动数值。
// 约束：所有数字必须实时统计（无硬编码常量），加船后自动跟随数据变化。
// 数据源：
//   1) functions/api/_survey_data.js  —— 船名 / 船级社 / 证书与检验到期日（Survey Status）
//   2) data/fleet_dept.json           —— 部门船队映射（经 _dept.js 加载）
//   3) data/survey_alerts.json        —— 证书/检验预警（由 systems/survey_alert.py 每日生成）
// ---------------------------------------------------------------------------

import { SURVEY_DATA } from './_survey_data.js';
import { parseDept, loadDeptData, isInDept } from './_dept.js';

const DISCLAIMER = '⚠️ 以上信息来自WINNING知识库，请以原始证书文件为准。';

// 计数意图关键词
const COUNT_WORD = /(多少|几艘|几条|几个|几项|数量|总数|统计|一共|总共|合计|共有|规模)/;
// 船的数量单位
const SHIP_UNIT = /[条艘]/;
// 消息中出现具体船名 → 单船查询，绝不走统计直答（保护法规/单船路径）
const SHIP_NAME = /(WINNING|SUNNY)\s+[A-Z]{2,}/;
// 2026-09-15：预警注入复用同一套船名/范围信号（避免另写一套导致两处判定不一致）
export const SHIP_NAME_RE = SHIP_NAME;
/** 从消息中提取本船名（无则 null）。供 chat.js 预警注入判定查询对象复用。 */
export function extractShipName(message) {
  const m = String(message || '').match(SHIP_NAME);
  return m ? m[0].trim().toUpperCase().replace(/\s+/g, ' ') : null;
}

// ===== PSC/FSC 检查记录直答（2026-09-16 新增）=====
// 背景：全船队 643 条 PSC 检查记录只在单船档案里，平台完全读不到，
//       实测问「2026年6月后烟台港PSC记录」被答成「知识库无此数据」+ 外部渠道建议。
// 数据源：data/psc_records.json（由 scripts/psc_records_build.py 从 64 份档案构建）
const PSC_ASK = /(psc|fsc|港口国监督|受检记录|检查记录|滞留记录)/i;
const PSC_STRONG = /(psc|fsc)/i;
// 中文港口名 → 数据集里的港口键（小写）
const PORT_ALIAS = {
  '烟台': 'yantai', '青岛': 'qingdao', '天津': 'tianjin', '日照': 'rizhao',
  '曹妃甸': 'caofeidian', '大连': 'dalian', '上海': 'shanghai', '宁波': 'ningbo',
  '舟山': 'zhoushan', '连云港': 'lianyun', '黄骅': 'huanghua', '京唐': 'jingtang',
  '广州': 'guangzhou', '深圳': 'shenzhen', '厦门': 'xiamen', '湛江': 'zhanjiang',
  '黑德兰': 'port hedland', '格拉德斯通': 'gladstone', '丹皮尔': 'dampier',
  '纽卡斯尔': 'newcastle', '水岛': 'mizushima', '唐津': 'dangjin',
  '釜山': 'busan', '蔚山': 'ulsan', '光阳': 'gwangyang', '新加坡': 'singapore',
};

/** 从问句解析 PSC 查询条件：{port, since, ship} */
function parsePscQuery(q) {
  let port = null;
  for (const [cn, key] of Object.entries(PORT_ALIAS)) {
    if (q.includes(cn)) { port = key; break; }
  }
  if (!port) {
    // 英文港名直接匹配（如 "Yantai" / "Port Hedland"）
    const en = q.match(/\b(port hedland|gladstone|newcastle|dampier|qingdao|yantai|tianjin|rizhao|dalian|busan|ulsan|gwangyang|singapore|shanghai)\b/i);
    if (en) port = en[1].toLowerCase();
  }
  let since = null;
  let m = q.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  if (m) since = `${m[1]}-${String(m[2]).padStart(2, '0')}-01`;
  if (!since) {
    m = q.match(/(\d{4})[-\/](\d{1,2})/);
    if (m) since = `${m[1]}-${String(m[2]).padStart(2, '0')}-01`;
  }
  if (!since) {
    m = q.match(/(?:近|最近|过去)\s*(\d{1,2})\s*个月/);
    if (m) {
      const d = new Date();
      d.setMonth(d.getMonth() - parseInt(m[1], 10));
      since = d.toISOString().slice(0, 10);
    }
  }
  if (!since) {
    m = q.match(/(\d{4})\s*年/);
    if (m) since = `${m[1]}-01-01`;
  }
  const ship = SHIP_NAME.test(q) ? extractShipName(q) : null;
  return { port, since, ship };
}

let pscCache = null;
let pscLoadTried = false;
async function loadPscRecords(request) {
  if (pscCache) return pscCache;
  if (pscLoadTried) return null;
  pscLoadTried = true;
  try {
    const url = new URL(request.url);
    const resp = await fetch(`${url.protocol}//${url.host}/data/psc_records.json`);
    if (!resp.ok) return null;
    pscCache = await resp.json();
    return pscCache;
  } catch (e) {
    console.error('[PSC] psc_records.json load failed:', e.message);
    return null;
  }
}

async function buildPscAnswer(hit, request) {
  const data = await loadPscRecords(request);
  if (!data) return null;
  const { port, since, ship } = hit;
  const rows = [];
  for (const [nm, v] of Object.entries(data.ships || {})) {
    if (ship && !nm.toUpperCase().includes(ship)) continue;
    for (const r of v.records || []) {
      if (since && r.date < since) continue;
      if (port && !String(r.port || '').toLowerCase().includes(port)) continue;
      rows.push({ nm, ...r });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));

  const scope = [
    ship ? `船舶 ${ship}` : '全船队',
    port ? `港口 ${port}` : null,
    since ? `${since} 之后` : null,
  ].filter(Boolean).join('｜');

  if (!rows.length) {
    return line(`**${scope} 的 PSC/FSC 检查记录：未查到符合条件的记录**。`
      + `目前知识库收录 PSC/FSC 检查记录 **${data.count}** 条，覆盖 **${data.ship_count}** 艘（来源：单船档案）。`
      + (since ? '请确认时间范围' : ''),
      'WINNING 知识库 PSC检查记录 psc_records.json', data.generated);
  }

  const detained = rows.filter(r => r.detained).length;
  const withDefects = rows.filter(r => (r.defects || 0) > 0).length;
  const head = `**${scope} 共 ${rows.length} 条 PSC/FSC 检查记录**（其中 ${withDefects} 条有缺陷、${detained} 条滞留）：`;
  const shown = rows.slice(0, 20).map(r =>
    `- ${r.date}｜${r.nm}｜${r.port || '—'}｜缺陷 ${r.defects == null ? '—' : r.defects}｜${r.detained ? '⛔ 滞留' : '未滞留'}`);
  const tail = rows.length > 20 ? `\n（仅列前 20 条，共 ${rows.length} 条）` : '';
  return line(head + '\n' + shown.join('\n') + tail,
    'WINNING 知识库 PSC检查记录 psc_records.json（来源：单船档案 PSC-FSC 表）', data.generated);
}
/** 明确的全队/部门语境（无船名时才用于放行全队或部门汇总） */
export function hasFleetScope(message) {
  const q = String(message || '');
  return /(全船队|整个船队|所有船|哪些船|全部船|船队中|船队里|各船|每艘船|哪些部门|各个部门|所有部门)/.test(q);
}
// 非 ships 模块时，必须带明确船队语境才不会误拦（避免截胡法规类问题）
const FLEET_CONTEXT = /(船队|全船队|WINNING|集团|公司|我们)/i;
// 2026-09-15：单船→机务部归属提问（"WINNING CREATION 属于哪个机务部"）。
// 仅在 ships 模块 + 出现具体船名 + 带归属词时命中，答不出（映射里没有）就交回原路径。
const DEPT_ASK = /(机务部|部门|归属|属于|分管|归哪个部|哪个部)/;
// 部门集合类提问（各/所有部门）
const DEPT_ALL = /(各|所有|全部)?(个)?部门|各(机务)?部/;
// 船级社识别词表（仅用于识别提问对象，数量一律从数据统计）
const CLASS_TOKENS = ['CLASSNK', 'NKK', 'DNV', 'RINA', 'CCS', 'ABS', 'KR', 'NK', 'BV', 'LR'];
const CLASS_ALIAS = { CLASSNK: 'NK', NKK: 'NK' };

// ===== 数据读取 =====

function dataUrl(request, path) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}${path}`;
}

let alertData = null;
let alertLoadAttempted = false;

/** 加载站点预警数据（data/survey_alerts.json，每日由 survey_alert.py 生成） */
async function loadAlertData(request) {
  if (alertData) return alertData;
  if (alertLoadAttempted) return null;
  alertLoadAttempted = true;
  try {
    const resp = await fetch(dataUrl(request, '/data/survey_alerts.json'));
    if (resp.ok) {
      alertData = await resp.json();
      return alertData;
    }
    console.error('[FleetStats] survey_alerts.json fetch failed:', resp.status);
  } catch (e) {
    console.error('[FleetStats] survey_alerts.json load failed:', e.message);
  }
  return null;
}

// ===== 统计（全部实时计算） =====

const updatedAt = () => SURVEY_DATA.lastUpdated || '';

function allShips() {
  return Object.entries(SURVEY_DATA.ships).map(([key, s]) => ({
    key,
    name: s.name || s.n || key,
    classSociety: String(s.classSociety || s.cs || 'Unknown').toUpperCase(),
  }));
}

function fleetTotal() {
  return Object.keys(SURVEY_DATA.ships).length;
}

/**
 * 船名是否在平台船名表（Survey Status）内。
 * 2026-09-15：物流小船（@winninglogistic.com，如 WINNING KOGON）不在船名表内，
 * 但尾词与在册船（SUNNY KOGON）相同——不得据此推部门。
 * 单 token（如 "KOGON"）允许按尾词唯一命中在册船；多 token 必须全名精确命中。
 * @returns {{ok:boolean, ship:string|null}} ok=是否在册，ship=命中的在册船名
 */
function resolveFleetShip(name) {
  const n = String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!n) return { ok: false, ship: null, knownButAbsent: false };
  const ships = allShips();
  const exact = ships.find(s => String(s.name).trim().toUpperCase().replace(/\s+/g, ' ') === n);
  if (exact) return { ok: true, ship: String(exact.name).trim(), knownButAbsent: false };
  const tokens = n.split(' ');
  if (tokens.length > 1) {
    // 全名不在册。若该船名「除船东前缀外完全相同」的在册船存在，则为船东前缀不一致的别家船
    // （如物流船 WINNING KOGON vs 在册船 SUNNY KOGON）——必须硬拒，不得按尾词兜。
    const bare = tokens.slice(1).join(' ');
    const sibling = ships.find(s => {
      const t = String(s.name).trim().toUpperCase().replace(/\s+/g, ' ').split(' ');
      return t.length > 1 && t.slice(1).join(' ') === bare;
    });
    return { ok: false, ship: sibling ? String(sibling.name).trim() : null, knownButAbsent: !!sibling };
  }
  const tailHits = ships.filter(s => String(s.name).trim().split(/\s+/).pop().toUpperCase() === n);
  if (tailHits.length === 1) return { ok: true, ship: String(tailHits[0].name).trim(), knownButAbsent: false };
  return { ok: false, ship: null, knownButAbsent: false };
}

/** 部门映射中「未匹配到任何在册船」的尾词条目（不应计入统计） */
function unmatchedDeptTails(deptMap) {
  const tails = new Set(allShips().map(s => String(s.name).trim().split(/\s+/).pop().toUpperCase()));
  const out = {};
  for (const d of Object.keys(deptMap)) {
    if (d.startsWith('_') || !Array.isArray(deptMap[d])) continue;
    const miss = deptMap[d].map(t => String(t).toUpperCase()).filter(t => !tails.has(t));
    if (miss.length) out[d] = miss;
  }
  return out;
}

/** 按船名前缀分组（WINNING / SUNNY / …），从数据实时统计 */
function groupCounts(ships) {
  const g = {};
  for (const s of ships) {
    const prefix = String(s.name).trim().split(/\s+/)[0].toUpperCase();
    g[prefix] = (g[prefix] || 0) + 1;
  }
  return g;
}

function groupText(ships) {
  return Object.entries(groupCounts(ships))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v} 艘`)
    .join(' / ');
}

/** 船级社分布（从数据实时统计，按数量降序） */
function classCounts() {
  const by = {};
  for (const s of allShips()) by[s.classSociety] = (by[s.classSociety] || 0) + 1;
  return by;
}

function classDistText() {
  return Object.entries(classCounts())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k} ${v}`)
    .join(' / ');
}

/** 识别消息中出现的船级社（大写词表 + 词边界，避免误判英文单词） */
function matchClasses(q) {
  const found = [];
  for (const t of CLASS_TOKENS) {
    if (new RegExp(`\\b${t}\\b`).test(q)) {
      const norm = CLASS_ALIAS[t] || t;
      if (!found.includes(norm)) found.push(norm);
    }
  }
  return found;
}

function uniqShips(items) {
  return new Set(items.map(x => String(x && x.ship || '').trim()).filter(Boolean));
}

// ===== 意图识别 =====

/**
 * 识别统计类意图（同步，不触发数据加载）
 * @returns {{kind:string, dept?:string|null, classes?:string[]}|null}
 */
export function detectFleetStat(message, module = 'ships') {
  const q = String(message || '');
  if (!q.trim()) return null;
  // 0) 单船→机务部归属（必须在"单船查询不拦截"之前判）
  //    排除船级社问法（"WINNING X 属于哪个船级社"）→ 那是另一类问题，交回模型路径
  if (module === 'ships' && SHIP_NAME.test(q) && DEPT_ASK.test(q) && !/船级社|入级/i.test(q)) {
    return { kind: 'ship_dept', ship: extractShipName(q) };
  }
  // 0.5) PSC/FSC 检查记录（需在「单船查询不拦截」之前；支持带船名筛选）
  if (PSC_ASK.test(q) && (PSC_STRONG.test(q) || /(受检|检查记录|滞留)/.test(q))) {
    const pq = parsePscQuery(q);
    return { kind: 'psc', ...pq };
  }
  if (SHIP_NAME.test(q)) return null;               // 单船查询不拦截

  const hasCount = COUNT_WORD.test(q);
  const fleetOk = module === 'ships' || FLEET_CONTEXT.test(q);

  // 1) 预警数量（"多少条船有到期预警"/"Expired 几条"）
  if (hasCount && /(预警|到期|过期|已过期|expired|overdue)/i.test(q) && fleetOk) {
    return { kind: 'alerts', dept: parseDept(q) };
  }

  // 2) 部门船数（"二部有多少艘船"）
  const dept = parseDept(q);
  if (dept && (hasCount || SHIP_UNIT.test(q))) return { kind: 'dept', dept };

  // 3) 船级社船数（"NK 有多少艘船" / "各船级社各多少艘"）
  const classes = matchClasses(q);
  if (classes.length && (hasCount || /船级社|class/i.test(q))) return { kind: 'class', classes };

  // 4) 部门汇总（"各个部门有多少艘船"）
  if (DEPT_ALL.test(q) && hasCount && fleetOk) return { kind: 'dept_all' };

  // 5) 船队总数（"船队一共多少条船" / "共有几艘船" / "船队规模"）
  if (fleetOk) {
    if (/(船舶总数|船队总数|船队数量|船舶数量|船队规模)/.test(q)) return { kind: 'total' };
    if (hasCount && SHIP_UNIT.test(q) && /船/.test(q)) return { kind: 'total' };
  }

  return null;
}

// ===== 答案构造（模板化，数字来自实时统计） =====

function line(body, source, updated) {
  return `${body}。（来源：${source}${updated ? '，更新于 ' + updated : ''}）\n\n${DISCLAIMER}`;
}

async function buildShipDept(shipName, request) {
  const deptMap = await loadDeptData(request);
  if (!deptMap || !shipName) return null;
  // 守卫（2026-09-15）：不在船名表内的船一律不按尾词推部门（物流小船 WINNING KOGON ≠ 在册船 SUNNY KOGON）
  const resolved = resolveFleetShip(shipName);
  if (!resolved.ok) {
    const body = `**${shipName}** 不在 WINNING 管理船队名单内（可能为物流/外部船只），无法给出机务部归属`
      + (resolved.knownButAbsent
          ? `。\n\n注意：在册船 **${resolved.ship}** 的船名尾词相同，但属不同船舶，不可混为一部`
          : '')
      + `。\n\n如需查询，请提供在册船名或 IMO 编号`;
    return line(body, 'WINNING 知识库 Survey Status 船名表（未按尾词推断）', updatedAt());
  }
  const tail = shipName.trim().split(/\s+/).pop().toUpperCase();
  const hits = Object.keys(deptMap).filter(
    k => !k.startsWith('_') && Array.isArray(deptMap[k]) &&
         deptMap[k].some(t => String(t).toUpperCase() === tail)
  );
  if (hits.length === 0) return null;   // 映射里没有 → 交回原路径（不编造）
  const parts = hits.map(d => {
    const n = allShips().filter(s => isInDept(s.name, d, deptMap)).length;
    return `${d}（该部 ${n} 艘）`;
  });
  const caveat = '';
  const body = `${shipName} 属于 **${parts.join('、')}**（依据：机务部船队映射 fleet_dept.json 中 ${hits[0]} 清单含船名尾词 ${tail}${caveat}）`;
  return line(body, 'WINNING 知识库 部门船队映射 fleet_dept.json', updatedAt());
}

async function buildTotal() {
  const total = fleetTotal();
  const body = `船队共 **${total}** 艘（其中 ${groupText(allShips())}）`;
  return line(body, 'WINNING 知识库 Survey Status', updatedAt());
}

async function buildDept(dept, request) {
  const deptMap = await loadDeptData(request);
  if (!deptMap || !Array.isArray(deptMap[dept])) return null;   // 映射未配置 → 交回原路径
  const inDept = allShips().filter(s => isInDept(s.name, dept, deptMap));
  const listLen = deptMap[dept].length;
  // 本次统计只计在册船：映射清单里未匹配到船名表的条目（含物流小船）一律不计入，并如实标注
  const miss = (unmatchedDeptTails(deptMap)[dept] || []);
  const diff = (listLen !== inDept.length || miss.length)
    ? `（部门映射清单 ${listLen} 条，其中 ${miss.length} 条未匹配到船名表、未计入）`
    : '';
  const body = `${dept}共 **${inDept.length}** 艘（其中 ${groupText(inDept)}）${diff}`;
  return line(body, 'WINNING 知识库 部门船队映射 fleet_dept.json × Survey Status', updatedAt());
}

async function buildDeptAll(request) {
  const deptMap = await loadDeptData(request);
  if (!deptMap) return null;
  const depts = Object.keys(deptMap).filter(k => !k.startsWith('_') && Array.isArray(deptMap[k]));
  if (depts.length === 0) return null;
  const parts = [];
  let assigned = 0;
  for (const d of depts) {
    const n = allShips().filter(s => isInDept(s.name, d, deptMap)).length;
    assigned += n;
    parts.push(`${d} ${n} 艘`);
  }
  const total = fleetTotal();
  const rest = total - assigned;
  const miss = unmatchedDeptTails(deptMap);
  const missTxt = Object.keys(miss).map(d => `${d} ${miss[d].join('/')}`).join('、');
  const missNote = missTxt ? `；映射中 ${Object.values(miss).reduce((a, b) => a + b.length, 0)} 条未匹配到船名表（${missTxt}），已不计入` : '';
  const body = `各部门船数：${parts.join(' / ')}（合计 ${assigned} 艘，未列入部门映射 ${rest} 艘；全船队共 ${total} 艘）${missNote}`;
  return line(body, 'WINNING 知识库 部门船队映射 fleet_dept.json × Survey Status', updatedAt());
}

async function buildClass(classes) {
  const by = classCounts();
  if (classes.length === 1) {
    const c = classes[0];
    const n = by[c] || 0;
    const note = n === 0 ? `（本船队无 ${c} 入级船舶）` : '';
    const body = `${c} 船级社共 **${n}** 艘${note}（全船队船级社分布：${classDistText()}）`;
    return line(body, 'WINNING 知识库 Survey Status', updatedAt());
  }
  const parts = classes.map(c => `${c} ${by[c] || 0} 艘`);
  const body = `${classes.join('/')} 船级社船数：${parts.join(' / ')}（其余：${Object.entries(by).filter(([k]) => !classes.includes(k)).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' / ')}）`;
  return line(body, 'WINNING 知识库 Survey Status', updatedAt());
}

async function buildAlerts(dept, request) {
  const data = await loadAlertData(request);
  if (!data) return null;
  let deptMap = null;
  if (dept) {
    deptMap = await loadDeptData(request);
    if (!deptMap || !Array.isArray(deptMap[dept])) return null;
  }
  const filter = (arr) => (dept ? (arr || []).filter(x => isInDept(x && x.ship, dept, deptMap)) : (arr || []));
  const expired = filter(data.expired || data.expired_recent);
  const urgent = filter(data.urgent_7d);
  const warning = filter(data.warning_30d);
  const info = filter(data.info_90d);
  const scope = dept ? `${dept}` : `全船队 ${fleetTotal()} 艘`;
  const n = uniqShips([...expired, ...urgent, ...warning]).size;
  // 预警口径与站点预警数据保持一致（90 天窗口）：expired=已过期，urgent_7d=7 天内，warning_30d=8–30 天，info_90d=31–90 天
  const body = `${scope}中，当前有 **${n}** 艘存在证书/检验到期预警：已过期 **${expired.length}** 项（涉及 ${uniqShips(expired).size} 艘）、7 天内到期 **${urgent.length}** 项、8–30 天内到期 **${warning.length}** 项（涉及 ${uniqShips(warning).size} 艘）；另有 31–90 天内到期 **${info.length}** 项（涉及 ${uniqShips(info).size} 艘）作提醒（预警口径：90 天窗口）`;
  return line(body, 'WINNING 知识库 证书/检验预警 survey_alerts.json', data.generated || '');
}

/**
 * 统计类问题 → 后端直答（命中返回回复文本，未命中/数据不可用返回 null）
 * @returns {Promise<{reply:string, kind:string, source:string}|null>}
 */
export async function buildFleetStatAnswer(request, message, module = 'ships') {
  const hit = detectFleetStat(message, module);
  if (!hit) return null;
  const updated = updatedAt();
  const meta = `${module}${updated ? ' · 数据 ' + updated : ''}`;
  let reply = null;
  if (hit.kind === 'total') reply = await buildTotal();
  else if (hit.kind === 'ship_dept') reply = await buildShipDept(hit.ship, request);
  else if (hit.kind === 'psc') reply = await buildPscAnswer(hit, request);
  else if (hit.kind === 'dept') reply = await buildDept(hit.dept, request);
  else if (hit.kind === 'dept_all') reply = await buildDeptAll(request);
  else if (hit.kind === 'class') reply = await buildClass(hit.classes);
  else if (hit.kind === 'alerts') reply = await buildAlerts(hit.dept, request);
  if (!reply) return null;
  return { reply, kind: hit.kind, source: `船队统计直答（${meta}）` };
}

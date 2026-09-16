// WINNING Shipping AI - 预警四档口径（2026-09-15 改为「读站点权威文件」，单一口径源）
// ---------------------------------------------------------------------------
// 背景：模型侧原自算预警（_survey_knowledge.js 的 getAlertSummary），与站点权威数据
//       data/survey_alerts.json（systems/survey_alert.py 每日生成）口径不一致：
//       自算的 expired 受 90 天窗口约束、info_90d 缺少生成器的 cert→Renewal 归并，
//       导致"平台两处各算一套口径"。现统一为**只读站点产物**，不再自算。
//
// 口径定义（以站点文件为准，本模块不参与计算）：
//   urgent_7d    0..7 天到期
//   warning_30d  8..30 天到期
//   expired      已过期（站点不设天数上限，收全部已过期项）
//   info_90d     31..90 天到期
//
// 加载方式：沿用 _fleet_stats.js 既有先例（fetch 站点静态资源 /data/survey_alerts.json），
//          不新造机制。

/** 站点预警文件路径 */
export const ALERTS_PATH = '/data/survey_alerts.json';

/** 四档顺序（展示用） */
export const ALERT_BUCKET_ORDER = ['urgent_7d', 'warning_30d', 'expired', 'info_90d'];

/** 每档标签 */
export const ALERT_BUCKET_LABELS = {
  urgent_7d: '🔴 紧急 — 7 天内到期',
  warning_30d: '🟡 注意 — 8–30 天内到期',
  expired: '💀 已过期',
  info_90d: '🔵 提醒 — 31–90 天内到期'
};

/** 每档摘要最多逐条列出多少条（超出部分显式标注总条数，SHAME #29：严禁静默丢弃） */
export const ALERT_BUCKET_CAPS = {
  urgent_7d: 15,
  warning_30d: 10,
  expired: 10,
  info_90d: 5
};

let cached = null;
let attempted = false;

function dataUrl(request, path) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}${path}`;
}

/**
 * 加载站点预警数据（单一口径源）。失败 → 返回 null（调用方负责优雅降级，不得抛错）。
 * @param {Request} request
 * @returns {Promise<{generated?:string, urgent_7d:Array, warning_30d:Array, expired:Array, info_90d:Array}|null>}
 */
export async function loadAlerts(request) {
  if (cached) return cached;
  if (attempted) return null;
  attempted = true;
  try {
    const resp = await fetch(dataUrl(request, ALERTS_PATH));
    if (!resp.ok) {
      console.error('[Alerts] survey_alerts.json fetch failed:', resp.status);
      return null;
    }
    const data = await resp.json();
    if (!data || typeof data !== 'object') {
      console.error('[Alerts] survey_alerts.json 格式异常');
      return null;
    }
    cached = data;
    return cached;
  } catch (e) {
    console.error('[Alerts] survey_alerts.json load failed:', e.message);
    return null;
  }
}

/** 条目描述字段（站点文件用 description，兼容 name/type） */
export const itemName = (x) => String((x && (x.description || x.name || x.type)) || '').trim();

/**
 * 按条件筛选四档预警（纯筛选，不改口径）。
 * @param {object} data loadAlerts() 的返回值
 * @param {object} opts { shipFilter?, dept?, deptMap?, isInDeptFn? }
 */
export function filterAlerts(data, opts = {}) {
  const { shipFilter = null, dept = null, deptMap = null, isInDeptFn = null } = opts;
  const buckets = { urgent_7d: [], warning_30d: [], expired: [], info_90d: [] };
  if (!data) return buckets;
  for (const k of ALERT_BUCKET_ORDER) {
    // 2026-09-16：生成器已将过期档改名为 expired_recent，此处兼容两种键名（旧靠 expired）。
    const src = (k === 'expired') ? (data[k] !== undefined ? data[k] : data.expired_recent) : data[k];
    let arr = Array.isArray(src) ? src.slice() : [];
    if (dept && deptMap && typeof isInDeptFn === 'function') {
      arr = arr.filter(x => isInDeptFn(x && x.ship, dept, deptMap));
    }
    if (shipFilter) {
      const f = String(shipFilter).trim().toUpperCase().replace(/\s+/g, ' ');
      arr = arr.filter(x => String((x && x.ship) || '').toUpperCase().replace(/\s+/g, ' ') === f);
    }
    buckets[k] = arr;
  }
  return buckets;
}

/**
 * 生成注入系统 prompt 的预警摘要文本。
 * 返回 '' 表示"无预警"；返回 null 表示"数据不可用"（调用方据此优雅降级）。
 * @param {object} data loadAlerts() 返回值
 * @param {object} opts { shipFilter?, dept?, deptMap?, isInDeptFn? }
 */
export function buildAlertSummary(data, opts = {}) {
  if (!data) return null;
  const buckets = filterAlerts(data, opts);
  const counted = ALERT_BUCKET_ORDER.filter(k => buckets[k].length > 0);
  if (counted.length === 0) return '';

  const shipFilter = opts.shipFilter || null;
  const totalItems = counted.reduce((n, k) => n + buckets[k].length, 0);
  const totalShips = new Set(counted.flatMap(k => buckets[k].map(i => i && i.ship))).size;
  const scopeLabel = shipFilter ? '本船' : '全船队';

  let text = `【预警总览】${scopeLabel}共 ${totalItems} 项${shipFilter ? '' : `（涉及 ${totalShips} 艘）`}；以下按档位逐条列出（每档超出上限的已标注剩余条数）。（来源：站点预警数据${data.generated ? ' ' + data.generated : ''}）\n`;

  for (const k of counted) {
    const items = buckets[k];
    const cap = ALERT_BUCKET_CAPS[k] || 10;
    const label = shipFilter
      ? ALERT_BUCKET_LABELS[k].split('—')[0].trim() + '（本船）'
      : ALERT_BUCKET_LABELS[k];
    text += `\n## ${label}（${items.length} 项${shipFilter ? '' : `，涉及 ${new Set(items.map(i => i && i.ship)).size} 艘`}）\n`;
    for (const item of items.slice(0, cap)) {
      const d = item && item.days;
      const when = (typeof d === 'number') ? (d < 0 ? `已过期${-d}天` : `剩余${d}天`) : '';
      const prefix = shipFilter ? '' : `${item && item.ship}: `;
      text += `- ${prefix}${itemName(item)} | ${(item && item.date) || ''}${when ? ` | ${when}` : ''}\n`;
    }
    if (items.length > cap) {
      text += `- …另有 ${items.length - cap} 项未逐条列出（本档共 ${items.length} 项，请按船名/证书名查询确认）\n`;
    }
  }

  text += shipFilter
    ? `\n⚠️ 以上为本船预警；仅引用与查询船一致的条目。`
    : `\n⚠️ 以上为全船队预警汇总，每条已标注船名。仅当预警中船名与用户查询的船一致时方可引用，严禁将其他船的预警项当作查询船的证书状态。`;

  return text;
}

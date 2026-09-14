// WINNING Shipping AI - 机务部（部门）维度模块（2026-09-05 新增）
// 用途：识别用户询问的部门（二部/一部/…），判断某船是否属于该部门，供 ships 模块过滤回答范围。
// 数据源: data/fleet_dept.json（key=部门，value=船名短词列表；仅"二部"已配置，其余待 Shawn 提供清单）

let deptData = null;
let deptLoadedAt = 0;
const DEPT_TTL_MS = 5 * 60 * 1000; // 5 分钟：数据文件每日/随提交更新，避免实例级永久缓存导致读到旧值

function getPagesUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function ensureDeptData(request) {
  const fresh = deptData && (Date.now() - deptLoadedAt) < DEPT_TTL_MS;
  if (fresh) return deptData;
  try {
    const baseUrl = getPagesUrl(request);
    // 2026-09-15：加 cache-buster + 短 cacheTtl，避免边缘/实例缓存读到旧版部门映射
    const bust = Math.floor(Date.now() / (5 * 60 * 1000));
    const resp = await fetch(`${baseUrl}/data/fleet_dept.json?v=${bust}`, { cf: { cacheTtl: 60 } });
    if (resp.ok) {
      deptData = await resp.json();
      deptLoadedAt = Date.now();
      return deptData;
    }
  } catch (e) {
    console.error('Failed to load fleet_dept.json:', e.message);
  }
  return null;
}

/** 解析用户问题中的部门：返回 '二部'|'一部'|'三部'|'四部'|null */
export function parseDept(message) {
  const q = String(message || '');
  // 全角/半角数字与"部"的各种写法
  const full = q.replace(/[２２]/g, '2');
  const m = full.match(/(?:机务)?(?:第)?([一二三四1234])\s*部|fleet\s*([1234])\s*部|fleet\s*([1234])\b/i);
  if (m) {
    const num = m[1] || m[2] || m[3];
    const map = { '1': '一部', '2': '二部', '3': '三部', '4': '四部', 一: '一部', 二: '二部', 三: '三部', 四: '四部' };
    return map[num] || null;
  }
  return null;
}

/** 船名是否属于某部门（短词匹配 + 全名匹配） */
export function isInDept(shipName, dept, deptMap) {
  if (!dept || !deptMap) return true; // 无部门约束=全部
  const list = deptMap[dept];
  if (!list || !Array.isArray(list)) return true; // 该部门未配置 → 不误伤（由上层提示）
  const name = String(shipName || '').toUpperCase();
  const short = name.split(/\s+/).pop() || '';
  if (list.includes(short)) return true;
  // 全名匹配（如 "SUNNY BOFFA" 整串）
  const nameNorm = name.replace(/[\s_-]+/g, '');
  return list.some(t => nameNorm === t || nameNorm.endsWith(t) && list.includes(t));
}

/** 返回某部门船名短词集合 */
export async function deptShips(dept, request) {
  const data = await ensureDeptData(request);
  if (!data || !data[dept]) return [];
  return data[dept];
}

export const DEPT_NAMES = ['一部', '二部', '三部', '四部'];

export async function loadDeptData(request) {
  return ensureDeptData(request);
}

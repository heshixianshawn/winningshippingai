// WINNING Shipping AI - 机务部（部门）维度模块（2026-09-05 新增）
// 用途：识别用户询问的部门（二部/一部/…），判断某船是否属于该部门，供 ships 模块过滤回答范围。
// 数据源: data/fleet_dept.json（key=部门，value=船名短词列表；仅"二部"已配置，其余待 Shawn 提供清单）

let deptData = null;
let deptLoadAttempted = false;

function getPagesUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function ensureDeptData(request) {
  if (deptData) return deptData;
  if (deptLoadAttempted) return null;
  deptLoadAttempted = true;
  try {
    const baseUrl = getPagesUrl(request);
    const resp = await fetch(`${baseUrl}/data/fleet_dept.json`);
    if (resp.ok) {
      deptData = await resp.json();
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

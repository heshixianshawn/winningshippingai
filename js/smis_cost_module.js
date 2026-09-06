/* ============================================================================
 * smis_cost_module.js — 费用溯源查询模块（独立单文件，零外部依赖）
 * 集成到智能平台单页 index.html：技术模块 → 费用溯源 入口卡片 → overlay 面板。
 *
 * - 数据：data/smis_cost_trace.json  （1571 条费用明细）
 *         data/smis_cost_monthly.json（19 船月度三条线金额）
 * - 结构：IIFE 包裹，不污染全局（仅暴露 window.loadSmisCostOverlay 供主脚本调用）
 * - 样式：复用站内 CSS 变量与 .panel-placeholder/.ship-grid/.entry-card 等类；
 *         本文件内补充少量作用域样式（前缀 constp-），不影响其它模块。
 * 创建：2026-09-06（费用溯源模块首次部署）
 * ==========================================================================*/
(function () {
  'use strict';

  var TRACE_URL = 'data/smis_cost_trace.json?_t=' + Date.now();
  var MONTHLY_URL = 'data/smis_cost_monthly.json?_t=' + Date.now();

  // 站内 CSS 变量名假设：--card-bg/--border/--primary/--primary-light/--text/--text-light
  // （如缺失则走 fallback 字面量）

  /* ---------------- 缓存（闭包内私有） ---------------- */
  var traceCache = null;   // {updated,count,rows:[]}
  var monthlyCache = null; // {updated,ships:{}}
  var lastResult = [];     // 最近一次检索结果（供导出CSV）
  var sortKey = 'date';    // date|type|ship|vendor|amount
  var sortDir = -1;        // 1 升序, -1 降序

  var MONTH_LINES = { repair: '修船', parts: '备件', store: '物资' };

  /* ---------------- 小工具 ---------------- */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  function fmtMoney(v) {
    var n = num(v);
    var neg = n < 0;
    var abs = Math.abs(n);
    var s = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return (neg ? '-' : '') + s;
  }
  function fullText(r) {
    // 聚合所有字段做关键词命中（可搜设备/物料名、科目、船名、厂商、单号、类别、日期）
    return [r.date, r.type, r.ship, r.cat, r.item, r.vendor, r.bill, r.currency]
      .filter(Boolean).join(' ').toLowerCase();
  }
  function monthOf(d) {
    if (!d) return '';
    var m = String(d).match(/(\d{4})-(\d{2})/);
    return m ? (m[1] + '-' + m[2]) : '';
  }

  /* ---------------- 主入口：渲染整个 overlay 面板 ---------------- */
  window.loadSmisCostOverlay = function () {
    var contentEl = document.getElementById('overlayContent');
    if (!contentEl) return;
    contentEl.innerHTML =
      '<div class="panel-placeholder constp"><style id="constp-style">' + STYLE_CSS() + '</style>' +
      '<h4>⏳ 正在加载费用数据…</h4></div>';

    var loads = [
      fetch(TRACE_URL).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) { traceCache = j; })
        .catch(function (e) { throw e; }),
      fetch(MONTHLY_URL).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (j) { monthlyCache = j; })
        .catch(function (e) { return e; }) // 月度表可缺省，不阻塞溯源
    ];

    Promise.all(loads).then(function () {
      if (!traceCache || !traceCache.rows || !traceCache.rows.length) {
        contentEl.innerHTML = divPlaceholder(
          '费用数据加载失败',
          '请确认 data/smis_cost_trace.json 可访问，稍后重试。'
        ) + '<style>' + STYLE_CSS() + '</style>';
        return;
      }
      renderShell(contentEl);
    }).catch(function (err) {
      contentEl.innerHTML = divPlaceholder(
        '⚠️ 数据加载失败',
        '无法读取费用数据（' + esc((err && err.message) || '网络异常') + '）。请检查网络后重试。'
      ) + '<style>' + STYLE_CSS() + '</style>';
    });
  };

  function divPlaceholder(title, sub) {
    return '<div class="panel-placeholder constp constp-panel">' +
      '<style>' + STYLE_CSS() + '</style>' +
      '<h4>' + esc(title) + '</h4>' +
      (sub ? '<p style="font-size:12px;color:var(--text-light,#888)">' + esc(sub) + '</p>' : '') +
      '</div>';
  }

  /* ---------------- 面板骨架：页签 + 两块区 ---------------- */
  function renderShell(el) {
    var rows = traceCache.rows;
    var ships = uniqueSorted(rows.map(function (r) { return r.ship; })); // 19 船
    var types = uniqueSorted(rows.map(function (r) { return r.type; }));  // 修船费用/备件/物资
    var months = uniqueSorted(rows.map(function (r) { return monthOf(r.date); }).filter(Boolean), true); // 降序 2026-09..2026-01

    var h = '<div class="constp constp-panel">';
    h += '<style>' + STYLE_CSS() + '</style>';

    // 统计条
    h += '<div class="ship-stat-bar constp-bar">' +
      '<span class="ship-stat total">💰 费用溯源 · 共 ' + rows.length + ' 条明细</span>' +
      '<span class="ship-stat">🚢 ' + ships.length + ' 艘</span>' +
      (traceCache.updated ? '<span class="ship-stat">更新 ' + esc(traceCache.updated) + '</span>' : '') +
      '</div>';

    // 页签
    h += '<div class="constp-tabs">' +
      '<button type="button" class="constp-tab constp-active" data-mode="trace">|> 溯源检索</button>' +
      '<button type="button" class="constp-tab" data-mode="monthly">📊 月度统计</button>' +
      '</div>';

    h += '<div id="constp-trace" class="constp-body"></div>';
    h += '<div id="constp-monthly" class="constp-body" style="display:none"></div>';
    h += '</div>';
    el.innerHTML = h;

    el.querySelector('.constp-tabs').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.constp-tab');
      if (!btn) return;
      el.querySelectorAll('.constp-tab').forEach(function (b) { b.classList.toggle('constp-active', b === btn); });
      var mode = btn.getAttribute('data-mode');
      var trace = el.querySelector('#constp-trace');
      var monthly = el.querySelector('#constp-monthly');
      trace.style.display = mode === 'trace' ? '' : 'none';
      monthly.style.display = mode === 'monthly' ? '' : 'none';
      if (mode === 'trace') renderTraceForm(el, rows, ships, types, months);
      else renderMonthly(el);
    });

    // 默认展示溯源检索
    renderTraceForm(el, rows, ships, types, months);
  }

  /* ============================================================
   * 区块 1：溯源检索
   * ==========================================================*/
  function renderTraceForm(el, rows, ships, types, months) {
    var box = el.querySelector('#constp-trace');
    if (!box) return;

    var h = '<div class="constp-filters">';

    h += '<label class="constp-lab">关键词</label>';
    h += '<input id="constp-q" class="constp-q" type="text" placeholder="设备·物料·科目·船名·厂商·单号（空格=多词AND）" value="">';

    h += '<select id="constp-f-type" class="constp-sel">';
    h += '<option value="">类型：全部</option>' + types.map(function (t) {
      return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join('');
    h += '</select>';

    h += '<select id="constp-f-ship" class="constp-sel">';
    h += '<option value="">船名：全部</option>' + ships.map(function (s) {
      return '<option value="' + esc(s) + '">' + esc(s) + '</option>';
    }).join('');
    h += '</select>';

    h += '<select id="constp-f-month" class="constp-sel">';
    h += '<option value="">月份：全部</option>' + months.map(function (m) {
      return '<option value="' + m + '">' + m + '</option>';
    }).join('');
    h += '</select>';

    h += '<button type="button" id="constp-go" class="constp-btn">🔍 查询</button>';
    h += '<button type="button" id="constp-reset" class="constp-btn constp-ghost">重置</button>';
    h += '</div>';

    h += '<div class="constp-sub">' +
      '提示：设备名可含代码（如 压载水 / EPIRB / 空冷器 / 舱盖 / 胶条）；点表头「类型 / 船 / 厂商 / 金额 / 日期」可排序。' +
      '</div>';

    h += '<div id="constp-result"></div>';
    box.innerHTML = h;

    var qEl = box.querySelector('#constp-q');
    box.querySelector('#constp-go').addEventListener('click', function () { runTrace(); });
    box.querySelector('#constp-reset').addEventListener('click', function () {
      qEl.value = '';
      box.querySelector('#constp-f-type').value = '';
      box.querySelector('#constp-f-ship').value = '';
      box.querySelector('#constp-f-month').value = '';
      sortKey = 'date'; sortDir = -1;
      runTrace();
    });
    qEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') runTrace(); });

    runTraceWith(el);
  }

  // 闭包持有当前 box，避免 renderShell 后 target 丢失
  function runTraceWith(el) {
    window._constpDo = function () {
      var box = el.querySelector('#constp-trace');
      var raw = (box.querySelector('#constp-q').value || '').trim();
      var type = box.querySelector('#constp-f-type').value;
      var ship = box.querySelector('#constp-f-ship').value;
      var monthSel = box.querySelector('#constp-f-month').value;

      var needed = raw ? raw.split(/\s+/).filter(Boolean).map(function (w) { return w.toLowerCase(); }) : [];
      var rows = traceCache.rows.filter(function (r) {
        var t = fullText(r);
        for (var i = 0; i < needed.length; i++) {
          if (t.indexOf(needed[i]) < 0) return false;
        }
        if (type && r.type !== type) return false;
        if (ship && r.ship !== ship) return false;
        if (monthSel && monthOf(r.date) !== monthSel) return false;
        return true;
      });
      // 排序
      rows = rows.slice().sort(comparator());
      lastResult = rows;
      renderTraceResult(el, rows);
    };
    runTrace();
  }

  function runTrace() {
    if (typeof window._constpDo === 'function') window._constpDo();
    else { /* first run target not yet fired */ }
  }
  // 暴露给可能的外部调用（可选）
  window.runTrace = runTrace;

  function comparator() {
    return function (a, b) {
      if (sortKey === 'amount') { return (num(a.amount) - num(b.amount)) * sortDir; }
      if (sortKey === 'date') { return String(a.date).localeCompare(String(b.date)) * sortDir; }
      var sx = String(a[sortKey] || '').toUpperCase();
      var sy = String(b[sortKey] || '').toUpperCase();
      return sx.localeCompare(sy) * sortDir;
    };
  }

  function sortHeader(key, label) {
    var arrow = '';
    if (sortKey === key) arrow = sortDir < 0 ? ' ▼' : ' ▲';
    return '<th class="constp-sorthd" data-k="' + key + '" title="点击排序">' + label + arrow + '</th>';
  }

  function renderTraceResult(el, rows) {
    var res = el.querySelector('#constp-result');
    var money = rows.reduce(function (acc, r) { return acc + num(r.amount); }, 0);

    if (!rows.length) {
      res.innerHTML = '<div class="panel-placeholder constp-empty"><style>' + STYLE_CSS() + '</style>' +
        '<h4>🔍 未找到匹配记录</h4>' +
        '<p>试试更短关键词，如：EPIRB / 空冷器 / 压载水 / 舱盖 / 胶条</p>' +
        '</div>';
      return;
    }

    var h = '<div class="ship-stat-bar constp-foot"><span class="ship-stat total">共 ' + rows.length +
      ' 条</span><span class="ship-stat">金额(本币约值) 合计：<b>' + fmtMoney(money) + '</b></span></div>';
    h += '<div class="constp-actions">' +
      '<button type="button" class="constp-btn constp-export" id="constp-export">⬇ 导出CSV</button>' +
      '<span class="constp-note">注：各行 Currency 字段不一（USD/JPY/CNY…），合计为本币约值口径。</span>' +
      '</div>';

    h += '<div class="constp-tablewrap"><table class="constp-table">';
    h += '<thead><tr>';
    h += sortHeader('date', '日期');
    h += sortHeader('type', '类型');
    h += sortHeader('ship', '船名');
    h += '<th>科目 / 设备类别</th>';
    h += '<th>设备 / 物料名</th>';
    h += sortHeader('vendor', '厂商');
    h += '<th>单号</th>';
    h += sortHeader('amount', '金额');
    h += '<th>币种</th>';
    h += '</tr></thead><tbody>';

    rows.forEach(function (r) {
      h += '<tr><td>' + esc(r.date) + '</td>' +
        '<td><span class="constp-chip constp-ct-' + chipCls(r.type) + '">' + esc(r.type) + '</span></td>' +
        '<td>' + esc(r.ship) + '</td>' +
        '<td>' + esc(r.cat) + '</td>' +
        '<td class="constp-item">' + esc(r.item) + '</td>' +
        '<td>' + esc(r.vendor) + '</td>' +
        '<td class="constp-bill">' + esc(r.bill) + '</td>' +
        '<td class="constp-r">' + fmtMoney(r.amount) + '</td>' +
        '<td>' + esc(r.currency) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    res.innerHTML = h;

    // 排序点击委派
    res.querySelectorAll('.constp-sorthd').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = (k === 'date' || k === 'amount') ? -1 : 1; }
        // 触发重新过滤排序
        window._constpDo();
      });
    });

    var btn = res.querySelector('#constp-export');
    if (btn) btn.addEventListener('click', function () { exportCSV(rows, money); });
  }

  function chipCls(type) {
    if (type === '修船费用') return 'repair';
    if (type === '备件') return 'part';
    if (type === '物资') return 'store';
    return 'other';
  }

  /* ---------------- CSV 导出（UTF-8 BOM） ---------------- */
  function exportCSV(rows, money) {
    var heads = ['日期', '类型', '船名', '科目/设备类别', '设备/物料名', '厂商', '单号', '金额(本币约值)', '币种'];
    var lines = [heads];
    rows.forEach(function (r) {
      lines.push([r.date, r.type, r.ship, r.cat, r.item, r.vendor, r.bill, r.amount, r.currency]);
    });
    lines.push(['', '', '', '', '', '', '合计', money, '']);
    var csv = lines.map(function (row) {
      return row.map(function (c) {
        var s = (c === null || c === undefined) ? '' : String(c);
        if (/[",\n\t]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
      }).join(',');
    }).join('\r\n');
    // UTF-8 BOM 便于 Excel 直接识别中文
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = 'smis_cost_溯源_' + stamp() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 800);
  }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  /* ============================================================
   * 区块 2：月度统计（19 船 × 1~12 月，分三条线）
   * ==========================================================*/
  function renderMonthly(rootEl) {
    var box = rootEl.querySelector('#constp-monthly');
    if (!box) return;

    var ships = monthlyCache && monthlyCache.ships ? monthlyCache.ships : {};
    var shipList = Object.keys(ships).sort();
    if (!shipList.length) {
      box.innerHTML = divPlaceholder('暂无月度统计', '未加载到 data/smis_cost_monthly.json。');
      return;
    }
    // 该船出现过的最早/最晚月份（取所有船 key 的月份范围，若有数据跨年份，则显示实际出现月份）
    // 简化：列固定 1..12，行取各船 1..12 月该线数值。

    var line = '修船'; // 默认显示修船线
    var h = '<div class="constp-note">航线分组：修船费用 / 备件 / 物资（单位：本币，月度在账约值）。</div>';
    h += '<div class="constp-tabs constp-lines">' +
      '<button type="button" class="constp-tab constp-active" data-line="修船">🛠 修船</button>' +
      '<button type="button" class="constp-tab" data-line="备件">🧩 备件</button>' +
      '<button type="button" class="constp-tab" data-line="物资">📦 物资</button>' +
      '</div>';
    h += '<div id="constp-monthly-tbl" class="constp-tablewrap"></div>';
    h += '<div class="constp-foot-note">* 值为空表示该月无对应在账记录；key 形如「修船3」代表该船 3 月修船金额。</div>';
    box.innerHTML = h;
    box.querySelector('.constp-lines').addEventListener('click', function (ev) {
      var t = ev.target.closest('.constp-tab');
      if (!t) return;
      box.querySelectorAll('.constp-lines .constp-tab').forEach(function (b) { b.classList.toggle('constp-active', b === t); });
      renderMonthlyTable(box, shipList, t.getAttribute('data-line'));
    });
    renderMonthlyTable(box, shipList, line);
  }

  function renderMonthlyTable(box, shipList, line) {
    var wrap = box.querySelector('#constp-monthly-tbl');
    var monthly = monthlyCache && monthlyCache.ships ? monthlyCache.ships : {};
    var months = [];
    for (var m = 1; m <= 12; m++) months.push(m);

    // 列合计
    var colSum = {};
    shipList.forEach(function (ship) {
      var rec = monthly[ship] || {};
      months.forEach(function (m) {
        var v = num(rec[line + m]);
        colSum[m] = (colSum[m] || 0) + v;
      });
    });
    var grand = months.reduce(function (a, m) { return a + (colSum[m] || 0); }, 0);

    var h = '<table class="constp-table constp-mt">';
    h += '<thead><tr><th>船名</th>';
    months.forEach(function (m) { h += '<th>' + m + '月</th>'; });
    h += '<th>合计</th></tr></thead><tbody>';

    shipList.forEach(function (ship) {
      var rec = monthly[ship] || {};
      var sTotal = months.reduce(function (a, m) { return a + num(rec[line + m]); }, 0);
      h += '<tr><td class="constp-shipnm">' + esc(ship) + '</td>';
      months.forEach(function (m) {
        var v = rec[line + m];
        h += '<td class="constp-r">' + (v === undefined ? '—' : fmtMoney(v)) + '</td>';
      });
      h += '<td class="constp-r constp-strong">' + fmtMoney(sTotal) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td class="constp-shipnm"><b>合计(' + line + ')</b></td>';
    months.forEach(function (m) {
      h += '<td class="constp-r constp-strong">' + fmtMoney(colSum[m] || 0) + '</td>';
    });
    h += '<td class="constp-r constp-strong">' + fmtMoney(grand) + '</td></tr></tfoot>';
    h += '</table>';
    wrap.innerHTML = h;
  }

  /* ============================================================
   * 通用 helpers
   * ==========================================================*/
  function uniqueSorted(arr, desc) {
    var out = [];
    arr.forEach(function (v) {
      if (v && out.indexOf(v) < 0) out.push(v);
    });
    out.sort(function (a, b) { var r = String(a).localeCompare(String(b)); return desc ? -r : r; });
    return out;
  }
  /* ---------------- 作用域样式 ---------------- */
  function STYLE_CSS() {
    return [
      '.constp{font-family:inherit;max-width:100%}',
      '.constp .constp-panel{padding:2px 2px 10px}',
      '.constp-bar{margin-bottom:10px}',
      '.constp-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 12px}',
      '.constp-tab{padding:6px 16px;border-radius:18px;border:1px solid var(--border,#dee2e6);background:#fff;color:var(--text,#222);font-size:13px;cursor:pointer;transition:all .15s;font-weight:600}',
      '.constp-tab:hover{border-color:var(--primary,#1f6f8b)}',
      '.constp-tab.constp-active{background:var(--primary,#1f6f8b);color:#fff;border-color:var(--primary,#1f6f8b)}',
      '.constp-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:6px}',
      '.constp-lab{font-size:12px;color:var(--text-light,#888);font-weight:600}',
      '.constp-q{flex:1 1 240px;min-width:200px;padding:8px 12px;border:1px solid var(--border,#dee2e6);border-radius:6px;font-size:13px;outline:0}',
      '.constp-q:focus{border-color:var(--primary,#1f6f8b)}',
      '.constp-sel{padding:8px 10px;border:1px solid var(--border,#dee2e6);border-radius:6px;font-size:13px;background:#fff;max-width:210px;outline:0}',
      '.constp-btn{padding:8px 18px;border:0;border-radius:6px;background:var(--primary,#1f6f8b);color:#fff;font-size:13px;cursor:pointer;font-weight:600}',
      '.constp-btn:hover{filter:brightness(1.05)}',
      '.constp-btn.constp-ghost{background:#fff;color:var(--text,#333);border:1px solid var(--border,#dee2e6)}',
      '.constp-btn.constp-export{background:#2c7a4b}',
      '.constp-sub{font-size:11px;color:#a67c00;background:#fff8e1;border-left:3px solid #f0c040;padding:4px 8px;border-radius:3px;margin:4px 0 12px}',
      '.constp-actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0}',
      '.constp-note{font-size:11px;color:var(--text-light,#888)}',
      '.constp-foot-note{font-size:11px;color:var(--text-light,#999);margin-top:6px}',
      '.constp-empty h4{color:var(--text,#333)}',
      '.constp-tablewrap{overflow-x:auto;border:1px solid var(--border,#e3e6ea);border-radius:8px;max-height:62vh;overflow-y:auto}',
      '.constp-table{border-collapse:collapse;width:100%;font-size:12px;background:#fff}',
      '.constp-table thead th{position:sticky;top:0;background:#f2f5f7;z-index:2;padding:7px 8px;text-align:left;white-space:nowrap;border-bottom:2px solid var(--border,#dee2e6);cursor:default}',
      '.constp-table thead th.constp-sorthd{cursor:pointer}',
      '.constp-table thead th.constp-sorthd:hover{color:var(--primary,#1f6f8b)}',
      '.constp-table td{padding:6px 8px;border-bottom:1px solid #eef1f3;white-space:normal;vertical-align:top}',
      '.constp-table tr:hover td{background:#f7fafc}',
      '.constp-r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '.constp-item{max-width:240px}',
      '.constp-bill{white-space:nowrap}',
      '.constp-chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;white-space:nowrap}',
      '.constp-ct-repair{background:#fdecea;color:#c0392b}',
      '.constp-ct-part{background:#e8f0fe;color:#1a63b0}',
      '.constp-ct-store{background:#e8f7ee;color:#1e7e46}',
      '.constp-ct-other{background:#f1f1f1;color:#666}',
      '.constp-mt .constp-shipnm{white-space:nowrap;font-weight:600}',
      '.constp-strong{font-weight:700}',
      '.constp-table tfoot td{background:#f7fafc;border-top:2px solid var(--border,#dee2e6);font-weight:700}',
      '@media (max-width:600px){.constp-filters{flex-direction:column;align-items:stretch}.constp-sel{max-width:100%}}'
    ].join('\n');
  }

  // 自检：保证无语法层面误用
  if (typeof module !== 'undefined' && module.exports) module.exports = { loadSmisCostOverlay: window.loadSmisCostOverlay };
})();

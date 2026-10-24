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
  var LINES_URL = 'data/smis_order_lines.json?_t=' + Date.now();   // P0：行级明细（按需加载）
  var REPAIR_URL = 'data/repair_items.json?_t=' + Date.now();      // P1：修理工项统计

  // 站内 CSS 变量名假设：--card-bg/--border/--primary/--primary-light/--text/--text-light
  // （如缺失则走 fallback 字面量）

  /* ---------------- 缓存（闭包内私有） ---------------- */
  var traceCache = null;   // {updated,count,rows:[]}
  var monthlyCache = null; // {updated,ships:{}}
  var linesCache = null;   // {bill|ship: {type,vendor,date,lines:[...]}}
  var repairCache = null;  // {coverage,items:[...]}
  var lastResult = [];     // 最近一次检索结果（供导出CSV）
  var sortKey = 'date';    // date|type|ship|vendor|amount|qty|unit_price
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
    // 聚合所有字段做关键词命中（含 说明/工作内容 与 备注——修船费大量信息只在说明里）
    return [r.date, r.type, r.ship, r.cat, r.item, r.vendor, r.bill, r.currency, r.desc, r.memo]
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
      '<button type="button" class="constp-tab" data-mode="agg">🔎 品名聚合</button>' +
      '<button type="button" class="constp-tab" data-mode="repair">🛠 修理工项</button>' +
      '<button type="button" class="constp-tab" data-mode="monthly">📊 月度统计</button>' +
      '</div>';

    h += '<div id="constp-trace" class="constp-body"></div>';
    h += '<div id="constp-agg" class="constp-body" style="display:none"></div>';
    h += '<div id="constp-repair" class="constp-body" style="display:none"></div>';
    h += '<div id="constp-monthly" class="constp-body" style="display:none"></div>';
    h += '</div>';
    el.innerHTML = h;

    el.querySelector('.constp-tabs').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.constp-tab');
      if (!btn) return;
      el.querySelectorAll('.constp-tab').forEach(function (b) { b.classList.toggle('constp-active', b === btn); });
      var mode = btn.getAttribute('data-mode');
      var trace = el.querySelector('#constp-trace');
      var agg = el.querySelector('#constp-agg');
      var repair = el.querySelector('#constp-repair');
      var monthly = el.querySelector('#constp-monthly');
      trace.style.display = mode === 'trace' ? '' : 'none';
      agg.style.display = mode === 'agg' ? '' : 'none';
      repair.style.display = mode === 'repair' ? '' : 'none';
      monthly.style.display = mode === 'monthly' ? '' : 'none';
      if (mode === 'trace') renderTraceForm(el, rows, ships, types, months);
      else if (mode === 'agg') renderAgg(el, rows, types, ships, months);
      else if (mode === 'repair') renderRepair(el);
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
    var vendors = uniqueSorted(rows.map(function (r) { return r.vendor; }).filter(Boolean));

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

    h += '<select id="constp-f-vendor" class="constp-sel constp-vendor-sel">';
    h += '<option value="">厂商：全部</option>' + vendors.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
    h += '</select>';

    h += '<button type="button" id="constp-go" class="constp-btn">🔍 查询</button>';
    h += '<button type="button" id="constp-reset" class="constp-btn constp-ghost">重置</button>';
    h += '</div>';

    h += '<div class="constp-sub">' +
      '提示：设备名可含代码（如 压载水 / EPIRB / 空冷器 / 舱盖 / 胶条）；' +
      '表头「日期 / 类型 / 船 / 厂商 / 金额 / 数量 / 均价」可排序；点任意一行看该单的件号级明细。' +
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
      var vsel = box.querySelector('#constp-f-vendor'); if (vsel) vsel.value = '';
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
      var vendorSel = (box.querySelector('#constp-f-vendor') || {}).value || '';
      window._constpTokens = raw ? raw.toLowerCase().split(/\s+/) : [];
      window._constpFilter = { type: type, ship: ship, month: monthSel, vendor: vendorSel };

      var needed = raw ? raw.split(/\s+/).filter(Boolean).map(function (w) { return w.toLowerCase(); }) : [];
      var rows = traceCache.rows.filter(function (r) {
        var t = fullText(r);
        for (var i = 0; i < needed.length; i++) {
          if (t.indexOf(needed[i]) < 0) return false;
        }
        if (type && r.type !== type) return false;
        if (ship && r.ship !== ship) return false;
        if (monthSel && monthOf(r.date) !== monthSel) return false;
        if (vendorSel && r.vendor !== vendorSel) return false;
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
      if (sortKey === 'qty') { return (num(a.qty) - num(b.qty)) * sortDir; }
      if (sortKey === 'unit_price') { return (num(a.unit_price) - num(b.unit_price)) * sortDir; }
      if (sortKey === 'date') { return String(a.date).localeCompare(String(b.date)) * sortDir; }
      var sx = String(a[sortKey] || '').toUpperCase();
      var sy = String(b[sortKey] || '').toUpperCase();
      return sx.localeCompare(sy) * sortDir;
    };
  }

  function sortHeader(key, label, cls) {
    var arrow = '';
    if (sortKey === key) arrow = sortDir < 0 ? ' ▼' : ' ▲';
    return '<th class="constp-sorthd' + (cls ? ' ' + cls : '') + '" data-k="' + key + '" title="点击排序">' + label + arrow + '</th>';
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
    h += sortHeader('amount', '金额', 'constp-r');
    h += sortHeader('qty', '数量', 'constp-r');
    h += sortHeader('unit_price', '均价', 'constp-r');
    h += '<th>币种</th>';
    h += '<th>说明 / 备注</th>';
    h += '</tr></thead><tbody>';

    var toks = window._constpTokens || [];
    function matchedLines(desc) {
      if (!toks.length) return null;
      var seg = String(desc || '').split('；');
      var out = seg.filter(function (x) {
        var l = x.toLowerCase();
        return toks.some(function (t) { return t && l.indexOf(t) >= 0; });
      });
      return out.length ? out : null;
    }
    var totalMatched = 0;
    rows.forEach(function (r) {
      var mm = matchedLines(r.desc);
      if (mm) totalMatched += mm.length;
      var descShow = mm ? mm.join('；') : shortDesc(r);
      if (mm && mm.length) descShow = '📌 匹配明细(' + mm.length + '行)：' + descShow;
      // 命中时：品名列只显示命中品名（去 数量/单价 后缀），避免整单900行淹没
      var itemShow = r.item;
      if (mm && mm.length) {
        var names = mm.map(function (seg) {
          var i = seg.indexOf(' 数量');
          return i > 0 ? seg.slice(0, i) : seg;
        });
        itemShow = names.join('；').slice(0, 160) + (names.length > 1 ? '…' : '');
      }
      h += '<tr class="constp-row" data-bill="' + esc(r.bill || '') + '" data-ship="' + esc(r.ship || '') + '">' +
        '<td>' + esc(r.date) + '</td>' +
        '<td><span class="constp-chip constp-ct-' + chipCls(r.type) + '">' + esc(r.type) + '</span></td>' +
        '<td>' + esc(r.ship) + '</td>' +
        '<td>' + esc(r.cat) + '</td>' +
        '<td class="constp-item">' + esc(itemShow) + '</td>' +
        '<td>' + esc(r.vendor) + '</td>' +
        '<td class="constp-bill">' + esc(r.bill) + '</td>' +
        '<td class="constp-r">' + fmtMoney(r.amount) + '</td>' +
        '<td class="constp-r">' + (r.qty ? (fmtQty(r.qty) + (r.uom ? ' ' + esc(r.uom) : '')) : '') + '</td>' +
        '<td class="constp-r">' + (r.unit_price ? fmtMoney(r.unit_price) : '') + '</td>' +
        '<td>' + esc(r.currency) + '</td>' +
        '<td class="constp-desc" title="' + esc(String(descShow).slice(0, 400)) + '">' + esc(descShow) + '</td></tr>';
    });
    if (toks.length) {
      var note = res.querySelector('.ship-stat.total');
      if (note) note.textContent = '共 ' + rows.length + ' 单（命中明细行 ' + totalMatched + ' 行）';
    }
    h += '</tbody></table></div>';
    h += '<div id="constp-detail" class="constp-detail"></div>';
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

    // P0：点行看件号级明细
    res.querySelectorAll('tr.constp-row').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var bill = tr.getAttribute('data-bill');
        var ship = tr.getAttribute('data-ship');
        var rec = rows.filter(function (x) { return String(x.bill) === bill && x.ship === ship; })[0];
        if (rec) showDetail(res, rec);
      });
    });
  }

  function fmtQty(v) {
    var n = num(v);
    if (!n) return '';
    return (Math.round(n * 1000) / 1000).toLocaleString('en-US');
  }

  /* ---------------- P0：单张定单的件号级明细 ---------------- */
  function showDetail(res, r) {
    var box = res.querySelector('#constp-detail');
    if (!box) return;
    if (r.type === '修船费用') {
      box.innerHTML = '<div class="constp-detail-card"><b>修船帐单 ' + esc(r.bill) + '</b>' +
        '<div class="constp-detail-grid">' +
        '<span>船：' + esc(r.ship) + '</span><span>科目：' + esc(r.cat) + '</span>' +
        '<span>厂商：' + esc(r.vendor) + '</span><span>港口：' + esc(r.port || '—') + '</span>' +
        '<span>费用日期：' + esc(r.date) + '</span><span>完工：' + esc(r.done_date || '—') + '</span>' +
        '</div>' +
        '<div class="constp-detail-desc">细目：' + esc(r.detail || '—') + '<br>说明：' + esc(r.desc || '—') + '</div>' +
        '<div class="constp-note">修船帐单目前只有科目级，无工项级明细（P1 建字典后补）</div>' +
        '<button type="button" class="constp-btn constp-ghost constp-close">收起</button></div>';
      box.querySelector('.constp-close').addEventListener('click', function () { box.innerHTML = ''; });
      box.scrollIntoView({ block: 'nearest' });
      return;
    }
    box.innerHTML = '<div class="constp-detail-card">⏳ 正在读取件号级明细…</div>';
    ensureLines().then(function (lines) {
      var key = String(r.bill) + '|' + r.ship;
      var hit = lines[key] || null;
      if (!hit && r.type === '物资') {
        // 物资定单的 _ship 可能与展示船名大小写不同，做一次宽松匹配
        var alt = Object.keys(lines).filter(function (k) {
          return k.split('|')[0] === String(r.bill);
        })[0];
        if (alt) hit = lines[alt];
      }
      if (!hit || !hit.lines || !hit.lines.length) {
        box.innerHTML = '<div class="constp-detail-card">该单没有可用的件号级明细（可能未展开或来源为空）' +
          '<br><span class="constp-note">' + esc(shortDesc(r)) + '</span>' +
          '<button type="button" class="constp-btn constp-ghost constp-close">收起</button></div>';
        box.querySelector('.constp-close').addEventListener('click', function () { box.innerHTML = ''; });
        return;
      }
      var hh = '<div class="constp-detail-card"><b>' + esc(r.type) + ' ' + esc(r.bill) + '</b>' +
        ' <span class="constp-note">' + esc(r.vendor) + ' · ' + esc(r.date) + '</span>' +
        '<div class="constp-tablewrap"><table class="constp-table constp-lines">' +
        '<thead><tr><th>#</th><th>件号</th><th>品名</th><th>型号/规格</th><th>数量</th><th>单位</th><th>单价</th><th>金额</th><th>备注</th></tr></thead><tbody>';
      hit.lines.forEach(function (L, i) {
        hh += '<tr><td>' + (i + 1) + '</td><td>' + esc(L.p) + '</td><td>' + esc(L.n) + '</td>' +
          '<td>' + esc(L.s) + '</td><td class="constp-r">' + (L.q === null || L.q === undefined ? '' : fmtQty(L.q)) + '</td>' +
          '<td>' + esc(L.u) + '</td><td class="constp-r">' + (L.pr === null || L.pr === undefined ? '' : fmtMoney(L.pr)) + '</td>' +
          '<td class="constp-r">' + (L.a === null || L.a === undefined ? '' : fmtMoney(L.a)) + '</td>' +
          '<td class="constp-desc">' + esc(L.r) + '</td></tr>';
      });
      hh += '</tbody></table></div>' +
        '<button type="button" class="constp-btn constp-ghost constp-close">收起</button></div>';
      box.innerHTML = hh;
      box.querySelector('.constp-close').addEventListener('click', function () { box.innerHTML = ''; });
      box.scrollIntoView({ block: 'nearest' });
    }).catch(function () {
      box.innerHTML = '<div class="constp-detail-card">明细文件加载失败（data/smis_order_lines.json）</div>';
    });
  }

  function ensureLines() {
    if (linesCache) return Promise.resolve(linesCache);
    return fetch(LINES_URL).then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { linesCache = j || {}; return linesCache; });
  }

  function ensureRepair() {
    if (repairCache) return Promise.resolve(repairCache);
    return fetch(REPAIR_URL).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { repairCache = j; return repairCache; });
  }

  /* ============================================================
   * P1：修理工项（船厂报价/结算清单，8 船 5 厂）
   * ==========================================================*/
  function renderRepair(el) {
    var box = el.querySelector('#constp-repair');
    if (!box) return;
    box.innerHTML = divPlaceholder('⏳ 正在加载修理工项…', '数据来自修船报价/结算清单');
    ensureRepair().then(function (d) {
      if (!d || !d.items || !d.items.length) {
        box.innerHTML = divPlaceholder('修理工项数据缺失', '请确认 data/repair_items.json 可访问');
        return;
      }
      var items = d.items.slice();
      var cov = d.coverage || {};
      var ships = uniqueSorted(items.reduce(function (a, x) {
        return a.concat((x.by_ship || []).map(function (y) { return y[0]; }));
      }, []));
      var yards = uniqueSorted(items.reduce(function (a, x) {
        return a.concat((x.by_yard || []).map(function (y) { return y[0]; }));
      }, []));

      var h = '<div class="ship-stat-bar constp-foot">' +
        '<span class="ship-stat total">🛠 修理工项 · ' + items.length + ' 项</span>' +
        '<span class="ship-stat">报价/结算行 ' + (cov.rows_used || 0).toLocaleString('en-US') + '</span>' +
        '<span class="ship-stat">标准工项覆盖 ' + (100 - (cov.unclassified_pct || 0)).toFixed(1) + '%</span>' +
        '<span class="ship-stat">未分类 ' + (cov.unclassified_pct || 0) + '%</span>' +
        '</div>';
      h += '<div class="constp-sub">口径：船厂报价 / 船东回盘 / 结算清单，同一(船,厂)同一条工作行只取一档（结算&gt;报价），已排除汇总行与物料订单。'
        + '「L1」= 清单自带标准工项；「L2」= 规则归并的类别。<b>修理费用帐单</b>仍只有科目级，不含工项。</div>';

      h += '<div class="constp-filters">';
      h += '<label class="constp-lab">工项关键词</label>';
      h += '<input id="constp-r-q" class="constp-q" type="text" placeholder="如 喷砂 / 舱盖 / 冷却水 / 脚手架">';
      h += '<select id="constp-r-ship" class="constp-sel"><option value="">船名：全部</option>' +
        ships.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') + '</select>';
      h += '<select id="constp-r-yard" class="constp-sel"><option value="">船厂：全部</option>' +
        yards.map(function (y) { return '<option value="' + esc(y) + '">' + esc(y) + '</option>'; }).join('') + '</select>';
      h += '<select id="constp-r-level" class="constp-sel">' +
        '<option value="">层级：全部</option><option value="1">L1 标准工项</option><option value="2">L2 类别</option></select>';
      h += '<label class="constp-lab"><input type="checkbox" id="constp-r-uncl"> 含未分类</label>';
      h += '<button type="button" id="constp-r-go" class="constp-btn">🔍 汇总</button>';
      h += '</div>';
      h += '<div id="constp-r-result"></div>';
      box.innerHTML = h;

      function run() {
        var q = (box.querySelector('#constp-r-q').value || '').trim().toLowerCase();
        var sh = box.querySelector('#constp-r-ship').value;
        var yd = box.querySelector('#constp-r-yard').value;
        var lv = box.querySelector('#constp-r-level').value;
        var showUncl = box.querySelector('#constp-r-uncl').checked;
        var list = items.filter(function (x) {
          if (!showUncl && x.item === '其他/未分类') return false;
          if (q && String(x.item).toLowerCase().indexOf(q) < 0) return false;
          if (lv && String(x.level) !== lv) return false;
          if (sh && !(x.by_ship || []).some(function (y) { return y[0] === sh; })) return false;
          if (yd && !(x.by_yard || []).some(function (y) { return y[0] === yd; })) return false;
          return true;
        });
        var res = box.querySelector('#constp-r-result');
        if (!list.length) { res.innerHTML = '<div class="panel-placeholder constp-empty">没有匹配的工项</div>'; return; }
        var total = list.reduce(function (a, x) { return a + (x.amount || 0); }, 0);
        var hh = '<div class="ship-stat-bar constp-foot"><span class="ship-stat total">共 ' + list.length +
          ' 项</span><span class="ship-stat">金额合计：<b>' + fmtMoney(total) + '</b>（清单币种）</span></div>';
        hh += '<div class="constp-tablewrap"><table class="constp-table"><thead><tr>' +
          '<th>工项</th><th>层级</th><th>类别</th>' +
          '<th class="constp-r">涉及船数</th><th class="constp-r">涉及厂数</th><th class="constp-r">条数</th>' +
          '<th class="constp-r">金额</th><th class="constp-r">均价</th><th class="constp-r">单价区间</th>' +
          '<th>主要船厂</th></tr></thead><tbody>';
        list.forEach(function (x, i) {
          var topYard = (x.by_yard || []).slice(0, 2).map(function (y) { return y[0]; }).join(' / ');
          hh += '<tr class="constp-row constp-rrow" data-i="' + i + '">' +
            '<td class="constp-item">' + esc(x.item) + '</td>' +
            '<td><span class="constp-chip constp-ct-' + (x.level === 1 ? 'part' : 'store') + '">L' + x.level + '</span></td>' +
            '<td>' + esc(x.cat || '') + '</td>' +
            '<td class="constp-r">' + x.ships + '</td>' +
            '<td class="constp-r">' + x.yards + '</td>' +
            '<td class="constp-r">' + x.n + '</td>' +
            '<td class="constp-r">' + fmtMoney(x.amount) + '</td>' +
            '<td class="constp-r">' + (x.avg_price ? fmtMoney(x.avg_price) : '') + '</td>' +
            '<td class="constp-r">' + (x.min_price ? (fmtMoney(x.min_price) + ' ~ ' + fmtMoney(x.max_price)) : '') + '</td>' +
            '<td class="constp-vend">' + esc(topYard) + '</td></tr>';
        });
        hh += '</tbody></table></div><div id="constp-r-detail" class="constp-detail"></div>';
        res.innerHTML = hh;

        res.querySelectorAll('tr.constp-rrow').forEach(function (tr) {
          tr.addEventListener('click', function () {
            var x = list[+tr.getAttribute('data-i')];
            var det = res.querySelector('#constp-r-detail');
            var dh = '<div class="constp-detail-card"><b>🛠 ' + esc(x.item) + '</b>' +
              ' <span class="constp-note">L' + x.level + ' · ' + esc(x.cat || '') + ' · 共 ' + x.n + ' 条</span>';
            dh += '<div class="constp-detail-grid"><span>涉及船：' + x.ships + ' 艘</span><span>涉及厂：' + x.yards +
              ' 家</span><span>金额：' + fmtMoney(x.amount) + '</span><span>均价：' +
              (x.avg_price ? fmtMoney(x.avg_price) : '—') + '</span>' +
              (x.qty ? '<span>数量合计：' + fmtQty(x.qty) + ' ' + esc(x.uom || '') + '</span>' : '') + '</div>';
            dh += '<div class="constp-tablewrap"><table class="constp-table constp-lines"><thead><tr>' +
              '<th>船厂</th><th class="constp-r">条数</th><th class="constp-r">金额</th><th class="constp-r">条均</th></tr></thead><tbody>';
            (x.by_yard || []).forEach(function (y) {
              dh += '<tr><td>' + esc(y[0]) + '</td><td class="constp-r">' + y[1] + '</td>' +
                '<td class="constp-r">' + fmtMoney(y[2]) + '</td><td class="constp-r">' + (y[3] != null ? fmtMoney(y[3]) : '') + '</td></tr>';
            });
            dh += '</tbody></table></div>';
            dh += '<div class="constp-tablewrap"><table class="constp-table constp-lines"><thead><tr>' +
              '<th>船舶</th><th class="constp-r">条数</th><th class="constp-r">金额</th></tr></thead><tbody>';
            (x.by_ship || []).forEach(function (s) {
              dh += '<tr><td>' + esc(s[0]) + '</td><td class="constp-r">' + s[1] + '</td><td class="constp-r">' + fmtMoney(s[2]) + '</td></tr>';
            });
            dh += '</tbody></table></div>';
            if (x.samples && x.samples.length) {
              dh += '<div class="constp-detail-desc">原文样例：<br>' + x.samples.map(function (s) { return '· ' + esc(s); }).join('<br>') + '</div>';
            }
            dh += '<button type="button" class="constp-btn constp-ghost constp-close">收起</button></div>';
            det.innerHTML = dh;
            det.querySelector('.constp-close').addEventListener('click', function () { det.innerHTML = ''; });
            det.scrollIntoView({ block: 'nearest' });
          });
        });
      }

      box.querySelector('#constp-r-go').addEventListener('click', run);
      box.querySelector('#constp-r-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
      box.querySelector('#constp-r-uncl').addEventListener('change', run);
      run();
    }).catch(function () {
      box.innerHTML = divPlaceholder('修理工项数据加载失败', '请确认 data/repair_items.json 可访问');
    });
  }

  /* ============================================================
   * P0 新增：品名聚合（跨船 / 跨厂 / 数量 / 均价）
   * 数据源：smis_order_lines.json（备件·物资逐行）+ trace 的修船帐单
   * ==========================================================*/
  function renderAgg(el, rows, types, ships, months) {
    var box = el.querySelector('#constp-agg');
    if (!box) return;
    box.innerHTML = divPlaceholder('⏳ 正在汇总品名…', '首次打开需加载行级明细');

    ensureLines().then(function (lines) {
      var entries = [];
      Object.keys(lines).forEach(function (k) {
        var rec = lines[k] || {};
        var ship = String(k).split('|')[1] || '';
        (rec.lines || []).forEach(function (L) {
          var nm = String(L.n || '').trim();
          if (!nm) return;
          entries.push({
            name: nm, spec: L.s || '', ship: ship, type: rec.type || '',
            vendor: rec.vendor || '', date: rec.date || '',
            qty: num(L.q), uom: L.u || '', price: L.pr, amount: num(L.a)
          });
        });
      });
      rows.forEach(function (r) {
        if (r.type !== '修船费用') return;
        var nm = r.cat || '未分类';
        if (r.detail) nm += ' · ' + String(r.detail).slice(0, 30);
        entries.push({
          name: nm, spec: '', ship: r.ship, type: '修船费用',
          vendor: r.vendor || '', date: r.date || '',
          qty: 0, uom: '', price: null, amount: num(r.amount)
        });
      });

      var vendors = uniqueSorted(entries.map(function (e) { return e.vendor; }).filter(Boolean));

      var h = '<div class="constp-filters">';
      h += '<label class="constp-lab">品名关键词</label>';
      h += '<input id="constp-a-q" class="constp-q" type="text" placeholder="如 安全帽 / 密封圈 / 高压淡水冲洗">';
      h += '<select id="constp-a-type" class="constp-sel"><option value="">类型：全部</option>' +
        types.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('') + '</select>';
      h += '<select id="constp-a-ship" class="constp-sel"><option value="">船名：全部</option>' +
        ships.map(function (s) { return '<option value="' + esc(s) + '">' + esc(s) + '</option>'; }).join('') + '</select>';
      h += '<select id="constp-a-month" class="constp-sel"><option value="">月份：全部</option>' +
        months.map(function (m) { return '<option value="' + m + '">' + m + '</option>'; }).join('') + '</select>';
      h += '<select id="constp-a-vendor" class="constp-sel constp-vendor-sel"><option value="">厂商：全部</option>' +
        vendors.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('') + '</select>';
      h += '<button type="button" id="constp-a-go" class="constp-btn">🔍 汇总</button>';
      h += '</div>';
      h += '<div class="constp-sub">按「品名」归并同一物料/备件在各船、各厂的价格与数量；修船按「科目·细目」归并（工项字典完成前的过渡口径）。点行可跳回明细。</div>';
      h += '<div id="constp-a-result"></div>';
      box.innerHTML = h;

      function runAgg() {
        var q = (box.querySelector('#constp-a-q').value || '').trim().toLowerCase();
        var ty = box.querySelector('#constp-a-type').value;
        var sh = box.querySelector('#constp-a-ship').value;
        var mo = box.querySelector('#constp-a-month').value;
        var ve = box.querySelector('#constp-a-vendor').value;

        var groups = {};
        entries.forEach(function (e) {
          if (q && String(e.name).toLowerCase().indexOf(q) < 0) return;
          if (ty && e.type !== ty) return;
          if (sh && e.ship !== sh) return;
          if (mo && monthOf(e.date) !== mo) return;
          if (ve && e.vendor !== ve) return;
          var key = e.name + '\u0001' + (e.type === '修船费用' ? '' : (e.spec || ''));
          var g = groups[key] || (groups[key] = {
            name: e.name, spec: e.spec, type: e.type, n: 0, ships: {}, vendors: {},
            qty: 0, uoms: {}, amount: 0, minp: null, maxp: null
          });
          g.n++;
          g.ships[e.ship] = 1;
          if (e.vendor) g.vendors[e.vendor] = (g.vendors[e.vendor] || 0) + 1;
          g.qty += e.qty || 0;
          if (e.uom) g.uoms[e.uom] = 1;
          g.amount += e.amount || 0;
          if (e.price !== null && e.price !== undefined && num(e.price) > 0) {
            var p = num(e.price);
            if (g.minp === null || p < g.minp) g.minp = p;
            if (g.maxp === null || p > g.maxp) g.maxp = p;
          }
        });
        var list = Object.keys(groups).map(function (k) {
          var g = groups[k];
          var us = Object.keys(g.uoms);
          var vs = Object.keys(g.vendors).sort(function (a, b) { return g.vendors[b] - g.vendors[a]; });
          return {
            name: g.name, spec: g.spec, type: g.type,
            ships: Object.keys(g.ships).length, n: g.n,
            qty: us.length ? g.qty : null, uom: us.length === 1 ? us[0] : (us.length ? '多单位' : ''),
            amount: g.amount, unit_price: (us.length === 1 || !us.length) && g.qty ? g.amount / g.qty : null,
            minp: g.minp, maxp: g.maxp, vendors: vs.slice(0, 3), vendorN: vs.length
          };
        }).sort(function (a, b) { return b.amount - a.amount; });

        var res = box.querySelector('#constp-a-result');
        if (!list.length) { res.innerHTML = '<div class="panel-placeholder constp-empty">未找到匹配品名</div>'; return; }
        var total = list.reduce(function (a, x) { return a + x.amount; }, 0);
        var hh = '<div class="ship-stat-bar constp-foot"><span class="ship-stat total">共 ' + list.length +
          ' 个品名</span><span class="ship-stat">金额合计：<b>' + fmtMoney(total) + '</b></span></div>';
        hh += '<div class="constp-tablewrap"><table class="constp-table"><thead><tr>' +
          '<th>品名</th><th>型号/规格</th><th>类型</th>' +
          '<th class="constp-r">涉及船数</th><th class="constp-r">笔数</th><th class="constp-r">数量</th>' +
          '<th class="constp-r">金额</th><th class="constp-r">均价</th><th class="constp-r">单价区间</th>' +
          '<th>主要厂商</th></tr></thead><tbody>';
        list.slice(0, 400).forEach(function (x, i) {
          hh += '<tr class="constp-row constp-aggrow" data-i="' + i + '">' +
            '<td class="constp-item">' + esc(x.name) + '</td>' +
            '<td>' + esc(x.spec) + '</td>' +
            '<td><span class="constp-chip constp-ct-' + chipCls(x.type) + '">' + esc(x.type) + '</span></td>' +
            '<td class="constp-r">' + x.ships + '</td>' +
            '<td class="constp-r">' + x.n + '</td>' +
            '<td class="constp-r">' + (x.qty === null ? '' : fmtQty(x.qty) + (x.uom ? ' ' + esc(x.uom) : '')) + '</td>' +
            '<td class="constp-r">' + fmtMoney(x.amount) + '</td>' +
            '<td class="constp-r">' + (x.unit_price ? fmtMoney(x.unit_price) : '') + '</td>' +
            '<td class="constp-r">' + (x.minp === null ? '' : (fmtMoney(x.minp) + ' ~ ' + fmtMoney(x.maxp))) + '</td>' +
            '<td><span class="constp-vendtxt" title="' + esc(x.vendors.join(' / ') + (x.vendorN > 3 ? ' …共' + x.vendorN + '家' : '')) + '">' +
              esc(x.vendors.join(' / ')) + (x.vendorN > 3 ? ' …等' + x.vendorN + '家' : '') + '</span></td></tr>';
        });
        hh += '</tbody></table></div>';
        if (list.length > 400) hh += '<div class="constp-warn">⚠️ 仅显示金额前 400 个品名（共 ' + list.length + ' 个），请加筛选条件缩小范围。</div>';
        res.innerHTML = hh;
        res.querySelectorAll('tr.constp-aggrow').forEach(function (tr) {
          tr.addEventListener('click', function () {
            var x = list[+tr.getAttribute('data-i')];
            if (!x) return;
            var tab = el.querySelector('.constp-tab[data-mode="trace"]');
            if (tab) tab.click();
            var qi = el.querySelector('#constp-q');
            if (qi) { qi.value = x.name; }
            runTrace();
          });
        });
      }

      box.querySelector('#constp-a-go').addEventListener('click', runAgg);
      box.querySelector('#constp-a-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') runAgg(); });
      runAgg();
    }).catch(function () {
      box.innerHTML = divPlaceholder('明细数据加载失败', '请确认 data/smis_order_lines.json 可访问');
    });
  }

  function shortDesc(r) {
    var t = String(r.desc || '').trim();
    if (!t) t = String(r.memo || '').trim();
    if (t.length > 90) t = t.slice(0, 90) + '…';
    return t;
  }

  function chipCls(type) {
    if (type === '修船费用') return 'repair';
    if (type === '备件') return 'part';
    if (type === '物资') return 'store';
    return 'other';
  }

  /* ---------------- CSV 导出（UTF-8 BOM） ---------------- */
  function exportCSV(rows, money) {
    var heads = ['日期', '类型', '船名', '科目/设备类别', '设备/物料名', '厂商', '单号', '金额(本币约值)',
      '数量', '单位', '均价(按数量加权)', '件号', '型号', '港口', '完工日', '币种', '说明/备注'];
    var lines = [heads];
    rows.forEach(function (r) {
      lines.push([r.date, r.type, r.ship, r.cat, r.item, r.vendor, r.bill, r.amount,
        r.qty || '', r.uom || '', r.unit_price || '', r.part || '', r.spec || '',
        r.port || '', r.done_date || '', r.currency, (r.desc || r.memo || '')]);
    });
    lines.push(['', '', '', '', '', '', '合计', money, '', '', '', '', '', '', '', '', '']);
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
   * 区块 2：月度统计（19 船 × 1~12 月 · 细项：修船5+物料3+备件）
   * ==========================================================*/
  // 九大类口径（2026-10-21 定稿）：与 scripts/smis_cost_core.py 的 CATS 完全一致
  var COST_LINES = ['备件', '物料', '油漆', '滑油', '航修', '坞修', '设备更新', '检验', '船员奖金'];
  var PAINT_SUB = ['常规油漆', '坞修油漆'];
  var COST_AGGS = {
    '修船合计': ['航修', '坞修', '设备更新', '检验'],
    '采购合计': ['备件', '物料', '油漆', '滑油'],
    '船员奖金': ['船员奖金'],
    '总计': null
  };
  function costVal(shipRec, mode, m, shipName) {
    // mode 形如 line:船员奖金 或 agg:修船合计
    var total = 0;
    if (mode.indexOf('paint:') === 0) {
      var pb = (monthlyCache && monthlyCache.paint_breakdown) || {};
      var rec2 = pb[shipName] || {};
      var sub = rec2[mode.slice(6)] || {};
      return num(sub[m]);
    }
    if (mode.indexOf('line:') === 0) {
      var ln = mode.slice(5);
      var mm = (shipRec && shipRec[ln]) || {};
      return num(mm[m]);
    }
    var key = mode.slice(4);
    var list = COST_AGGS[key];
    var lines = list === null ? COST_LINES : list;
    lines.forEach(function (ln) {
      var mm = (shipRec && shipRec[ln]) || {};
      total += num(mm[m]);
    });
    return total;
  }
  function monthlyModeLabel(mode) {
    if (mode.indexOf('paint:') === 0) return '油漆·' + mode.slice(6);
    if (mode.indexOf('line:') === 0) return mode.slice(5);
    return mode.slice(4);
  }
  function renderMonthly(rootEl) {
    var box = rootEl.querySelector('#constp-monthly');
    if (!box) return;
    var ships = monthlyCache && monthlyCache.ships ? monthlyCache.ships : {};
    var shipList = Object.keys(ships).sort();
    if (!shipList.length) {
      box.innerHTML = divPlaceholder('暂无月度统计', '未加载到 data/smis_cost_monthly.json。');
      return;
    }
    var opts = [];
    Object.keys(COST_AGGS).forEach(function (a) { opts.push(['agg:' + a, '∑ ' + a]); });
    COST_LINES.forEach(function (ln) { opts.push(['line:' + ln, ln]); });
    PAINT_SUB.forEach(function (p) { opts.push(['paint:' + p, '油漆·' + p]); });
    var optsHtml = opts.map(function (o) {
      return '<option value="' + o[0] + '"' + (o[0] === 'agg:修船合计' ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');
    var h = '<div class="constp-note">月度统计（九大类）：备件 / 物料 / 油漆 / 滑油 / 航修 / 坞修 / 设备更新 / 检验 / 船员奖金（单位：本币 USD，定单口径）</div>';
    h += '<div class="constp-filters"><span class="constp-lab">统计口径：</span>' +
      '<select id="constp-mline" class="constp-sel">' + optsHtml + '</select>' +
      '<span class="constp-sub">行=船 · 列=1~12月 · 末列合计</span></div>';
    h += '<div id="constp-monthly-tbl" class="constp-tablewrap"></div>';
    box.innerHTML = h;
    var sel = box.querySelector('#constp-mline');
    sel.addEventListener('change', function () { renderMonthlyTable(box, shipList, sel.value); });
    renderMonthlyTable(box, shipList, sel.value);
  }
  function renderMonthlyTable(box, shipList, mode) {
    var wrap = box.querySelector('#constp-monthly-tbl');
    var ships = monthlyCache && monthlyCache.ships ? monthlyCache.ships : {};
    var months = [];
    for (var m = 1; m <= 12; m++) months.push(m);
    var colSum = {};
    shipList.forEach(function (ship) {
      var rec = ships[ship] || {};
      months.forEach(function (m) { colSum[m] = (colSum[m] || 0) + costVal(rec, mode, m, ship); });
    });
    var grand = months.reduce(function (a, m) { return a + (colSum[m] || 0); }, 0);
    var h = '<table class="constp-table constp-mt">';
    h += '<thead><tr><th>船名</th>';
    months.forEach(function (m) { h += '<th>' + m + '月</th>'; });
    h += '<th>合计</th></tr></thead><tbody>';
    shipList.forEach(function (ship) {
      var rec = ships[ship] || {};
      var sTotal = months.reduce(function (a, m) { return a + costVal(rec, mode, m, ship); }, 0);
      h += '<tr><td class="constp-shipnm">' + esc(ship) + '</td>';
      months.forEach(function (m) {
        var v = costVal(rec, mode, m, ship);
        h += '<td class="constp-r">' + (v ? fmtMoney(v) : '—') + '</td>';
      });
      h += '<td class="constp-r constp-strong">' + fmtMoney(sTotal) + '</td></tr>';
    });
    h += '</tbody><tfoot><tr><td class="constp-shipnm"><b>合计(' + monthlyModeLabel(mode) + ')</b></td>';
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
      '.constp-table thead th.constp-r{text-align:right}',
      '.constp-table td.constp-r{text-align:right}',
      '.constp-item{max-width:240px}',
      '.constp-desc{max-width:360px}',
      '.constp-vend{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.constp-vendtxt{display:block;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.constp-detail .constp-table thead th{padding:6px 8px}',
      '.constp-lines td:nth-child(3){max-width:300px}',
      '.constp-lines td:nth-child(4){max-width:220px}',
      '.constp-lines td{padding:6px 8px}',
      '.constp-warn{margin-top:8px;font-size:11px;color:#8a6d00;background:#fff8e1;border-left:3px solid #f0c040;padding:5px 8px;border-radius:3px}',
      '.constp-bill{white-space:nowrap}',
      '.constp-chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;white-space:nowrap}',
      '.constp-ct-repair{background:#fdecea;color:#c0392b}',
      '.constp-ct-part{background:#e8f0fe;color:#1a63b0}',
      '.constp-ct-store{background:#e8f7ee;color:#1e7e46}',
      '.constp-ct-other{background:#f1f1f1;color:#666}',
      '.constp-vendor-sel{max-width:260px}',
      '.constp-row{cursor:pointer}',
      '.constp-row.constp-sel-row td{background:#eef7fb}',
      '.constp-detail{margin:10px 0}',
      '.constp-detail-card{border:1px solid var(--border,#dee2e6);border-radius:8px;padding:10px 12px;background:#fbfdfe;font-size:12px}',
      '.constp-detail-grid{display:flex;gap:14px;flex-wrap:wrap;margin:6px 0;color:var(--text-light,#666)}',
      '.constp-detail-desc{margin:6px 0;line-height:1.6;background:#f7fafc;border-left:3px solid var(--primary,#1f6f8b);padding:8px 10px;border-radius:4px}',
      '.constp-lines{margin:8px 0}',
      '.constp-lines thead th{cursor:default}',
      '.constp-mt .constp-shipnm{white-space:nowrap;font-weight:600}',
      '.constp-strong{font-weight:700}',
      '.constp-table tfoot td{background:#f7fafc;border-top:2px solid var(--border,#dee2e6);font-weight:700}',
      '@media (max-width:600px){.constp-filters{flex-direction:column;align-items:stretch}.constp-sel{max-width:100%}}'
    ].join('\n');
  }

  // 自检：保证无语法层面误用
  if (typeof module !== 'undefined' && module.exports) module.exports = { loadSmisCostOverlay: window.loadSmisCostOverlay };
})();

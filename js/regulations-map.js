// WINNING Shipping AI - 法规条款→文件映射表
// 将AI回复中的公约条款引用映射到本地PDF文件路径
// 在AI回复渲染时，被识别的条款名称变成可点击链接

(function(global) {
  'use strict';

  // ====== 公约名称→对应PDF路径的映射 ======
  // key: 匹配模式, value: { path, label, fallbackLink }
  // 使用严格匹配加规则匹配：所有公约名+章节名都会被识别
  
  var REGULATION_MAP = {
    // ---- SOLAS ----
    'SOLAS': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS 2024 综合文本',
      url: null
    },
    'SOLAS Charter': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Charter',
      url: null
    },
    'SOLAS Chapter I': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.I 总则',
      url: null
    },
    'SOLAS Chapter II-1': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.II-1 构造（分舱与稳性）',
      url: null
    },
    'SOLAS Chapter II-2': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.II-2 防火、探火与灭火',
      url: null
    },
    'SOLAS Chapter III': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.III 救生设备与布置',
      url: null
    },
    'SOLAS Chapter IV': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.IV 无线电通信',
      url: null
    },
    'SOLAS Chapter V': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.V 航行安全',
      url: null
    },
    'SOLAS Chapter VI': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.VI 货物运输',
      url: null
    },
    'SOLAS Chapter VII': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.VII 危险货物运输',
      url: null
    },
    'SOLAS Chapter VIII': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.VIII 核能船舶',
      url: null
    },
    'SOLAS Chapter IX': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.IX 安全管理（ISM Code）',
      url: null
    },
    'SOLAS Chapter X': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.X 高速船安全措施',
      url: null
    },
    'SOLAS Chapter XI-1': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.XI-1 加强海上安全的特别措施',
      url: null
    },
    'SOLAS Chapter XI-2': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.XI-2 加强海上保安的特别措施',
      url: null
    },
    'SOLAS Chapter XII': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.XII 散货船的附加安全措施',
      url: null
    },
    'SOLAS Chapter XIII': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.XIII 检验发证',
      url: null
    },
    'SOLAS Chapter XIV': {
      file: 'regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf',
      label: 'SOLAS Ch.XIV 极地水域船舶操作',
      url: null
    },
    
    // ---- SOLAS 条款简称 ----
    'SOLAS Ch.I':   { ref: 'SOLAS Chapter I', label: 'SOLAS Ch.I' },
    'SOLAS Ch.II-1': { ref: 'SOLAS Chapter II-1', label: 'SOLAS Ch.II-1' },
    'SOLAS Ch.II-2': { ref: 'SOLAS Chapter II-2', label: 'SOLAS Ch.II-2' },
    'SOLAS Ch.III': { ref: 'SOLAS Chapter III', label: 'SOLAS Ch.III' },
    'SOLAS Ch.IV':  { ref: 'SOLAS Chapter IV', label: 'SOLAS Ch.IV' },
    'SOLAS Ch.V':   { ref: 'SOLAS Chapter V', label: 'SOLAS Ch.V' },
    'SOLAS Ch.VI':  { ref: 'SOLAS Chapter VI', label: 'SOLAS Ch.VI' },
    'SOLAS Ch.VII':  { ref: 'SOLAS Chapter VII', label: 'SOLAS Ch.VII' },
    'SOLAS Ch.IX':  { ref: 'SOLAS Chapter IX', label: 'SOLAS Ch.IX' },
    'SOLAS Ch.XI-1': { ref: 'SOLAS Chapter XI-1', label: 'SOLAS Ch.XI-1' },
    'SOLAS Ch.XI-2': { ref: 'SOLAS Chapter XI-2', label: 'SOLAS Ch.XI-2' },
    'SOLAS Ch.XII': { ref: 'SOLAS Chapter XII', label: 'SOLAS Ch.XII' },
    'SOLAS Reg.I/':  { ref: 'SOLAS Charter', label: 'SOLAS Reg.I' },
    'SOLAS Reg.II-1/': { ref: 'SOLAS Chapter II-1', label: 'SOLAS Reg.II-1' },
    'SOLAS Reg.II-2/': { ref: 'SOLAS Chapter II-2', label: 'SOLAS Reg.II-2' },
    'SOLAS Reg.III/': { ref: 'SOLAS Chapter III', label: 'SOLAS Reg.III' },
    'SOLAS Reg.IV/': { ref: 'SOLAS Chapter IV', label: 'SOLAS Reg.IV' },
    'SOLAS Reg.V/':  { ref: 'SOLAS Chapter V', label: 'SOLAS Reg.V' },
    'SOLAS Reg.XI-1/': { ref: 'SOLAS Chapter XI-1', label: 'SOLAS Reg.XI-1' },
    'SOLAS Reg.XI-2/': { ref: 'SOLAS Chapter XI-2', label: 'SOLAS Reg.XI-2' },

    // ---- MARPOL（暂无PDF，指向环境页或IMO官网） ----
    'MARPOL': {
      url: 'https://www.imo.org/en/OurWork/Environment/Pages/MARPOL.aspx',
      label: 'MARPOL 公约 — IMO官网'
    },
    'MARPOL Annex I': {
      url: 'https://www.imo.org/en/OurWork/Environment/Pages/OilPollution.aspx',
      label: 'MARPOL 附则I 防止油类污染 — IMO官网'
    },
    'MARPOL Annex II': {
      url: 'https://www.imo.org/en/OurWork/Environment/Pages/ChemicalPollution.aspx',
      label: 'MARPOL 附则II 散装有毒液体物质 — IMO官网'
    },
    'MARPOL Annex III': {
      url: 'https://www.imo.org/en/OurWork/Environment/Pages/HarmfulSubstances.aspx',
      label: 'MARPOL 附则III 包装有害物质 — IMO官网'
    },
    'MARPOL Annex IV': {
      url: 'https://www.imo.org/en/OurWork/Environment/Pages/Sewage.aspx',
      label: 'MARPOL 附则IV 生活污水 — IMO官网'
    },
    'MARPOL Annex V': {
      url: 'https://www.imo.org/en/OurWork/Environment/Pages/Garbage.aspx',
      label: 'MARPOL 附则V 船舶垃圾 — IMO官网'
    },
    'MARPOL Annex VI': {
      url: 'https://www.imo.org/en/OurWork/Environment/Pages/AirPollution.aspx',
      label: 'MARPOL 附则VI 空气污染 — IMO官网'
    },

    // ---- MLC（暂无PDF，指向IMO官网） ----
    'MLC': {
      url: 'https://www.imo.org/en/OurWork/HumanElement/Pages/MLC.aspx',
      label: 'MLC 2006 海事劳工公约 — IMO官网'
    },
    'MLC 2006': {
      url: 'https://www.imo.org/en/OurWork/HumanElement/Pages/MLC.aspx',
      label: 'MLC 2006 海事劳工公约 — IMO官网'
    },
    'MLC Title 1': {
      url: 'https://www.imo.org/en/OurWork/HumanElement/Pages/MLC.aspx',
      label: 'MLC 标题一 船员就业条件 — IMO官网'
    },
    'MLC Title 2': {
      url: 'https://www.imo.org/en/OurWork/HumanElement/Pages/MLC.aspx',
      label: 'MLC 标题二 起居舱室 — IMO官网'
    },
    'MLC Title 3': {
      url: 'https://www.imo.org/en/OurWork/HumanElement/Pages/MLC.aspx',
      label: 'MLC 标题三 健康保护 — IMO官网'
    },
    'MLC Title 4': {
      url: 'https://www.imo.org/en/OurWork/HumanElement/Pages/MLC.aspx',
      label: 'MLC 标题四 社会保障 — IMO官网'
    },

    // ---- STCW ----
    'STCW': {
      url: 'https://www.imo.org/en/OurWork/HumanElement/Pages/STCW.aspx',
      label: 'STCW 公约 — IMO官网'
    },

    // ---- COLREG ----
    'COLREG': {
      url: 'https://www.imo.org/en/OurWork/Safety/Pages/COLREG.aspx',
      label: 'COLREG 避碰规则 — IMO官网'
    },

    // ---- ISM Code ----
    'ISM Code': {
      url: 'https://www.imo.org/en/OurWork/Safety/Pages/ISMCode.aspx',
      label: 'ISM Code 国际安全管理规则 — IMO官网'
    },
    'ISM': { ref: 'ISM Code', label: 'ISM Code' },

    // ---- ISPS Code ----
    'ISPS Code': {
      url: 'https://www.imo.org/en/OurWork/Security/Pages/SOLAS-XI-2%20ISPS%20Code.aspx',
      label: 'ISPS Code 国际船舶保安规则 — IMO官网'
    },
    'ISPS': { ref: 'ISPS Code', label: 'ISPS Code' },

    // ---- LL 载重线 ----
    '载重线公约': {
      url: 'https://www.imo.org/en/About/Conventions/Pages/International-Convention-on-Load-Lines.aspx',
      label: 'LL 1966 国际载重线公约 — IMO官网'
    },
    'LL 1966': { ref: '载重线公约', label: 'LL 1966' },
    'Load Lines': { ref: '载重线公约', label: 'LL 载重线公约' },

    // ---- AMSA（澳洲海事安全局） ----
    'AMSA': {
      url: 'https://www.amsa.gov.au/',
      label: 'AMSA 澳洲海事安全局 — 官网'
    },
    'AMSA Marine Order': {
      url: 'https://www.amsa.gov.au/vessels-operators/ship-operators',
      label: 'AMSA Marine Orders — 官网'
    },

    // ---- 新加坡MPA ----
    'MPA': {
      url: 'https://www.mpa.gov.sg/',
      label: 'Singapore MPA 官网'
    },
    'Singapore MPA': { ref: 'MPA', label: 'Singapore MPA' },

    // ---- 中国国内法规 ----
    '中华人民共和国海商法': {
      file: null, // 暂无实际PDF
      url: 'https://flk.npc.gov.cn/',
      label: '中华人民共和国海商法'
    },
    '海商法': { ref: '中华人民共和国海商法', label: '中华人民共和国海商法' },
    '海上交通安全法': {
      url: 'https://flk.npc.gov.cn/',
      label: '海上交通安全法'
    },
    
    // ---- 船级社 ----
    'DNV': {
      url: 'https://www.dnv.com/rules-standards/',
      label: 'DNV 船级社规范 — 官网'
    },
    'Lloyd\'s': {
      url: 'https://www.lr.org/en/rules-and-regulations/',
      label: 'LR 劳氏船级社规范 — 官网'
    },
    'ABS': {
      url: 'https://www.eagle.org/rules-standards/',
      label: 'ABS 美国船级社规范 — 官网'
    },
    'BV': {
      url: 'https://www.bureauveritas.com/marine/regulations',
      label: 'BV 法国船级社规范 — 官网'
    },
    'NK': {
      url: 'https://www.classnk.or.jp/',
      label: 'NK 日本海事协会 — 官网'
    },
    'CCS': {
      url: 'https://www.ccs.org.cn/',
      label: 'CCS 中国船级社 — 官网'
    },
    'RINA': {
      url: 'https://www.rina.org/en/rules',
      label: 'RINA 意大利船级社 — 官网'
    },
    'KRS': {
      url: 'https://www.krs.co.kr/',
      label: 'KRS 韩国船级社 — 官网'
    }
  };

  // ====== 解析函数 ======

  /** 
   * 在文本中识别法规条款引用，返回匹配信息数组
   * 匹配规则：优先精确匹配，再顺序匹配
   */
  function extractMatches(text) {
    var matches = [];

    // 1. 先精确匹配整条款名（如 SOLAS Chapter II-1）
    var exactKeys = Object.keys(REGULATION_MAP).sort(function(a, b) { return b.length - a.length; });
    for (var i = 0; i < exactKeys.length; i++) {
      var key = exactKeys[i];
      var idx = text.indexOf(key);
      if (idx === -1) continue;
      // 检查前后是否是单词边界
      var prevChar = text[idx - 1] || '';
      var nextChar = text[idx + key.length] || '';
      var isPrevBoundary = !prevChar.match(/[a-zA-Z0-9]/);
      var isNextBoundary = !nextChar.match(/[a-zA-Z0-9]/);
      if (isPrevBoundary && (isNextBoundary || nextChar === '.' || nextChar === '-' || nextChar === '/')) {
        matches.push({
          start: idx,
          end: idx + key.length,
          key: key,
          entry: REGULATION_MAP[key]
        });
      }
    }

    // 2. 特殊模式：SOLAS Reg.X/Y 格式 → 自动映射到对应章节
    var solasRegMatch = text.match(/\bSOLAS\s+Reg\.[A-Za-z0-9-]+\/\d+\b/g);
    if (solasRegMatch) {
      // 这些已经在精确匹配中覆盖了章节映射，不需要额外处理
    }

    // 3. 过滤重叠匹配（取最长的）
    matches.sort(function(a, b) { return a.start - b.start; });
    var filtered = [];
    for (var i = 0; i < matches.length; i++) {
      var overlap = false;
      for (var j = 0; j < filtered.length; j++) {
        if (matches[i].start < filtered[j].end && matches[i].end > filtered[j].start) {
          // 重叠：保留更长的
          if (matches[i].key.length > filtered[j].key.length) {
            filtered[j] = matches[i];
          }
          overlap = true;
          break;
        }
      }
      if (!overlap) {
        filtered.push(matches[i]);
      }
    }

    return filtered;
  }

  /**
   * 解析条目：处理 ref 引用和别名
   */
  function resolveEntry(entry) {
    if (!entry) return null;
    if (entry.ref) {
      var resolved = REGULATION_MAP[entry.ref];
      if (resolved) {
        return {
          file: resolved.file || null,
          url: resolved.url || null,
          label: entry.label || resolved.label
        };
      }
    }
    return {
      file: entry.file || null,
      url: entry.url || null,
      label: entry.label
    };
  }

  /**
   * 生成HTML：将所有法规引用转换为可点击标签
   */
  function htmlify(text) {
    var matches = extractMatches(text);
    if (matches.length === 0) return null;

    // 从后往前替换，保持索引正确
    var result = text;
    matches.sort(function(a, b) { return b.start - a.start; });
    
    var replacements = [];
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var resolved = resolveEntry(m.entry);
      if (!resolved) continue;

      var refText = text.substring(m.start, m.end);
      var clickableHtml = null;

      if (resolved.file) {
        // 有本地PDF → 点击在overlay中预览
        var escapedFile = resolved.file.replace(/'/g, "\\'");
        clickableHtml = '<a href="javascript:void(0)" class="regulation-link" ' +
          'onclick="openRegulationPdf(\'' + escapedFile + '\', \'' + resolved.label.replace(/'/g, "\\'") + '\')" ' +
          'title="点击查看 ' + resolved.label + '">' + refText + '<span class="law-icon">📄</span></a>';
      } else if (resolved.url) {
        // 有外链 → 新窗口打开
        clickableHtml = '<a href="' + resolved.url + '" target="_blank" rel="noopener" class="regulation-link" ' +
          'title="打开 ' + resolved.label + '">' + refText + '<span class="law-icon">🔗</span></a>';
      } else {
        continue; // 无文件无外链，不替换
      }

      replacements.push({ start: m.start, end: m.end, html: clickableHtml });
    }

    // 应用替换（从后往前）
    if (replacements.length === 0) return null;
    replacements.sort(function(a, b) { return b.start - a.start; });
    for (var i = 0; i < replacements.length; i++) {
      var r = replacements[i];
      result = result.substring(0, r.start) + r.html + result.substring(r.end);
    }

    return result;
  }

  // ====== PDF预览功能 ======
  /**
   * 在overlay中打开PDF预览
   * 由 index.html 中的 onclick 调用
   */
  function openPdfPreview(filePath, title) {
    if (!filePath) return;
    // 使用全局的 openOverlay 函数（在 index.html 中定义）
    if (typeof openOverlay === 'function') {
      openOverlay('pdf', title || '法规文件预览');
      var contentEl = document.getElementById('overlayContent');
      if (contentEl) {
        contentEl.innerHTML = '<div style="width:100%;height:calc(100vh - 140px);display:flex;flex-direction:column;">' +
          '<div style="background:#f8f9fa;padding:8px 16px;border-bottom:1px solid #dee2e6;display:flex;align-items:center;gap:12px;flex-shrink:0;">' +
          '<span style="font-weight:600;">' + (title || '法规文件') + '</span>' +
          '<a href="' + filePath + '" target="_blank" rel="noopener" style="margin-left:auto;padding:4px 12px;background:#1a73e8;color:#fff;border-radius:4px;text-decoration:none;font-size:13px;">⬇ 下载</a>' +
          '</div>' +
          '<iframe src="' + filePath + '#view=FitH" style="flex:1;width:100%;border:none;" title="' + (title || '') + '"></iframe>' +
          '</div>';
      }
    }
  }

  // 暴露到全局
  global.RegulationsMap = {
    extractMatches: extractMatches,
    resolveEntry: resolveEntry,
    htmlify: htmlify,
    openPdfPreview: openPdfPreview,
    getMap: function() { return REGULATION_MAP; }
  };

})(window);

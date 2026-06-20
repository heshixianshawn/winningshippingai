// WINNING Shipping AI - 思考引擎
// 从"搜索回答"升级为"思维链交付"
// 前端传结构化数据 → Worker做意图分析 → 综合输出

// ====== 意图分析（第一轮思考） ======
export function analyzeIntent(structuredData, message) {
  if (!structuredData || !structuredData.type) {
    return { intent: 'general_query', ship: null, aspect: null };
  }

  const q = message.toUpperCase();
  const intent = { intent: 'general_query', ship: structuredData.ship || null, aspects: [] };
  
  // 检测意图
  if (q.includes('到期') || q.includes('过期') || q.includes('效期') || q.includes('TERM') || q.includes('EXPIR') || q.includes('VALID')) {
    intent.intent = 'certificate_expiry';
    intent.aspects.push('到期提醒');
  }
  if (q.includes('证书') || q.includes('CERT') || q.includes('SURVEY') || q.includes('检验') || q.includes('年检')) {
    intent.aspects.push('证书');
  }
  if (q.includes('参数') || q.includes('吨位') || q.includes('主机') || q.includes('GT') || q.includes('DWT') || q.includes('建造') || q.includes('船厂')) {
    intent.aspects.push('技术参数');
  }
  if (q.includes('船级') || q.includes('CLASS') || q.includes('入级') || q.includes('NK') || q.includes('CCS') || q.includes('RINA')) {
    intent.aspects.push('船级社');
  }
  if (q.includes('旗') || q.includes('FLAG') || q.includes('船旗') || q.includes('Singapore') || q.includes('Panama') || q.includes('Liberia')) {
    intent.aspects.push('船旗国');
  }
  if (q.includes('位置') || q.includes('动态') || q.includes('在哪') || q.includes('航速') || q.includes('目的港') || q.includes('ETA')) {
    intent.aspects.push('动态');
  }
  if (q.includes('设备') || q.includes('主机') || q.includes('辅机') || q.includes('锅炉') || q.includes('压载水') || q.includes('脱硫塔')) {
    intent.aspects.push('设备');
  }
  if (q.includes('比较') || q.includes('对比') || q.includes('COMPARE')) {
    intent.intent = 'comparison';
    intent.aspects.push('对比');
  }
  if (q.includes('建议') || q.includes('提醒') || q.includes('注意') || q.includes('应该') || q.includes('何时') || q.includes('提前')) {
    intent.aspects.push('建议');
  }
  
  return intent;
}

// ====== 构建思考上下文（给第二轮的预分析） ======
export function buildThinkingContext(structuredData, intent) {
  if (!structuredData) return '';
  
  var ctx = '【思考引擎 — 船舶综合分析】\n\n';
  
  // 1. 船舶基本信息
  if (structuredData.params) {
    var p = structuredData.params;
    ctx += '## 船舶基本信息\n';
    ctx += '- 船名: ' + (structuredData.ship || '未知') + '\n';
    ctx += '- IMO: ' + (p.imo || '—') + '\n';
    ctx += '- 船旗国: ' + (p.flag || '—') + '\n';
    ctx += '- 船级社: ' + (p.class_notation || p.class_society || '—') + '\n';
    ctx += '- 建造年份: ' + ((p.built || '—').slice(0,4)) + '\n';
    ctx += '- DWT: ' + (p.dwt || '—') + '\n';
    ctx += '- GT: ' + (p.gt || '—') + '\n\n';
  }
  
  // 2. NK Survey 证书到期状态（精确数据）
  if (structuredData.nkSurvey && Object.keys(structuredData.nkSurvey).length > 0) {
    ctx += '## NK证书到期状态\n';
    var now = new Date();
    for (var cert in structuredData.nkSurvey) {
      var date = structuredData.nkSurvey[cert];
      var warning = '';
      if (date && date !== '-') {
        var parts = date.split(/[\s/]+/);
        var year = parseInt(parts[parts.length-1]);
        if (!isNaN(year) && year <= now.getFullYear()) {
          var monthsLeft = Math.round((new Date(date) - now) / (30*24*60*60*1000));
          if (monthsLeft <= 6 && monthsLeft > 0) {
            warning = ' ⚠️ ' + monthsLeft + '个月后到期';
          } else if (monthsLeft <= 0) {
            warning = ' 🚨 已到期';
          }
        }
      }
      ctx += '- ' + cert + ': ' + (date || '未提取') + warning + '\n';
    }
    ctx += '\n';
  }
  
  // 3. OCR证书清单
  if (structuredData.certificates && structuredData.certificates.length > 0) {
    ctx += '## OCR证书清单（' + structuredData.certificates.length + '份）\n';
    var withExp = [];
    var noExp = [];
    for (var ci = 0; ci < structuredData.certificates.length; ci++) {
      var c = structuredData.certificates[ci];
      if (c.expiry) withExp.push(c);
      else noExp.push(c);
    }
    if (withExp.length > 0) {
      ctx += '### 有到期日信息：\n';
      var showN = Math.min(withExp.length, 20);
      for (var ci2 = 0; ci2 < showN; ci2++) {
        ctx += '- ' + withExp[ci2].cert + ': 到期日 ' + withExp[ci2].expiry + '\n';
      }
      if (withExp.length > showN) ctx += '  ... 还有' + (withExp.length - showN) + '份\n';
    }
    if (noExp.length > 0) {
      ctx += '\n### 无到期日信息：\n';
      var showN2 = Math.min(noExp.length, 10);
      for (var ci3 = 0; ci3 < showN2; ci3++) {
        ctx += '- ' + noExp[ci3].cert + '\n';
      }
    }
    ctx += '\n';
  }
  
  // 4. 当前动态
  if (structuredData.dynamic) {
    var d = structuredData.dynamic;
    ctx += '## 当前动态\n';
    ctx += '- 状态: ' + (d.status || '未知') + '\n';
    ctx += '- 位置: (' + (d.position || '未知') + ')\n';
    ctx += '- 航速: ' + (d.speed_kn || '—') + ' kn\n';
    ctx += '- 目的港: ' + (d.destination || '未知') + '\n';
    ctx += '- ETA: ' + (d.eta || '未知') + '\n\n';
  }
  
  // 5. 关系图谱
  if (structuredData.relations && structuredData.relations.length > 0) {
    ctx += '## 关联信息\n';
    for (var ri = 0; ri < structuredData.relations.length; ri++) {
      var r = structuredData.relations[ri];
      ctx += '- ' + r.type + ': ' + r.target + ' (' + r.description + ')\n';
    }
    ctx += '\n';
  }
  
  // 6. 意图预分析
  if (intent) {
    ctx += '## 思考引擎预分析\n';
    ctx += '检测到用户关注: ' + (intent.aspects.join('、') || '船舶综合信息') + '\n';
    ctx += '结论类型: ' + intent.intent + '\n\n';
    
    // 基于intent给出预分析
    if (intent.intent === 'certificate_expiry') {
      // 从所有数据源收集到期信息
      var allExpiries = [];
      var now = new Date();
      
      // 从 nkSurvey
      if (structuredData.nkSurvey) {
        for (var cert2 in structuredData.nkSurvey) {
          var d2 = structuredData.nkSurvey[cert2];
          if (d2 && d2 !== '-') allExpiries.push({ cert: cert2, date: d2 });
        }
      }
      
      // 从 certificates
      if (structuredData.certificates) {
        for (var ci4 = 0; ci4 < structuredData.certificates.length; ci4++) {
          var c2 = structuredData.certificates[ci4];
          if (c2.expiry) allExpiries.push({ cert: c2.cert, date: c2.expiry });
        }
      }
      
      // 筛选2026年内或6个月内到期
      var nearExpiry = [];
      for (var ei = 0; ei < allExpiries.length; ei++) {
        var item = allExpiries[ei];
        var parts = item.date.split(/[\s/]+/);
        var year = parseInt(parts[parts.length-1]);
        if (isNaN(year)) continue;
        if (year <= now.getFullYear()) nearExpiry.push(item);
      }
      
      if (nearExpiry.length > 0) {
        ctx += '⚠️ **重要到期提醒**:\n';
        for (var ei2 = 0; ei2 < nearExpiry.length; ei2++) {
          ctx += '  - ' + nearExpiry[ei2].cert + ': ' + nearExpiry[ei2].date + '\n';
        }
        ctx += '\n';
      }
    }
    
    if (intent.aspects.indexOf('建议') >= 0 || intent.intent === 'certificate_expiry') {
      ctx += '💡 **建议**: 请根据到期日信息，提醒用户提前安排检验。新加坡旗SE证书一般需提前2-3个月申请。\n\n';
    }
  }
  
  ctx += '【思考引擎结束】\n';
  return ctx;
}

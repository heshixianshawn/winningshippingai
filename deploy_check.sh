#!/bin/bash
# deploy_check.sh - 推送前安全检查
# 确保不会像上次一样误删文件
# 用法: bash deploy_check.sh

set -e

ERRORS=0
WARNINGS=0

echo "🔍 部署前检查..."

# 1. 必须有 index.html
if [ ! -f index.html ]; then
    echo "❌ [致命] index.html 不存在！"
    ERRORS=$((ERRORS+1))
fi

# 2. 必须有 functions/api/ 目录和相关文件
if [ ! -d functions/api ]; then
    echo "❌ [致命] functions/api/ 目录不存在！"
    ERRORS=$((ERRORS+1))
fi

# 3. 检查关键目录是否存在
for dir in data regulations css js frontend; do
    if [ ! -d "$dir" ]; then
        echo "❌ [致命] $dir/ 目录不存在！"
        ERRORS=$((ERRORS+1))
    fi
done

# 4. 关键数据文件检查
for file in data/ship_knowledge.json data/tech_index.json data/hifleet_daily.json; do
    if [ ! -f "$file" ]; then
        echo "⚠️ [警告] $file 不存在！"
        WARNINGS=$((WARNINGS+1))
    fi
done

# 5. 统计文件总数（应该>30）
TOTAL=$(find . -not -path './.git/*' -not -path './.wrangler/*' -not -name '.gitignore' -type f | wc -l)
if [ "$TOTAL" -lt 30 ]; then
    echo "❌ [致命] 文件总数只有 $TOTAL 个，疑似文件丢失！正常应该有 50+ 个文件"
    echo "   运行: find . -not -path './.git/*' -type f | wc -l"
    ERRORS=$((ERRORS+1))
else
    echo "✅ 文件总数: $TOTAL（正常）"
fi

# 6. 检查 index.html 是否引用不存在的文件
for ref in js/main.js js/search-index.js frontend/style.css; do
    if ! grep -q "$ref" index.html 2>/dev/null; then
        echo "⚠️ [警告] index.html 中找不到引用 $ref"
        WARNINGS=$((WARNINGS+1))
    fi
done

echo ""
echo "========================"
if [ "$ERRORS" -gt 0 ]; then
    echo "❌ $ERRORS 个致命错误 — 禁止推送！"
    exit 1
else
    echo "✅ 检查通过，可以推送"
    if [ "$WARNINGS" -gt 0 ]; then
        echo "⚠️ $WARNINGS 个警告（可推送但建议核实）"
    fi
fi
echo "========================"

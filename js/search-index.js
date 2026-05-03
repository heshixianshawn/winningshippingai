// WINNING Shipping AI 搜索索引
// 法规数据索引和搜索功能

// 模拟法规数据（实际应从服务器加载）
const regulationsData = {
    "lastUpdated": "2026-04-22",
    "totalFiles": 7,
    "categories": {
        "SOLAS": 2,
        "MARPOL": 2,
        "MLC": 1,
        "国内": 2
    },
    "files": []
};

// 搜索索引
let searchIndex = [];

// 初始化搜索索引
function initSearchIndex() {
    console.log("初始化搜索索引...");
    
    // 这里应该是从服务器加载实际数据
    // 暂时使用模拟数据
    loadSampleData();
    
    // 更新统计信息
    updateStatistics();
    
    // 初始化最近查看列表
    initRecentList();
    
    console.log("搜索索引初始化完成，文件数量:", regulationsData.files.length);
}

// 加载示例数据（测试用）
function loadSampleData() {
    // 所有法规文件数据
    regulationsData.files = [
        // SOLAS公约文件
        {
            id: "solas-real-001",
            title: "SOLAS 2024 综合文本（英文版）",
            category: "SOLAS",
            description: "国际海上人命安全公约2024年综合文本英文版，包含所有章节的最新整合版。文件大小11.3MB，完整版SOLAS公约。",
            filename: "SOLAS_2024_综合文本_英文版.pdf",
            path: "regulations/SOLAS/SOLAS_2024_综合文本_英文版.pdf",
            size: "11.3 MB",
            pages: 580,
            year: "2024",
            type: "综合文本",
            tags: ["SOLAS", "国际公约", "安全", "2024", "英文", "完整版"],
            added: "2026-04-19",
            views: 0
        },
        {
            id: "solas-sample-002",
            title: "SOLAS 第II-2章 防火（2024版）",
            category: "SOLAS",
            description: "SOLAS公约第II-2章关于船舶防火、探火和灭火的最新要求，包含2024年修正案内容。",
            filename: "SOLAS_第II-2章_防火_2024.pdf",
            path: "regulations/SOLAS/SOLAS_第II-2章_防火_2024.pdf",
            size: "2.1 MB",
            pages: 85,
            year: "2024",
            type: "章节文件",
            tags: ["SOLAS", "防火", "安全", "2024", "第II-2章"],
            added: "2026-04-22",
            views: 0
        },
        
        // MARPOL公约文件
        {
            id: "marpol-sample-001",
            title: "MARPOL 附则VI 防止空气污染（2024版）",
            category: "MARPOL",
            description: "MARPOL公约附则VI关于防止船舶造成空气污染的最新要求，包含硫排放控制、氮氧化物排放控制等。",
            filename: "MARPOL_附则VI_空气污染_2024.pdf",
            path: "regulations/MARPOL/附则VI/MARPOL_附则VI_空气污染_2024.pdf",
            size: "3.5 MB",
            pages: 120,
            year: "2024",
            type: "附则文件",
            tags: ["MARPOL", "空气污染", "环保", "硫排放", "2024"],
            added: "2026-04-22",
            views: 0
        },
        {
            id: "marpol-sample-002",
            title: "MARPOL 附则I 防止油类污染",
            category: "MARPOL",
            description: "MARPOL公约附则I关于防止船舶油类污染的国际规则，包含油船结构、设备要求等。",
            filename: "MARPOL_附则I_油类污染_2023.pdf",
            path: "regulations/MARPOL/附则I/MARPOL_附则I_油类污染_2023.pdf",
            size: "2.8 MB",
            pages: 95,
            year: "2023",
            type: "附则文件",
            tags: ["MARPOL", "油污染", "环保", "油船", "2023"],
            added: "2026-04-22",
            views: 0
        },
        
        // MLC公约文件
        {
            id: "mlc-sample-001",
            title: "MLC 2006 综合文本（中文版）",
            category: "MLC",
            description: "海事劳工公约2006年综合文本中文版，包含船员就业条件、起居舱室标准、健康保护等全部内容。",
            filename: "MLC_2006_综合文本_中文版.pdf",
            path: "regulations/MLC/综合文本/MLC_2006_综合文本_中文版.pdf",
            size: "4.2 MB",
            pages: 210,
            year: "2023",
            type: "综合文本",
            tags: ["MLC", "劳工", "船员", "就业", "中文"],
            added: "2026-04-22",
            views: 0
        },
        
        // 国内法规文件
        {
            id: "domestic-001",
            title: "中华人民共和国海商法（2023修订）",
            category: "国内",
            description: "中华人民共和国海商法最新修订版，包含船舶、船员、海上运输合同、海事赔偿责任限制等内容。",
            filename: "国内_海商法_2023.pdf",
            path: "regulations/国内/海商法/国内_海商法_2023.pdf",
            size: "1.8 MB",
            pages: 75,
            year: "2023",
            type: "法律文件",
            tags: ["国内", "海商法", "法律", "2023", "中国"],
            added: "2026-04-22",
            views: 0
        },
        {
            id: "domestic-002",
            title: "海上交通安全法（2021修订）",
            category: "国内",
            description: "中华人民共和国海上交通安全法2021年修订版，包含船舶航行、停泊、作业安全监督管理等内容。",
            filename: "国内_海上交通安全法_2021.pdf",
            path: "regulations/国内/交通安全法/国内_海上交通安全法_2021.pdf",
            size: "1.5 MB",
            pages: 62,
            year: "2021",
            type: "法律文件",
            tags: ["国内", "交通安全", "法律", "2021", "海事"],
            added: "2026-04-22",
            views: 0
        }
    ];
    
    // 更新统计
    regulationsData.totalFiles = regulationsData.files.length;
    regulationsData.categories.SOLAS = regulationsData.files.filter(f => f.category === "SOLAS").length;
    regulationsData.categories.MARPOL = regulationsData.files.filter(f => f.category === "MARPOL").length;
    regulationsData.categories.MLC = regulationsData.files.filter(f => f.category === "MLC").length;
    regulationsData.categories.国内 = regulationsData.files.filter(f => f.category === "国内").length;
    
    // 构建搜索索引
    buildSearchIndex();
}

// 构建搜索索引
function buildSearchIndex() {
    searchIndex = regulationsData.files.map(file => {
        return {
            id: file.id,
            title: file.title.toLowerCase(),
            description: file.description.toLowerCase(),
            category: file.category,
            tags: file.tags.map(tag => tag.toLowerCase()),
            year: file.year,
            type: file.type,
            // 搜索权重
            weight: {
                title: 3,
                tags: 2,
                description: 1
            }
        };
    });
}

// 搜索法规
function searchRegulations(query, categories = []) {
    console.log('搜索法规:', { query, categories });
    
    if (!query.trim() && categories.length === 0) {
        console.log('无查询条件，返回所有文件');
        return regulationsData.files; // 返回所有文件
    }
    
    const queryLower = query.toLowerCase().trim();
    const results = [];
    
    console.log('搜索文件数量:', regulationsData.files.length);
    
    regulationsData.files.forEach((file, index) => {
        // 分类过滤
        if (categories.length > 0 && !categories.includes(file.category)) {
            return;
        }
        
        let score = 0;
        let matchDetails = [];
        
        // 标题匹配
        if (file.title.toLowerCase().includes(queryLower)) {
            score += 30;
            matchDetails.push('标题匹配');
        }
        
        // 标签匹配
        file.tags.forEach(tag => {
            if (tag.toLowerCase().includes(queryLower)) {
                score += 20;
                matchDetails.push('标签匹配');
            }
        });
        
        // 描述匹配
        if (file.description.toLowerCase().includes(queryLower)) {
            score += 10;
            matchDetails.push('描述匹配');
        }
        
        // 年份匹配
        if (file.year.includes(queryLower)) {
            score += 5;
            matchDetails.push('年份匹配');
        }
        
        // 类型匹配
        if (file.type.toLowerCase().includes(queryLower)) {
            score += 5;
            matchDetails.push('类型匹配');
        }
        
        if (score > 0 || (query === '' && categories.length > 0)) {
            results.push({
                file: file,
                score: score,
                details: matchDetails
            });
            
            if (matchDetails.length > 0) {
                console.log(`文件匹配: ${file.title} (分数: ${score}, 匹配: ${matchDetails.join(', ')})`);
            }
        }
    });
    
    // 按分数排序
    results.sort((a, b) => b.score - a.score);
    
    console.log('搜索结果数量:', results.length);
    
    return results.map(r => r.file);
}

// 按分类获取文件
function getFilesByCategory(category) {
    if (category === 'all') {
        return regulationsData.files;
    }
    return regulationsData.files.filter(file => file.category === category);
}

// 获取文件详情
function getFileDetails(fileId) {
    const file = regulationsData.files.find(f => f.id === fileId);
    if (file) {
        // 增加查看次数
        file.views++;
        saveToRecent(file);
    }
    return file;
}

// 保存到最近查看
function saveToRecent(file) {
    let recent = JSON.parse(localStorage.getItem('recentFiles') || '[]');
    
    // 移除重复
    recent = recent.filter(f => f.id !== file.id);
    
    // 添加到开头
    recent.unshift({
        id: file.id,
        title: file.title,
        category: file.category,
        timestamp: new Date().toISOString()
    });
    
    // 只保留最近5个
    recent = recent.slice(0, 5);
    
    localStorage.setItem('recentFiles', JSON.stringify(recent));
    updateRecentList();
}

// 获取最近查看
function getRecentFiles() {
    return JSON.parse(localStorage.getItem('recentFiles') || '[]');
}

// 更新统计信息显示
function updateStatistics() {
    // 更新总数
    document.getElementById('totalFiles').textContent = regulationsData.totalFiles;
    
    // 更新分类计数
    document.getElementById('count-all').textContent = regulationsData.totalFiles;
    document.getElementById('count-solas').textContent = regulationsData.categories.SOLAS;
    document.getElementById('count-marpol').textContent = regulationsData.categories.MARPOL;
    document.getElementById('count-mlc').textContent = regulationsData.categories.MLC;
    document.getElementById('count-domestic').textContent = regulationsData.categories.国内;
    
    // 更新最后更新时间
    document.getElementById('lastUpdate').textContent = regulationsData.lastUpdated;
}

// 初始化最近查看列表
function initRecentList() {
    updateRecentList();
}

// 更新最近查看列表显示
function updateRecentList() {
    const recentList = document.getElementById('recentList');
    const recentFiles = getRecentFiles();
    
    if (recentFiles.length === 0) {
        recentList.innerHTML = '<li style="color: #999; font-style: italic;">暂无最近查看</li>';
        return;
    }
    
    recentList.innerHTML = recentFiles.map(file => `
        <li data-file-id="${file.id}">
            <i class="fas fa-file-pdf" style="color: #e74c3c; margin-right: 8px;"></i>
            ${file.title}
            <br>
            <small style="color: #666;">${formatTimeAgo(file.timestamp)}</small>
        </li>
    `).join('');
    
    // 添加点击事件
    recentList.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', function() {
            const fileId = this.getAttribute('data-file-id');
            openFilePreview(fileId);
        });
    });
}

// 格式化时间显示
function formatTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) {
        return `${diffMins}分钟前`;
    } else if (diffHours < 24) {
        return `${diffHours}小时前`;
    } else if (diffDays < 7) {
        return `${diffDays}天前`;
    } else {
        return time.toLocaleDateString('zh-CN');
    }
}

// 导出函数供主脚本使用
window.RegulationsSearch = {
    init: initSearchIndex,
    search: searchRegulations,
    getByCategory: getFilesByCategory,
    getFileDetails: getFileDetails,
    getRecentFiles: getRecentFiles,
    updateStatistics: updateStatistics,
    updateRecentList: updateRecentList
};
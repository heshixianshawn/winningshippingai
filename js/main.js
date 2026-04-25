// WINNING Shipping AI 主脚本
// 页面交互和功能控制

// 全局变量
let currentView = 'list';
let currentPage = 1;
const itemsPerPage = 10;
let currentResults = [];

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log("WINNING Shipping AI 初始化...");
    
    // 初始化搜索索引
    RegulationsSearch.init();
    
    // 绑定事件
    bindEvents();
    
    // 显示所有文件
    showAllFiles();
    
    console.log("初始化完成");
});

// 绑定所有事件
function bindEvents() {
    // 搜索按钮
    document.getElementById('searchBtn').addEventListener('click', performSearch);
    
    // 搜索输入框回车
    document.getElementById('searchInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
    
    // 分类导航
    document.querySelectorAll('.category-list li').forEach(item => {
        item.addEventListener('click', function() {
            // 移除其他active
            document.querySelectorAll('.category-list li').forEach(li => {
                li.classList.remove('active');
            });
            
            // 设置当前active
            this.classList.add('active');
            
            // 获取分类
            const category = this.getAttribute('data-category');
            showFilesByCategory(category);
        });
    });
    
    // 视图切换
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const view = this.getAttribute('data-view');
            switchView(view);
        });
    });
    
    // 关闭预览
    document.getElementById('closePreview').addEventListener('click', closePreview);
    
    // 下载按钮
    document.getElementById('downloadBtn').addEventListener('click', downloadFile);
    
    // 最近查看点击
    document.getElementById('recentList').addEventListener('click', function(e) {
        if (e.target.tagName === 'LI' || e.target.parentElement.tagName === 'LI') {
            const li = e.target.tagName === 'LI' ? e.target : e.target.parentElement;
            const fileId = li.getAttribute('data-file-id');
            if (fileId) {
                openFilePreview(fileId);
            }
        }
    });
    
    // 搜索筛选器变化
    document.querySelectorAll('.search-filters input').forEach(input => {
        input.addEventListener('change', performSearch);
    });
}

// 执行搜索
function performSearch() {
    console.log('执行搜索...');
    
    const query = document.getElementById('searchInput').value;
    const selectedCategories = getSelectedCategories();
    
    console.log('搜索参数:', { query, selectedCategories });
    
    // 执行搜索
    const results = RegulationsSearch.search(query, selectedCategories);
    
    console.log('搜索结果数量:', results.length);
    
    if (results.length === 0) {
        console.log('未找到结果，显示提示');
    }
    
    // 显示结果
    displayResults(results);
    
    // 更新搜索次数
    updateSearchCount();
}

// 获取选中的分类
function getSelectedCategories() {
    const selected = [];
    document.querySelectorAll('.search-filters input:checked').forEach(input => {
        selected.push(input.value);
    });
    return selected;
}

// 显示所有文件
function showAllFiles() {
    console.log('显示所有文件...');
    const files = RegulationsSearch.getByCategory('all');
    console.log('获取到的文件数量:', files.length);
    displayResults(files);
}

// 按分类显示文件
function showFilesByCategory(category) {
    const files = RegulationsSearch.getByCategory(category);
    displayResults(files);
}

// 显示搜索结果
function displayResults(files) {
    console.log('显示结果，文件数量:', files.length);
    
    currentResults = files;
    currentPage = 1;
    
    // 更新结果计数
    const resultsCount = document.getElementById('resultsCount');
    if (resultsCount) {
        resultsCount.textContent = `找到 ${files.length} 个文件`;
        console.log('更新结果计数:', files.length);
    }
    
    // 显示结果
    renderResultsPage();
    
    // 更新分页
    updatePagination();
}

// 渲染当前页结果
function renderResultsPage() {
    console.log('渲染结果页面，当前页:', currentPage);
    
    const container = document.getElementById('resultsContainer');
    if (!container) {
        console.error('找不到结果容器!');
        return;
    }
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageFiles = currentResults.slice(startIndex, endIndex);
    
    console.log('当前页文件:', pageFiles.length);
    
    if (pageFiles.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-search fa-3x"></i>
                <h4>未找到相关文件</h4>
                <p>尝试使用其他关键词或选择其他分类</p>
                <p><small>调试信息: currentResults=${currentResults.length}, pageFiles=${pageFiles.length}</small></p>
            </div>
        `;
        return;
    }
    
    let html = '';
    if (currentView === 'list') {
        html = pageFiles.map(file => createFileCard(file)).join('');
    } else {
        html = pageFiles.map(file => createFileGrid(file)).join('');
    }
    
    console.log('生成的HTML长度:', html.length);
    container.innerHTML = html;
    
    // 绑定文件卡片事件
    bindFileCardEvents();
}

// 创建文件卡片（列表视图）
function createFileCard(file) {
    return `
        <div class="file-card" data-file-id="${file.id}">
            <div class="file-header">
                <h3 class="file-title">${file.title}</h3>
                <span class="file-badge">${file.category}</span>
            </div>
            <div class="file-meta">
                <span><i class="far fa-file-pdf"></i> ${file.filename}</span>
                <span><i class="far fa-calendar"></i> ${file.year}年</span>
                <span><i class="far fa-file"></i> ${file.pages}页</span>
                <span><i class="fas fa-weight"></i> ${file.size}</span>
                <span><i class="far fa-eye"></i> ${file.views}次查看</span>
            </div>
            <div class="file-description">
                ${file.description}
            </div>
            <div class="file-tags">
                ${file.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>
            <div class="file-actions">
                <button class="btn btn-primary preview-btn" data-file-id="${file.id}">
                    <i class="fas fa-eye"></i> 预览
                </button>
                <button class="btn btn-secondary download-btn" data-file-id="${file.id}">
                    <i class="fas fa-download"></i> 下载
                </button>
            </div>
        </div>
    `;
}

// 创建文件网格（网格视图）
function createFileGrid(file) {
    return `
        <div class="file-grid" data-file-id="${file.id}">
            <div class="grid-icon">
                <i class="far fa-file-pdf fa-3x"></i>
            </div>
            <div class="grid-content">
                <h4>${file.title}</h4>
                <p class="grid-category">${file.category}</p>
                <p class="grid-meta">${file.year}年 · ${file.size}</p>
                <div class="grid-actions">
                    <button class="btn btn-sm btn-primary preview-btn" data-file-id="${file.id}">预览</button>
                    <button class="btn btn-sm btn-secondary download-btn" data-file-id="${file.id}">下载</button>
                </div>
            </div>
        </div>
    `;
}

// 绑定文件卡片事件
function bindFileCardEvents() {
    // 预览按钮
    document.querySelectorAll('.preview-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const fileId = this.getAttribute('data-file-id');
            openFilePreview(fileId);
        });
    });
    
    // 下载按钮
    document.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const fileId = this.getAttribute('data-file-id');
            downloadFileById(fileId);
        });
    });
    
    // 整个卡片点击（除了按钮区域）
    document.querySelectorAll('.file-card, .file-grid').forEach(card => {
        card.addEventListener('click', function(e) {
            // 如果点击的是按钮，不触发卡片点击
            if (!e.target.closest('button')) {
                const fileId = this.getAttribute('data-file-id');
                openFilePreview(fileId);
            }
        });
    });
}

// 打开文件预览
function openFilePreview(fileId) {
    const file = RegulationsSearch.getFileDetails(fileId);
    if (!file) return;
    
    // 更新预览标题
    document.getElementById('previewTitle').textContent = file.title;
    
    // 显示预览内容（这里模拟PDF预览）
    const previewContent = document.getElementById('previewContent');
    previewContent.innerHTML = `
        <div class="pdf-preview">
            <div class="pdf-header">
                <h4>${file.filename}</h4>
                <p>文件信息：${file.size} · ${file.pages}页 · ${file.year}年版本</p>
            </div>
            <div class="pdf-viewer">
                <div class="pdf-placeholder">
                    <i class="far fa-file-pdf fa-5x"></i>
                    <p>PDF预览区域</p>
                    <p>实际部署后将显示PDF文件内容</p>
                </div>
            </div>
            <div class="pdf-info">
                <h5>文件详情</h5>
                <ul>
                    <li><strong>分类：</strong>${file.category}</li>
                    <li><strong>类型：</strong>${file.type}</li>
                    <li><strong>添加时间：</strong>${file.added}</li>
                    <li><strong>查看次数：</strong>${file.views}</li>
                </ul>
                <h5>文件描述</h5>
                <p>${file.description}</p>
                <h5>标签</h5>
                <div class="preview-tags">
                    ${file.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                </div>
            </div>
        </div>
    `;
    
    // 设置下载按钮
    document.getElementById('downloadBtn').setAttribute('data-file-id', fileId);
    
    // 显示预览区域
    document.getElementById('previewSection').style.display = 'block';
    
    // 滚动到预览区域
    document.getElementById('previewSection').scrollIntoView({ behavior: 'smooth' });
}

// 关闭预览
function closePreview() {
    document.getElementById('previewSection').style.display = 'none';
}

// 下载文件
function downloadFile() {
    const fileId = this.getAttribute('data-file-id');
    downloadFileById(fileId);
}

// 根据ID下载文件
function downloadFileById(fileId) {
    const file = RegulationsSearch.getFileDetails(fileId);
    if (!file) return;
    
    // 模拟下载（实际部署时应有真实文件）
    alert(`开始下载：${file.filename}\n\n实际部署后，这里将提供真实的PDF文件下载。`);
    
    // 记录下载（可以发送到服务器）
    console.log(`用户下载了文件：${file.title}`);
}

// 切换视图
function switchView(view) {
    if (view === currentView) return;
    
    currentView = view;
    
    // 更新按钮状态
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-view') === view) {
            btn.classList.add('active');
        }
    });
    
    // 重新渲染结果
    renderResultsPage();
}

// 更新分页
function updatePagination() {
    const totalPages = Math.ceil(currentResults.length / itemsPerPage);
    const pagination = document.getElementById('pagination');
    
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    let html = '';
    
    // 上一页按钮
    html += `<button class="page-btn ${currentPage === 1 ? 'disabled' : ''}" data-page="prev">上一页</button>`;
    
    // 页码按钮
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    
    if (endPage - startPage + 1 < maxVisible) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }
    
    // 下一页按钮
    html += `<button class="page-btn ${currentPage === totalPages ? 'disabled' : ''}" data-page="next">下一页</button>`;
    
    pagination.innerHTML = html;
    
    // 绑定分页事件
    bindPaginationEvents();
}

// 绑定分页事件
function bindPaginationEvents() {
    document.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            if (this.classList.contains('disabled')) return;
            
            const page = this.getAttribute('data-page');
            
            if (page === 'prev') {
                currentPage--;
            } else if (page === 'next') {
                currentPage++;
            } else {
                currentPage = parseInt(page);
            }
            
            renderResultsPage();
            updatePagination();
            
            // 滚动到结果顶部
            document.getElementById('resultsContainer').scrollIntoView({ behavior: 'smooth' });
        });
    });
}

// 更新搜索次数
function updateSearchCount() {
    let searchCount = parseInt(localStorage.getItem('searchCount') || '0');
    searchCount++;
    localStorage.setItem('searchCount', searchCount.toString());
    document.getElementById('searchCount').textContent = searchCount;
}

// 添加一些CSS样式（用于网格视图和标签）
const style = document.createElement('style');
style.textContent = `
    .file-tags {
        margin-bottom: 15px;
    }
    
    .tag {
        display: inline-block;
        background: #e9ecef;
        color: #495057;
        padding: 4px 10px;
        border-radius: 12px;
        font-size: 12px;
        margin-right: 8px;
        margin-bottom: 8px;
    }
    
    .file-grid {
        display: inline-block;
        width: calc(50% - 10px);
        margin: 5px;
        background: white;
        border: 1px solid #dee2e6;
        border-radius: 6px;
        padding: 20px;
        text-align: center;
        vertical-align: top;
    }
    
    @media (max-width: 768px) {
        .file-grid {
            width: 100%;
            margin: 5px 0;
        }
    }
    
    .grid-icon {
        margin-bottom: 15px;
        color: #e74c3c;
    }
    
    .grid-content h4 {
        margin: 0 0 10px 0;
        font-size: 16px;
        color: #1a5f7a;
    }
    
    .grid-category {
        background: #1a5f7a;
        color: white;
        display: inline-block;
        padding: 2px 10px;
        border-radius: 12px;
        font-size: 12px;
        margin-bottom: 10px;
    }
    
    .grid-meta {
        color: #6c757d;
        font-size: 13px;
        margin-bottom: 15px;
    }
    
    .grid-actions {
        display: flex;
        gap: 10px;
        justify-content: center;
    }
    
    .btn-sm {
        padding: 6px 12px;
        font-size: 13px;
    }
    
    .pdf-preview {
        background: white;
        border-radius: 6px;
        padding: 20px;
    }
    
    .pdf-header {
        border-bottom: 1px solid #dee2e6;
        padding-bottom: 15px;
        margin-bottom: 20px;
    }
    
    .pdf-viewer {
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        padding: 40px;
        text-align: center;
        margin-bottom: 20px;
        min-height: 300px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .pdf-placeholder i {
        color: #e74c3c;
        margin-bottom: 15px;
    }
    
    .pdf-info h5 {
        color: #1a5f7a;
        margin: 20px 0 10px 0;
        font-size: 16px;
    }
    
    .pdf-info ul {
        list-style: none;
        padding: 0;
    }
    
    .pdf-info ul li {
        padding: 5px 0;
        border-bottom: 1px solid #f0f0f0;
    }
    
    .preview-tags {
        margin-top: 10px;
    }
`;
document.head.appendChild(style);
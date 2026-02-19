// Gallery Page JavaScript - "To Do with 사진" 전용
// 3가지 레이아웃: Magazine Timeline, Photo Mosaic, Kanban Board
if (typeof window._galleryJsLoaded === 'undefined') {
    window._galleryJsLoaded = true;

// ===== 전역 변수 =====
let galleryLayout = 'magazine'; // 'magazine' | 'mosaic' | 'kanban'
let galleryFilter = 'all'; // 'all' | 'with-photos' | 'no-photos'
let galleryLightboxImages = [];
let galleryLightboxIndex = 0;

// ===== 초기화 =====
function initializeGalleryPage() {
    window.initializeGalleryPage = initializeGalleryPage;
    
    // 저장된 레이아웃 설정 복원
    const savedLayout = localStorage.getItem('galleryLayout');
    if (savedLayout) {
        galleryLayout = savedLayout;
        const select = document.getElementById('gallery-layout-select');
        if (select) select.value = galleryLayout;
    }
    
    // tasks가 이미 로드되어 있으면 렌더링
    if (window.tasks && Array.isArray(window.tasks) && window.tasks.length > 0) {
        renderGallery();
    }
}
window.initializeGalleryPage = initializeGalleryPage;

// 이벤트 리스너 등록 (중복 방지)
if (!window._galleryEventListenersRegistered) {
    document.addEventListener('DOMContentLoaded', () => {
        initializeGalleryPage();
    });

    window.addEventListener('pageLoaded', (event) => {
        if (event.detail?.path === '/todowithphoto') {
            setTimeout(() => {
                initializeGalleryPage();
            }, 100);
        }
    });

    window.addEventListener('tasksLoaded', (event) => {
        if (document.getElementById('gallery-container')) {
            renderGallery();
        }
    });

    window._galleryEventListenersRegistered = true;
}

// 이미 tasks가 로드된 경우 즉시 렌더링 시도
if (window.tasks && Array.isArray(window.tasks) && window.tasks.length > 0) {
    setTimeout(() => {
        if (document.getElementById('gallery-container')) {
            renderGallery();
        }
    }, 200);
}

// ===== 레이아웃 변경 =====
function changeGalleryLayout(layout) {
    galleryLayout = layout;
    localStorage.setItem('galleryLayout', layout);
    renderGallery();
}
window.changeGalleryLayout = changeGalleryLayout;

// ===== 필터 변경 =====
function setGalleryFilter(filter) {
    galleryFilter = filter;
    
    // 버튼 활성 상태 업데이트
    document.querySelectorAll('.gallery-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === filter);
    });
    
    renderGallery();
}
window.setGalleryFilter = setGalleryFilter;

// ===== 데이터 헬퍼 =====
function getAllActivitiesWithContext() {
    const tasks = window.tasks || [];
    const activities = [];
    
    tasks.forEach(task => {
        (task.activities || []).forEach(activity => {
            activities.push({
                ...activity,
                taskId: task.id,
                taskName: task.name,
                taskPriority: task.priority,
                taskTags: task.tags || [],
                taskAssignees: task.assignees || (task.assignee ? [task.assignee] : [])
            });
        });
    });
    
    // 필터 적용
    let filtered = activities;
    if (galleryFilter === 'with-photos') {
        filtered = activities.filter(a => a.images && a.images.length > 0);
    } else if (galleryFilter === 'no-photos') {
        filtered = activities.filter(a => !a.images || a.images.length === 0);
    }
    
    // 마감일 기준 정렬
    filtered.sort((a, b) => {
        const dateA = new Date(a.dueDate || '9999-12-31');
        const dateB = new Date(b.dueDate || '9999-12-31');
        return dateA - dateB;
    });
    
    return filtered;
}

function getStatusInfo(status) {
    const map = {
        'pending': { label: '대기', icon: 'fa-clock', color: '#64748b', bgColor: 'rgba(100,116,139,0.1)' },
        'in-progress': { label: '진행중', icon: 'fa-spinner', color: '#3b82f6', bgColor: 'rgba(59,130,246,0.1)' },
        'completed': { label: '완료', icon: 'fa-check-circle', color: '#22c55e', bgColor: 'rgba(34,197,94,0.1)' },
        'overdue': { label: '지연', icon: 'fa-exclamation-triangle', color: '#ef4444', bgColor: 'rgba(239,68,68,0.1)' }
    };
    return map[status] || map['pending'];
}

function formatGalleryDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
}

function formatGalleryDateFull(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getDate()).padStart(2,'0')}`;
}

function getDaysRemaining(dueDate) {
    if (!dueDate) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const due = new Date(dueDate);
    due.setHours(0, 0, 0, 0);
    return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

function getDaysRemainingLabel(dueDate) {
    const days = getDaysRemaining(dueDate);
    if (days === null) return '';
    if (days < 0) return `<span class="days-overdue">D+${Math.abs(days)}</span>`;
    if (days === 0) return `<span class="days-today">D-Day</span>`;
    if (days <= 3) return `<span class="days-soon">D-${days}</span>`;
    return `<span class="days-normal">D-${days}</span>`;
}

// ===== 메인 렌더 분기 =====
function renderGallery() {
    const container = document.getElementById('gallery-container');
    if (!container) return;
    
    const activities = getAllActivitiesWithContext();
    
    if (activities.length === 0) {
        container.innerHTML = `
            <div class="gallery-empty">
                <i class="fas fa-camera" style="font-size: 64px; opacity: 0.2; margin-bottom: 20px;"></i>
                <h3>표시할 Activity가 없습니다</h3>
                <p>To Do 페이지에서 태스크와 Activity를 추가해보세요.</p>
            </div>`;
        container.className = '';
        return;
    }
    
    switch (galleryLayout) {
        case 'magazine':
            container.className = 'gallery-magazine';
            renderMagazineLayout(container, activities);
            break;
        case 'mosaic':
            container.className = 'gallery-mosaic';
            renderMosaicLayout(container, activities);
            break;
        case 'kanban':
            container.className = 'gallery-kanban';
            renderKanbanLayout(container, activities);
            break;
    }
}
window.renderGallery = renderGallery;


// ================================================
// LAYOUT 1: 📰 Magazine Timeline
// - 세로 타임라인, 좌우 교차 카드
// - 큰 사진, 에디토리얼 느낌
// ================================================
function renderMagazineLayout(container, activities) {
    const tasks = window.tasks || [];
    
    // Task별로 그룹핑
    const taskGroups = {};
    activities.forEach(a => {
        if (!taskGroups[a.taskId]) {
            taskGroups[a.taskId] = {
                taskName: a.taskName,
                taskPriority: a.taskPriority,
                taskTags: a.taskTags,
                activities: []
            };
        }
        taskGroups[a.taskId].activities.push(a);
    });
    
    let html = '';
    
    Object.entries(taskGroups).forEach(([taskId, group]) => {
        // 완료율 계산
        const total = group.activities.length;
        const completed = group.activities.filter(a => a.status === 'completed').length;
        const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
        const totalPhotos = group.activities.reduce((sum, a) => sum + (a.images?.length || 0), 0);
        
        html += `
        <div class="mag-task-section">
            <div class="mag-task-header">
                <div class="mag-task-info">
                    <div class="mag-task-tags">
                        ${group.taskTags.slice(0, 3).map(t => `<span class="mag-tag">#${t}</span>`).join('')}
                    </div>
                    <h2 class="mag-task-name">${group.taskName}</h2>
                    <div class="mag-task-meta">
                        <span><i class="fas fa-list-check"></i> ${completed}/${total} 완료</span>
                        <span><i class="fas fa-images"></i> 사진 ${totalPhotos}장</span>
                    </div>
                </div>
                <div class="mag-task-progress">
                    <div class="mag-progress-circle" style="--pct: ${completionPct}">
                        <span>${completionPct}%</span>
                    </div>
                </div>
            </div>
            
            <div class="mag-timeline">
                <div class="mag-timeline-line"></div>
                ${group.activities.map((activity, idx) => renderMagazineCard(activity, idx)).join('')}
            </div>
        </div>`;
    });
    
    container.innerHTML = html;
}

function renderMagazineCard(activity, index) {
    const status = getStatusInfo(activity.status);
    const images = activity.images || [];
    const side = index % 2 === 0 ? 'left' : 'right';
    const daysLabel = getDaysRemainingLabel(activity.dueDate);
    
    return `
    <div class="mag-card mag-card-${side}" data-status="${activity.status}">
        <div class="mag-card-dot" style="background: ${status.color};"></div>
        <div class="mag-card-content">
            <div class="mag-card-header">
                <div class="mag-card-status" style="background: ${status.bgColor}; color: ${status.color};">
                    <i class="fas ${status.icon}"></i> ${status.label}
                </div>
                <span class="mag-card-date">
                    <i class="fas fa-calendar-alt"></i>
                    ${formatGalleryDateFull(activity.startDate || activity.dueDate)} ~ ${formatGalleryDateFull(activity.dueDate)}
                </span>
                ${daysLabel}
            </div>
            <h3 class="mag-card-title">${activity.name}</h3>
            ${activity.description ? `<p class="mag-card-desc">${activity.description}</p>` : ''}
            ${activity.assignees && activity.assignees.length > 0 ? `
            <div class="mag-card-assignees">
                ${activity.assignees.map(a => `<span class="mag-assignee"><i class="fas fa-user"></i> ${a}</span>`).join('')}
            </div>` : ''}
            ${images.length > 0 ? `
            <div class="mag-card-gallery">
                ${images.length === 1 ? `
                <div class="mag-photo-single" onclick="openGalleryLightbox(${JSON.stringify(images.map(i=>i.url)).replace(/"/g, '&quot;')}, 0)">
                    <img src="${images[0].url}" alt="${activity.name}" loading="lazy">
                </div>
                ` : images.length === 2 ? `
                <div class="mag-photo-duo">
                    ${images.map((img, i) => `
                    <div class="mag-photo-duo-item" onclick="openGalleryLightbox(${JSON.stringify(images.map(ii=>ii.url)).replace(/"/g, '&quot;')}, ${i})">
                        <img src="${img.url}" alt="${activity.name}" loading="lazy">
                    </div>`).join('')}
                </div>
                ` : `
                <div class="mag-photo-grid">
                    <div class="mag-photo-main" onclick="openGalleryLightbox(${JSON.stringify(images.map(i=>i.url)).replace(/"/g, '&quot;')}, 0)">
                        <img src="${images[0].url}" alt="${activity.name}" loading="lazy">
                    </div>
                    <div class="mag-photo-thumbs">
                        ${images.slice(1, 4).map((img, i) => `
                        <div class="mag-photo-thumb ${i === 2 && images.length > 4 ? 'mag-photo-more' : ''}" 
                             onclick="openGalleryLightbox(${JSON.stringify(images.map(ii=>ii.url)).replace(/"/g, '&quot;')}, ${i + 1})">
                            <img src="${img.url}" alt="${activity.name}" loading="lazy">
                            ${i === 2 && images.length > 4 ? `<div class="mag-more-overlay">+${images.length - 4}</div>` : ''}
                        </div>`).join('')}
                    </div>
                </div>
                `}
            </div>
            ` : `
            <div class="mag-no-photo">
                <div class="mag-upload-area"
                     data-activity-id="${activity.id}" 
                     data-task-id="${activity.taskId}"
                     ondrop="handleGalleryImageDrop(event)" 
                     ondragover="handleGalleryDragOver(event)" 
                     ondragleave="handleGalleryDragLeave(event)"
                     onclick="triggerGalleryUpload('${activity.taskId}', '${activity.id}')">
                    <input type="file" class="gallery-image-input" 
                           data-activity-id="${activity.id}" 
                           data-task-id="${activity.taskId}"
                           accept="image/*" multiple style="display: none;">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <span>사진 추가</span>
                </div>
            </div>
            `}
            ${images.length > 0 ? `
            <div class="mag-card-upload-bar">
                <div class="mag-upload-inline"
                     data-activity-id="${activity.id}" 
                     data-task-id="${activity.taskId}"
                     ondrop="handleGalleryImageDrop(event)" 
                     ondragover="handleGalleryDragOver(event)" 
                     ondragleave="handleGalleryDragLeave(event)"
                     onclick="triggerGalleryUpload('${activity.taskId}', '${activity.id}')">
                    <input type="file" class="gallery-image-input" 
                           data-activity-id="${activity.id}" 
                           data-task-id="${activity.taskId}"
                           accept="image/*" multiple style="display: none;">
                    <i class="fas fa-plus"></i> 사진 추가
                </div>
            </div>` : ''}
        </div>
    </div>`;
}


// ================================================
// LAYOUT 2: 📸 Photo Mosaic
// - Pinterest/인스타 스타일 그리드
// - 사진 중심, 호버 시 정보
// ================================================
function renderMosaicLayout(container, activities) {
    // 사진이 있는 활동 우선 정렬
    const sorted = [...activities].sort((a, b) => {
        const aPhotos = a.images?.length || 0;
        const bPhotos = b.images?.length || 0;
        if (aPhotos > 0 && bPhotos === 0) return -1;
        if (aPhotos === 0 && bPhotos > 0) return 1;
        return 0;
    });
    
    let html = `<div class="mosaic-grid">`;
    
    sorted.forEach(activity => {
        const status = getStatusInfo(activity.status);
        const images = activity.images || [];
        const daysLabel = getDaysRemainingLabel(activity.dueDate);
        
        if (images.length > 0) {
            // 사진이 있는 카드 - 각 사진을 개별 카드로
            images.forEach((img, imgIdx) => {
                html += `
                <div class="mosaic-card mosaic-card-photo" 
                     onclick="openGalleryLightbox(${JSON.stringify(images.map(i=>i.url)).replace(/"/g, '&quot;')}, ${imgIdx})">
                    <div class="mosaic-img-wrapper">
                        <img src="${img.url}" alt="${activity.name}" loading="lazy">
                        <div class="mosaic-overlay">
                            <div class="mosaic-overlay-top">
                                <span class="mosaic-status" style="background: ${status.color};">
                                    <i class="fas ${status.icon}"></i> ${status.label}
                                </span>
                                ${daysLabel}
                            </div>
                            <div class="mosaic-overlay-bottom">
                                <h4 class="mosaic-title">${activity.name}</h4>
                                <span class="mosaic-task-label">
                                    <i class="fas fa-folder"></i> ${activity.taskName}
                                </span>
                                ${activity.assignees?.length > 0 ? `
                                <span class="mosaic-assignee">
                                    <i class="fas fa-user"></i> ${activity.assignees.join(', ')}
                                </span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="mosaic-card-footer">
                        <span class="mosaic-photo-count"><i class="fas fa-images"></i> ${imgIdx + 1}/${images.length}</span>
                        <span class="mosaic-date">${formatGalleryDate(activity.dueDate)}</span>
                    </div>
                </div>`;
            });
        } else {
            // 사진이 없는 카드 - 업로드 카드
            html += `
            <div class="mosaic-card mosaic-card-empty">
                <div class="mosaic-empty-content">
                    <div class="mosaic-empty-status" style="background: ${status.bgColor}; color: ${status.color};">
                        <i class="fas ${status.icon}"></i> ${status.label}
                    </div>
                    <h4 class="mosaic-empty-title">${activity.name}</h4>
                    <span class="mosaic-empty-task"><i class="fas fa-folder"></i> ${activity.taskName}</span>
                    <div class="mosaic-empty-meta">
                        <span><i class="fas fa-calendar"></i> ~${formatGalleryDate(activity.dueDate)}</span>
                        ${activity.assignees?.length > 0 ? `<span><i class="fas fa-user"></i> ${activity.assignees.join(', ')}</span>` : ''}
                        ${daysLabel}
                    </div>
                    <div class="mosaic-upload-area"
                         data-activity-id="${activity.id}" 
                         data-task-id="${activity.taskId}"
                         ondrop="handleGalleryImageDrop(event)" 
                         ondragover="handleGalleryDragOver(event)" 
                         ondragleave="handleGalleryDragLeave(event)"
                         onclick="event.stopPropagation(); triggerGalleryUpload('${activity.taskId}', '${activity.id}')">
                        <input type="file" class="gallery-image-input" 
                               data-activity-id="${activity.id}" 
                               data-task-id="${activity.taskId}"
                               accept="image/*" multiple style="display: none;">
                        <i class="fas fa-camera-retro"></i>
                        <span>사진 추가</span>
                    </div>
                </div>
            </div>`;
        }
    });
    
    html += `</div>`;
    container.innerHTML = html;
}


// ================================================
// LAYOUT 3: 📋 Kanban Board
// - 태스크별 수평 컬럼
// - 각 컬럼에 Activity 카드 (사진 + 상태)
// ================================================
function renderKanbanLayout(container, activities) {
    const tasks = window.tasks || [];
    
    // Task별 그룹핑
    const taskGroups = {};
    activities.forEach(a => {
        if (!taskGroups[a.taskId]) {
            taskGroups[a.taskId] = {
                taskName: a.taskName,
                taskPriority: a.taskPriority,
                taskTags: a.taskTags,
                activities: []
            };
        }
        taskGroups[a.taskId].activities.push(a);
    });
    
    let html = `<div class="kanban-board">`;
    
    Object.entries(taskGroups).forEach(([taskId, group]) => {
        const completed = group.activities.filter(a => a.status === 'completed').length;
        const total = group.activities.length;
        const totalPhotos = group.activities.reduce((sum, a) => sum + (a.images?.length || 0), 0);
        const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        html += `
        <div class="kanban-column">
            <div class="kanban-column-header">
                <div class="kanban-column-title">
                    <h3>${group.taskName}</h3>
                    <div class="kanban-column-stats">
                        <span class="kanban-stat"><i class="fas fa-list-check"></i> ${completed}/${total}</span>
                        <span class="kanban-stat"><i class="fas fa-camera"></i> ${totalPhotos}</span>
                    </div>
                </div>
                <div class="kanban-progress-bar">
                    <div class="kanban-progress-fill" style="width: ${completionPct}%"></div>
                </div>
            </div>
            <div class="kanban-column-body">`;
        
        group.activities.forEach(activity => {
            const status = getStatusInfo(activity.status);
            const images = activity.images || [];
            const daysLabel = getDaysRemainingLabel(activity.dueDate);
            
            html += `
                <div class="kanban-card" data-status="${activity.status}">
                    <div class="kanban-card-status-bar" style="background: ${status.color};"></div>
                    <div class="kanban-card-header">
                        <span class="kanban-status-badge" style="background: ${status.bgColor}; color: ${status.color};">
                            <i class="fas ${status.icon}"></i> ${status.label}
                        </span>
                        ${daysLabel}
                    </div>
                    <h4 class="kanban-card-title">${activity.name}</h4>
                    ${activity.description ? `<p class="kanban-card-desc">${activity.description}</p>` : ''}
                    <div class="kanban-card-meta">
                        <span><i class="fas fa-calendar"></i> ${formatGalleryDate(activity.startDate || activity.dueDate)} ~ ${formatGalleryDate(activity.dueDate)}</span>
                        ${activity.assignees?.length > 0 ? `<span><i class="fas fa-user"></i> ${activity.assignees.join(', ')}</span>` : ''}
                    </div>
                    ${images.length > 0 ? `
                    <div class="kanban-card-photos">
                        ${images.slice(0, 3).map((img, i) => `
                        <div class="kanban-photo" onclick="openGalleryLightbox(${JSON.stringify(images.map(ii=>ii.url)).replace(/"/g, '&quot;')}, ${i})">
                            <img src="${img.url}" alt="${activity.name}" loading="lazy">
                            ${i === 2 && images.length > 3 ? `<div class="kanban-photo-more">+${images.length - 3}</div>` : ''}
                        </div>`).join('')}
                    </div>` : ''}
                    <div class="kanban-card-upload"
                         data-activity-id="${activity.id}" 
                         data-task-id="${activity.taskId}"
                         ondrop="handleGalleryImageDrop(event)" 
                         ondragover="handleGalleryDragOver(event)" 
                         ondragleave="handleGalleryDragLeave(event)"
                         onclick="triggerGalleryUpload('${activity.taskId}', '${activity.id}')">
                        <input type="file" class="gallery-image-input" 
                               data-activity-id="${activity.id}" 
                               data-task-id="${activity.taskId}"
                               accept="image/*" multiple style="display: none;">
                        <i class="fas fa-plus"></i> 사진 ${images.length > 0 ? '추가' : '업로드'}
                    </div>
                </div>`;
        });
        
        html += `
            </div>
        </div>`;
    });
    
    html += `</div>`;
    container.innerHTML = html;
}


// ===== 이미지 업로드 (공통) =====
function triggerGalleryUpload(taskId, activityId) {
    const inputs = document.querySelectorAll(`input.gallery-image-input[data-task-id="${taskId}"][data-activity-id="${activityId}"]`);
    if (inputs.length > 0) {
        inputs[0].click();
    }
}
window.triggerGalleryUpload = triggerGalleryUpload;

// 파일 선택 시 업로드 처리
document.addEventListener('change', async (e) => {
    if (e.target.classList.contains('gallery-image-input')) {
        const taskId = e.target.getAttribute('data-task-id');
        const activityId = e.target.getAttribute('data-activity-id');
        const files = Array.from(e.target.files);
        
        if (files.length > 0) {
            await uploadGalleryImages(taskId, activityId, files);
            e.target.value = '';
        }
    }
});

function handleGalleryDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drag-over');
}
window.handleGalleryDragOver = handleGalleryDragOver;

function handleGalleryDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
}
window.handleGalleryDragLeave = handleGalleryDragLeave;

function handleGalleryImageDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
    
    const taskId = e.currentTarget.getAttribute('data-task-id');
    const activityId = e.currentTarget.getAttribute('data-activity-id');
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    
    if (files.length > 0) {
        uploadGalleryImages(taskId, activityId, files);
    }
}
window.handleGalleryImageDrop = handleGalleryImageDrop;

async function uploadGalleryImages(taskId, activityId, files) {
    if (!window.firebaseStorage) {
        if (typeof showToast === 'function') showToast('Firebase Storage가 초기화되지 않았습니다.', 'error');
        return;
    }
    
    const wsId = window.currentWorkspaceId;
    if (!wsId) {
        if (typeof showToast === 'function') showToast('워크스페이스 ID가 없습니다.', 'error');
        return;
    }
    
    const tasks = window.tasks || [];
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const activity = task.activities.find(a => a.id === activityId);
    if (!activity) return;
    
    if (!activity.images) activity.images = [];
    
    try {
        const { ref, uploadBytesResumable, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js");
        
        const uploadPromises = files.map(async (file) => {
            if (file.size > 10 * 1024 * 1024) {
                throw new Error(`파일 "${file.name}"이 너무 큽니다. (최대 10MB)`);
            }
            if (!file.type.startsWith('image/')) {
                throw new Error(`파일 "${file.name}"은 이미지 파일이 아닙니다.`);
            }
            
            const imageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
            const storagePath = `workspaces/${wsId}/tasks/${taskId}/activities/${activityId}/images/${imageId}_${file.name}`;
            const storageRef = ref(window.firebaseStorage, storagePath);
            
            const uploadTask = uploadBytesResumable(storageRef, file);
            
            return new Promise((resolve, reject) => {
                uploadTask.on('state_changed',
                    (snapshot) => {},
                    (error) => reject(error),
                    async () => {
                        try {
                            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                            resolve({
                                url: downloadURL,
                                uploadedAt: new Date().toISOString(),
                                uploadedBy: window.firebaseAuth?.currentUser?.email || 'unknown',
                                fileName: file.name,
                                size: file.size
                            });
                        } catch (error) {
                            reject(error);
                        }
                    }
                );
            });
        });
        
        const uploadedImages = await Promise.all(uploadPromises);
        activity.images.push(...uploadedImages);
        
        if (window.saveTaskToFirestore) {
            await window.saveTaskToFirestore(task, wsId);
        }
        
        renderGallery();
        if (typeof showToast === 'function') showToast(`${uploadedImages.length}개의 사진이 업로드되었습니다.`, 'success');
        
    } catch (error) {
        console.error('이미지 업로드 오류:', error);
        if (typeof showToast === 'function') showToast(`이미지 업로드 실패: ${error.message}`, 'error');
    }
}


// ===== 라이트박스 =====
function openGalleryLightbox(imageUrls, startIndex) {
    galleryLightboxImages = imageUrls;
    galleryLightboxIndex = startIndex || 0;
    
    const lightbox = document.getElementById('gallery-lightbox');
    const img = document.getElementById('gallery-lightbox-img');
    const info = document.getElementById('gallery-lightbox-info');
    
    if (!lightbox || !img) return;
    
    img.src = galleryLightboxImages[galleryLightboxIndex];
    info.textContent = `${galleryLightboxIndex + 1} / ${galleryLightboxImages.length}`;
    lightbox.style.display = 'flex';
    
    document.body.style.overflow = 'hidden';
}
window.openGalleryLightbox = openGalleryLightbox;

function closeGalleryLightbox() {
    const lightbox = document.getElementById('gallery-lightbox');
    if (lightbox) lightbox.style.display = 'none';
    document.body.style.overflow = '';
}
window.closeGalleryLightbox = closeGalleryLightbox;

function navigateGalleryLightbox(direction) {
    galleryLightboxIndex += direction;
    if (galleryLightboxIndex < 0) galleryLightboxIndex = galleryLightboxImages.length - 1;
    if (galleryLightboxIndex >= galleryLightboxImages.length) galleryLightboxIndex = 0;
    
    const img = document.getElementById('gallery-lightbox-img');
    const info = document.getElementById('gallery-lightbox-info');
    if (img) img.src = galleryLightboxImages[galleryLightboxIndex];
    if (info) info.textContent = `${galleryLightboxIndex + 1} / ${galleryLightboxImages.length}`;
}
window.navigateGalleryLightbox = navigateGalleryLightbox;

// 키보드 이벤트 (ESC, 좌/우 화살표)
document.addEventListener('keydown', (e) => {
    const lightbox = document.getElementById('gallery-lightbox');
    if (!lightbox || lightbox.style.display === 'none') return;
    
    if (e.key === 'Escape') closeGalleryLightbox();
    if (e.key === 'ArrowLeft') navigateGalleryLightbox(-1);
    if (e.key === 'ArrowRight') navigateGalleryLightbox(1);
});


} // end of _galleryJsLoaded guard


// TODO 페이지 JavaScript 모듈
// 중복 로드 방지: 이미 로드되었으면 재실행하지 않음
if (typeof window._todoJsLoaded === 'undefined') {
    window._todoJsLoaded = true;

// 전역 변수
// 초기에는 빈 배열로 시작 (로그인 후 Firestore에서 로드)
let tasks = [];
// window.tasks가 이미 있으면 그것을 사용, 없으면 새로 생성
if (window.tasks === undefined || !Array.isArray(window.tasks)) {
    window.tasks = tasks; // Firestore 모듈에서 접근 가능하도록
} else {
    tasks = window.tasks; // 이미 있으면 참조 동기화
}

// 즉시 실행 함수로 초기화 코드 실행 (스크립트가 로드될 때마다 실행)
(function() {
    // 이벤트 리스너 등록 (중복 방지)
    if (!window._todoEventListenersRegistered) {
        // DOMContentLoaded 이벤트 리스너
        document.addEventListener('DOMContentLoaded', () => {
            initializeTodoPage();
        });

        // 페이지 로드 이벤트 리스너 (라우터를 통한 페이지 로드 시)
        window.addEventListener('pageLoaded', (event) => {
            if (event.detail?.path === '/todo') {
                // 약간의 지연을 두고 초기화 (DOM이 완전히 렌더링된 후)
                setTimeout(() => {
                    initializeTodoPage();
                }, 100);
            }
        });
        
        // tasks 로드 이벤트 리스너 (auth.js에서 데이터 로드 후)
        window.addEventListener('tasksLoaded', handleTasksLoaded);
        
        window._todoEventListenersRegistered = true;
    }
    
    // 이미 발생한 이벤트를 처리하기 위해 즉시 체크
    if (window.tasks && Array.isArray(window.tasks) && window.tasks.length > 0) {
        tasks = window.tasks;
        handleTasksLoaded({ detail: { tasks: window.tasks } });
    }
})();
let currentFilter = 'active';
let currentAssigneeSearch = '';
let currentActivityAssigneeFilter = []; // Activity 탭용 담당자 필터 (배열)
let currentCalendarAssigneeFilter = []; // Calendar 탭용 담당자 필터 (배열)
let currentViewMode = 'task'; // 'task' or 'activity'
let isEditMode = false;
let currentTaskId = null;
let currentTags = [];
let currentAssignees = [];

// Undo 히스토리 (최대 50개)
const MAX_HISTORY = 50;
let undoHistory = [];

// 드래그 앤 드롭 관련
let draggedCard = null;
let draggedTaskId = null;

// 워크스페이스 ID (auth.js에서 설정됨)
let currentWorkspaceId = null;

// 캘린더 인스턴스
let calendarInstance = null;

// DOM 요소 (DOMContentLoaded 이후 초기화)
let detailModal = null;
let taskModal = null;

// ===== 유틸리티 헬퍼 함수 =====
// common.js에서 이미 선언되어 있으므로 재사용
// debugLog, debugError, debugWarn, callWindowFn은 common.js에서 가져옴
// common.js가 먼저 로드되므로 여기서는 사용만 함

// ===== 권한(ROLE) 기반 프론트 잠금 =====
window.currentUserRole = window.currentUserRole || 'VIEWER';

window.canEdit = function () {
    const role = String(window.currentUserRole || 'VIEWER').toUpperCase();
    return ['OWNER', 'ADMIN', 'PLANNER'].includes(role);
};

window.applyRoleToUI = function (role) {
    window.currentUserRole = String(role || 'VIEWER').toUpperCase();

    // body에 read-only 클래스로 스타일 제어
    document.body.classList.toggle('read-only', !window.canEdit());

    // Viewer일 때 "새 태스크" 버튼 비활성/숨김
    const addBtn =
        document.getElementById('add-task-btn') ||
        document.querySelector('.btn-add-task') ||
        document.querySelector('button[onclick*="openTaskModal"]') ||
        document.querySelector('button:has(.fa-plus)');

    if (addBtn) {
        addBtn.disabled = !window.canEdit();
        addBtn.style.pointerEvents = window.canEdit() ? '' : 'none';
        addBtn.style.opacity = window.canEdit() ? '' : '0.45';
    }

    // 저장 버튼 비활성화
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.disabled = !window.canEdit();
        saveBtn.style.pointerEvents = window.canEdit() ? '' : 'none';
        saveBtn.style.opacity = window.canEdit() ? '' : '0.45';
    }

    // 렌더 다시 (draggable 반영) - DOM 요소가 있을 때만
    if (document.getElementById('tasks-container') && typeof window.renderTasks === 'function') {
        window.renderTasks();
    }
};

// 초기화 함수
function initializeTodoPage() {
    // window에 노출하여 router.js에서 호출 가능하도록
    window.initializeTodoPage = initializeTodoPage;
    
    // Bootstrap 모달 초기화
    const detailModalEl = document.getElementById('detail-modal');
    const taskModalEl = document.getElementById('task-modal');
    
    if (detailModalEl) {
        // 기존 모달이 있으면 제거하고 새로 생성
        if (detailModal) {
            try {
                detailModal.dispose();
            } catch (e) {}
        }
        detailModal = new bootstrap.Modal(detailModalEl);
    }
    if (taskModalEl) {
        // 기존 모달이 있으면 제거하고 새로 생성
        if (taskModal) {
            try {
                taskModal.dispose();
            } catch (e) {}
        }
        taskModal = new bootstrap.Modal(taskModalEl);
    }
    
    setupEventListeners();
    
    // tasks 변수 참조 동기화 (항상 수행)
    if (window.tasks) {
        tasks = window.tasks;
    } else {
        // window.tasks가 없으면 생성
        window.tasks = tasks;
    }
    
    // 이미 로드된 데이터가 있으면 렌더링
    if (window.tasks && window.tasks.length > 0) {
        initializePriorities();
        sortTasksByPriority();
        updateOverdueStatus();
        renderTasks();
        updateFilterCounts();
        updateViewCounts();
        
        // 캘린더 뷰가 활성화되어 있으면 캘린더도 렌더링
        if (currentViewMode === 'calendar') {
            const calendarContainer = document.getElementById('calendar-container');
            if (calendarContainer && calendarContainer.style.display !== 'none') {
                setTimeout(() => {
                    if (typeof FullCalendar !== 'undefined') {
                        callWindowFn('updateCalendarAssigneeDropdown');
                        renderCalendar();
                    }
                }, 100);
            }
        }
    } else {
        // 빈 배열이라도 렌더링 (빈 상태 메시지 표시)
        if (document.getElementById('tasks-container')) {
            renderTasks();
            updateFilterCounts();
            updateViewCounts();
        }
    }
    
    // 권한에 따른 UI 업데이트
    if (window.applyRoleToUI && window.currentUserRole) {
        window.applyRoleToUI(window.currentUserRole);
    }
    
    // 함수들을 window에 노출 (HTML onclick에서 사용 가능하도록)
    window.setFilter = setFilter;
    window.setViewMode = setViewMode;
    window.initializeTodoPage = initializeTodoPage;

    // 튜토리얼 표시 (처음 한 번만, localStorage로 제어)
    setupTodoTutorial();
}

// To Do 튜토리얼 (처음 한 번만 표시, 실제 화면 요소 하이라이트)
const TODO_TUTORIAL_STORAGE_KEY = 'todo-tutorial-dismissed';

// 각 단계별 하이라이트 대상 요소 셀렉터
const TODO_TUTORIAL_TARGETS = {
    1: '#add-task-btn',           // TASK 등록
    2: '#tasks-container',       // 우선순위 이동 (드래그 영역)
    3: '#view-toggle',           // Task / Activity / Calendar
    4: '.filter-group',           // 필터 버튼
    5: '.search-container'       // 담당자 검색
};

function setupTodoTutorial() {
    const modalEl = document.getElementById('todo-tutorial-modal');
    const overlayEl = document.getElementById('todo-tutorial-overlay');
    const highlightEl = document.getElementById('todo-tutorial-highlight');
    if (!modalEl || !overlayEl || !highlightEl) return;

    // 이미 한 번 본 적 있으면 표시하지 않음
    if (localStorage.getItem(TODO_TUTORIAL_STORAGE_KEY) === 'true') return;

    // 중복 초기화 방지
    if (modalEl.dataset.tutorialInitialized === 'true') return;
    modalEl.dataset.tutorialInitialized = 'true';

    // 튜토리얼 시작 시 Task 뷰로 전환 (모든 요소가 보이도록)
    if (typeof setViewMode === 'function') setViewMode('task');

    const modal = new bootstrap.Modal(modalEl);
    let currentStep = 1;
    const totalSteps = 5;
    const HIGHLIGHT_PADDING = 10;
    const MIN_HIGHLIGHT_SIZE = 80;

    function updateHighlight() {
        const selector = TODO_TUTORIAL_TARGETS[currentStep];
        const target = selector ? document.querySelector(selector) : null;

        if (target && target.offsetParent !== null) {
            const rect = target.getBoundingClientRect();
            const padding = HIGHLIGHT_PADDING;
            let left = rect.left - padding;
            let top = rect.top - padding;
            let width = Math.max(rect.width + padding * 2, MIN_HIGHLIGHT_SIZE);
            let height = Math.max(rect.height + padding * 2, MIN_HIGHLIGHT_SIZE);

            highlightEl.style.left = left + 'px';
            highlightEl.style.top = top + 'px';
            highlightEl.style.width = width + 'px';
            highlightEl.style.height = height + 'px';
            highlightEl.style.display = 'block';
            /* overlay는 사용하지 않음 - 배경 어두움 없음 */
        } else {
            highlightEl.style.display = 'none';
        }
    }

    function goToStep(step) {
        currentStep = Math.max(1, Math.min(step, totalSteps));
        document.querySelectorAll('.todo-tutorial-step').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.step) === currentStep);
        });
        document.querySelectorAll('.todo-tutorial-dots .dot').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.step) === currentStep);
        });
        const prevBtn = document.getElementById('todo-tutorial-prev');
        const nextBtn = document.getElementById('todo-tutorial-next');
        const doneBtn = document.getElementById('todo-tutorial-done');
        if (prevBtn) prevBtn.disabled = currentStep === 1;
        if (nextBtn) nextBtn.style.display = currentStep === totalSteps ? 'none' : 'inline-block';
        if (doneBtn) doneBtn.style.display = currentStep === totalSteps ? 'inline-block' : 'none';

        updateHighlight();
    }

    function hideSpotlight() {
        overlayEl.style.display = 'none';
        highlightEl.style.display = 'none';
    }

    function dismissTutorial(neverShowAgain) {
        if (neverShowAgain) localStorage.setItem(TODO_TUTORIAL_STORAGE_KEY, 'true');
        hideSpotlight();
        modal.hide();
    }

    // 다시 보지 않기 - 바로 닫기 (UI/UX: 즉시 닫힘)
    const skipBtn = document.getElementById('todo-tutorial-skip-btn');
    if (skipBtn) {
        skipBtn.addEventListener('click', () => dismissTutorial(true));
    }

    // 이전 / 다음 / 시작하기
    const prevBtn = document.getElementById('todo-tutorial-prev');
    const nextBtn = document.getElementById('todo-tutorial-next');
    const doneBtn = document.getElementById('todo-tutorial-done');
    if (prevBtn) prevBtn.addEventListener('click', () => goToStep(currentStep - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goToStep(currentStep + 1));
    if (doneBtn) doneBtn.addEventListener('click', () => dismissTutorial(true));

    // dot 클릭으로 단계 이동
    document.querySelectorAll('.todo-tutorial-dots .dot').forEach(dot => {
        dot.addEventListener('click', () => goToStep(parseInt(dot.dataset.step)));
    });

    // 모달 닫힐 때 스포트라이트 제거
    modalEl.addEventListener('hidden.bs.modal', () => {
        hideSpotlight();
        if (localStorage.getItem(TODO_TUTORIAL_STORAGE_KEY) !== 'true') {
            localStorage.setItem(TODO_TUTORIAL_STORAGE_KEY, 'true');
        }
    }, { once: true });

    // 윈도우 리사이즈/스크롤 시 하이라이트 위치 갱신
    const updateHandler = () => { if (highlightEl.style.display === 'block') updateHighlight(); };
    window.addEventListener('resize', updateHandler);
    window.addEventListener('scroll', updateHandler, true);
    modalEl.addEventListener('hidden.bs.modal', () => {
        window.removeEventListener('resize', updateHandler);
        window.removeEventListener('scroll', updateHandler, true);
    }, { once: true });

    goToStep(1);
    modal.show();

    // DOM 레이아웃 안정화 후 하이라이트 위치 재계산
    setTimeout(updateHighlight, 100);
}

/**
 * 튜토리얼을 강제로 다시 표시 (콘솔에서 테스트용)
 * reload 없이 호출 가능.
 * 사용법: localStorage.removeItem('todo-tutorial-dismissed'); showTodoTutorial();
 */
window.showTodoTutorial = function() {
    const modalEl = document.getElementById('todo-tutorial-modal');
    if (modalEl) {
        delete modalEl.dataset.tutorialInitialized;
        localStorage.removeItem(TODO_TUTORIAL_STORAGE_KEY);
        setupTodoTutorial();
        return;
    }
    // 모달이 없을 때: /todo가 아니면 이동 후 재시도, /todo인데 없으면 배포 확인 안내
    const path = window.location.pathname;
    if (path !== '/todo') {
        console.log('[Tutorial] /todo로 이동 후 튜토리얼 표시 시도...');
        if (window.router) window.router.navigate('/todo');
        setTimeout(() => window.showTodoTutorial(), 600);
        return;
    }
    console.warn('[Tutorial] 튜토리얼 모달을 찾을 수 없습니다. firebase deploy로 최신 버전을 배포했는지 확인해주세요.');
};

// DOMContentLoaded 이벤트 리스너는 즉시 실행 함수 내부에서 이미 등록됨
// 중복 등록 방지를 위해 여기서는 제거

// tasks 로드 이벤트 리스너 (auth.js에서 데이터 로드 후)
function handleTasksLoaded(event) {
    // tasks 변수 참조 동기화
    if (window.tasks && Array.isArray(window.tasks) && window.tasks.length > 0) {
        tasks = window.tasks;
        
        // 다시 렌더링
        const container = document.getElementById('tasks-container');
        if (container) {
            initializePriorities();
            sortTasksByPriority();
            updateOverdueStatus();
            renderTasks();
            updateFilterCounts();
            updateViewCounts();
            
            // 캘린더 뷰가 활성화되어 있으면 캘린더도 렌더링
            if (currentViewMode === 'calendar') {
                const calendarContainer = document.getElementById('calendar-container');
                if (calendarContainer && calendarContainer.style.display !== 'none') {
                    setTimeout(() => {
                        if (typeof FullCalendar !== 'undefined') {
                            callWindowFn('updateCalendarAssigneeDropdown');
                            renderCalendar();
                        }
                    }, 100);
                }
            }
        } else {
            // 나중에 다시 시도 (페이지가 아직 로드되지 않았을 수 있음)
            setTimeout(() => {
                const container = document.getElementById('tasks-container');
                if (container) {
                    initializePriorities();
                    sortTasksByPriority();
                    updateOverdueStatus();
                    renderTasks();
                    updateFilterCounts();
                    updateViewCounts();
                    
                    // 캘린더 뷰가 활성화되어 있으면 캘린더도 렌더링
                    if (currentViewMode === 'calendar') {
                        const calendarContainer = document.getElementById('calendar-container');
                        if (calendarContainer && calendarContainer.style.display !== 'none') {
                            if (typeof FullCalendar !== 'undefined') {
                                callWindowFn('updateCalendarAssigneeDropdown');
                                renderCalendar();
                            }
                        }
                    }
                }
                // tasks-container가 없으면 조용하게 무시 (페이지가 아직 로드되지 않았을 수 있음)
            }, 500);
        }
    }
}

// 이벤트 리스너 등록은 즉시 실행 함수 내부에서 이미 수행됨

// window.tasks가 로드될 때마다 동기화 (폴링 방식으로도 체크)
let tasksSyncInterval = setInterval(() => {
    if (window.tasks && window.tasks !== tasks && window.tasks.length > 0) {
        tasks = window.tasks;
        if (document.getElementById('tasks-container')) {
            initializePriorities();
            sortTasksByPriority();
            updateOverdueStatus();
            renderTasks();
            updateFilterCounts();
            updateViewCounts();
        }
    }
}, 1000);

// 페이지 언로드 시 인터벌 정리
window.addEventListener('beforeunload', () => {
    if (tasksSyncInterval) {
        clearInterval(tasksSyncInterval);
    }
});

// 우선순위 초기화 (priority 필드가 없는 경우 추가)
function initializePriorities() {
    tasks.forEach((task, index) => {
        if (task.priority === undefined) {
            task.priority = index + 1;
        }
    });
    // 우선순위 정규화
    normalizePriorities();
}
window.initializePriorities = initializePriorities;

// 우선순위 정규화 (1부터 순차적으로)
function normalizePriorities() {
    const sorted = [...tasks].sort((a, b) => (a.priority || 999) - (b.priority || 999));
    sorted.forEach((task, index) => {
        task.priority = index + 1;
    });
}

// 우선순위로 정렬
function sortTasksByPriority() {
    // 완료된 task와 진행중인 task 분리
    const completedTasks = tasks.filter(t => isTaskCompleted(t));
    const activeTasks = tasks.filter(t => !isTaskCompleted(t));
    
    // 진행중인 task만 priority로 정렬
    activeTasks.sort((a, b) => a.priority - b.priority);
    
    // 진행중인 task의 priority를 1부터 재정렬
    activeTasks.forEach((task, index) => {
        task.priority = index + 1;
    });
    
    // 완료된 task는 기존 priority 유지하되 뒤로 정렬
    completedTasks.sort((a, b) => a.priority - b.priority);
    
    // 진행중인 task 먼저, 완료된 task 나중에
    tasks = [...activeTasks, ...completedTasks];
    window.tasks = tasks;
}
window.sortTasksByPriority = sortTasksByPriority;

// 우선순위에 따른 색상 계산 (빨강 → 주황 → 노랑)
function getPriorityColor(priority, totalCount) {
    // 최소 1개일 때도 동작하도록
    const maxPriority = Math.max(totalCount, 1);

    // 0 (최고 우선순위) ~ 1 (최저 우선순위) 사이 비율
    const ratio = (priority - 1) / Math.max(maxPriority - 1, 1);

    // 빨강(0) → 주황(0.5) → 노랑(1)
    // HSL 색상: 빨강=0, 주황=30, 노랑=45
    const hue = ratio * 45; // 0 ~ 45
    const saturation = 85 - (ratio * 15); // 85% ~ 70%
    const lightness = 50 + (ratio * 5); // 50% ~ 55%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// 날짜로 정렬 (필요시 사용)
function sortTasksByDate() {
    tasks.sort((a, b) => new Date(a.issueDate) - new Date(b.issueDate));
}

// 이벤트 리스너 설정
function setupEventListeners() {
    // 새 태스크 추가 버튼
    const addTaskBtn = document.getElementById('add-task-btn');
    if (addTaskBtn) {
        addTaskBtn.addEventListener('click', () => {
            openTaskModal();
        });
    }

    const fabAddBtn = document.getElementById('fab-add-btn');
    if (fabAddBtn) {
        fabAddBtn.addEventListener('click', () => {
            openTaskModal();
        });
    }

    // 태스크 저장 버튼
    const saveTaskBtn = document.getElementById('save-task-btn');
    if (saveTaskBtn) {
        saveTaskBtn.addEventListener('click', saveTask);
    }

    // 태그 입력 이벤트
    const tagsInput = document.getElementById('tags-input');
    if (tagsInput) {
        tagsInput.addEventListener('keydown', handleTagInput);
    }

    // 담당자 입력 이벤트
    const assigneesInput = document.getElementById('assignees-input');
    if (assigneesInput) {
        assigneesInput.addEventListener('keydown', handleAssigneeInput);
    }

    // 파일 저장/불러오기 버튼
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            if (window.syncWorkspaceToFirestore) {
                const wsId = window.currentWorkspaceId || currentWorkspaceId;
                await window.syncWorkspaceToFirestore(wsId);
            }
        });
    }

    // 일괄 업로드 버튼
    const uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            if (!window.canEdit()) {
                callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
                return;
            }
            const uploadModal = new bootstrap.Modal(document.getElementById('upload-modal'));
            uploadModal.show();
        });
    }

    // 업로드 처리 버튼
    const uploadProcessBtn = document.getElementById('upload-process-btn');
    if (uploadProcessBtn) {
        uploadProcessBtn.addEventListener('click', () => {
            if (callWindowFn('handleExcelUpload') === undefined) {
                debugError('handleExcelUpload 함수를 찾을 수 없습니다.');
                alert('업로드 기능을 사용할 수 없습니다. 페이지를 새로고침해주세요.');
            }
        });
    }

    // 템플릿 다운로드 버튼
    const templateDownloadBtn = document.getElementById('template-download-btn');
    if (templateDownloadBtn) {
        templateDownloadBtn.addEventListener('click', downloadTemplate);
    }

    // 파일 업로드 미리보기 설정
    setupUploadPreview();

    // 체크박스 드롭다운 이벤트 리스너
    setupAssigneeDropdowns();

    // 담당자 검색
    const assigneeSearchInput = document.getElementById('assignee-search');
    const searchClearBtn = document.getElementById('search-clear-btn');

    if (assigneeSearchInput) {
        assigneeSearchInput.addEventListener('input', (e) => {
            currentAssigneeSearch = e.target.value.trim();
            if (searchClearBtn) {
                searchClearBtn.classList.toggle('show', currentAssigneeSearch.length > 0);
            }

            renderCurrentView();
            updateFilterCounts();
            updateViewCounts();
        });

        assigneeSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                clearAssigneeSearch();
            }
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', clearAssigneeSearch);
    }

    // Undo 버튼
    const undoBtn = document.getElementById('undo-btn');
    if (undoBtn) {
        undoBtn.addEventListener('click', undo);
    }

    // 키보드 단축키 (Ctrl+Z)
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undo();
        }
    });

    // 드래그 앤 드롭 이벤트 (컨테이너에 위임)
    const container = document.getElementById('tasks-container');
    if (container) {
        container.addEventListener('dragstart', handleDragStart);
        container.addEventListener('dragend', handleDragEnd);
        container.addEventListener('dragover', handleDragOver);
        container.addEventListener('dragleave', handleDragLeave);
        container.addEventListener('drop', handleDrop);
    }

    // 로그아웃 버튼은 네비게이션 바로 이동됨 (제거)
}

// ========== Undo 기능 ==========

// 현재 상태를 히스토리에 저장
function saveToHistory(actionName = '') {
    const snapshot = {
        tasks: JSON.parse(JSON.stringify(tasks)),
        timestamp: Date.now(),
        action: actionName
    };

    undoHistory.push(snapshot);

    // 최대 개수 초과시 오래된 것 제거
    if (undoHistory.length > MAX_HISTORY) {
        undoHistory.shift();
    }

    updateUndoButton();
    showUndoHint();
}

// Undo 실행
function undo() {
    if (undoHistory.length === 0) {
        showToast('되돌릴 작업이 없습니다.', 'info');
        return;
    }

    const lastState = undoHistory.pop();
    tasks = lastState.tasks;
    window.tasks = tasks; // window.tasks 동기화

    sortTasksByPriority();
    renderTasks();
    updateFilterCounts();
    updateUndoButton();

    const actionText = lastState.action ? `"${lastState.action}" 작업이 ` : '작업이 ';
    showToast(`${actionText}취소되었습니다.`, 'success');
}

// Undo 버튼 상태 업데이트
function updateUndoButton() {
    const btn = document.getElementById('undo-btn');
    const countBadge = btn.querySelector('.undo-count');

    if (undoHistory.length > 0) {
        btn.disabled = false;
        countBadge.textContent = undoHistory.length;
        countBadge.style.display = 'flex';
    } else {
        btn.disabled = true;
        countBadge.style.display = 'none';
    }
}

// Undo 힌트 표시
function showUndoHint() {
    const hint = document.getElementById('undo-hint');
    hint.classList.add('show');

    setTimeout(() => {
        hint.classList.remove('show');
    }, 2000);
}

// ========== 드래그 앤 드롭 ==========

function handleDragStart(e) {
    if (!window.canEdit()) {
        e.preventDefault();
        return;
    }
    const card = e.target.closest('.task-card');
    if (!card) return;

    draggedCard = card;
    draggedTaskId = card.dataset.id;

    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedTaskId);
}

function handleDragEnd(e) {
    const card = e.target.closest('.task-card');
    if (card) {
        card.classList.remove('dragging');
    }

    // 모든 drag-over 클래스 제거
    document.querySelectorAll('.task-card.drag-over').forEach(c => {
        c.classList.remove('drag-over');
    });

    draggedCard = null;
    draggedTaskId = null;
}

function handleDragOver(e) {
    if (!window.canEdit()) {
        e.preventDefault();
        return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const card = e.target.closest('.task-card');
    if (card && card !== draggedCard) {
        // 기존 drag-over 제거
        document.querySelectorAll('.task-card.drag-over').forEach(c => {
            if (c !== card) c.classList.remove('drag-over');
        });
        card.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    const card = e.target.closest('.task-card');
    if (card && !card.contains(e.relatedTarget)) {
        card.classList.remove('drag-over');
    }
}

async function handleDrop(e) {
    if (!window.canEdit()) {
        callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }
    e.preventDefault();

    const targetCard = e.target.closest('.task-card');
    if (!targetCard || !draggedTaskId) return;

    const targetTaskId = targetCard.dataset.id;
    if (draggedTaskId === targetTaskId) return;

    // 히스토리 저장
    saveToHistory('우선순위 변경');

    // 우선순위 변경
    const draggedTask = tasks.find(t => t.id === draggedTaskId);
    const targetTask = tasks.find(t => t.id === targetTaskId);

    if (!draggedTask || !targetTask) return;

    const oldPriority = draggedTask.priority;
    const newPriority = targetTask.priority;

    // 우선순위 재조정
    if (oldPriority < newPriority) {
        // 아래로 이동
        tasks.forEach(task => {
            if (task.priority > oldPriority && task.priority <= newPriority) {
                task.priority--;
            }
        });
    } else {
        // 위로 이동
        tasks.forEach(task => {
            if (task.priority >= newPriority && task.priority < oldPriority) {
                task.priority++;
            }
        });
    }

    draggedTask.priority = newPriority;

    // Firestore에 일괄 저장
    if (window.saveAllTasksToFirestore) {
        try {
            const wsId = window.currentWorkspaceId || currentWorkspaceId;
            await window.saveAllTasksToFirestore(wsId);
        } catch (error) {
            debugError("우선순위 변경 저장 실패:", error);
        }
    }

    // 정렬 및 렌더링
    sortTasksByPriority();
    renderTasks();

    targetCard.classList.remove('drag-over');

    showToast(`"${draggedTask.name}" 우선순위가 ${newPriority}위로 변경되었습니다.`, 'success');
}

// 카드 클릭 핸들러 (드래그 핸들 클릭 시 모달 열지 않음)
function handleCardClick(event, taskId) {
    // 드래그 핸들 클릭 시 무시
    if (event.target.closest('.drag-handle')) {
        return;
    }
    openDetailModal(taskId);
}

// 태그 입력 처리
function handleTagInput(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const value = e.target.value.trim();
        if (value && !currentTags.includes(value)) {
            currentTags.push(value);
            renderTagsInput();
        }
        e.target.value = '';
    }
}

// 담당자 입력 처리
function handleAssigneeInput(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const value = e.target.value.trim();
        if (value && !currentAssignees.includes(value)) {
            currentAssignees.push(value);
            renderAssigneesInput();
        }
        e.target.value = '';
    }
}

// 담당자 입력 영역 렌더링
function renderAssigneesInput() {
    const container = document.getElementById('assignees-input-container');
    const input = document.getElementById('assignees-input');

    // 기존 담당자 배지 제거
    container.querySelectorAll('.assignee-item').forEach(el => el.remove());

    // 담당자 추가
    currentAssignees.forEach((assignee, index) => {
        const assigneeEl = document.createElement('span');
        assigneeEl.className = `assignee-item ${index === 0 ? 'main' : 'sub'}`;
        assigneeEl.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 10px;
    background: ${index === 0 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(100, 116, 139, 0.1)'};
    color: ${index === 0 ? 'var(--primary)' : 'var(--text-secondary)'};
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    box-sizing: border-box;
`;
        assigneeEl.innerHTML = `${index === 0 ? '<i class="fas fa-star" style="font-size: 9px;"></i>' : ''}${assignee} <button type="button" style="background:none;border:none;cursor:pointer;padding:0;margin:0;color:inherit;opacity:0.7;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;" onclick="removeAssignee(${index})">&times;</button>`;
        container.insertBefore(assigneeEl, input);
    });
}

// 담당자 제거
function removeAssignee(index) {
    currentAssignees.splice(index, 1);
    renderAssigneesInput();
}

// 담당자 표시 HTML 생성 (카드용)
function renderAssigneesHtml(assignees) {
    if (!assignees || assignees.length === 0) {
        return '<span style="color: var(--text-secondary); font-style: italic;">미지정</span>';
    }

    if (typeof assignees === 'string') {
        // 기존 문자열 형식 호환
        return `<span class="assignee-badge main"><i class="fas fa-star badge-icon"></i>${assignees}</span>`;
    }

    if (assignees.length === 1) {
        return `<span class="assignee-badge main"><i class="fas fa-star badge-icon"></i>${assignees[0]}</span>`;
    }

    // 2명 이상일 때
    const main = assignees[0];
    const subCount = assignees.length - 1;
    return `
<span class="assignee-badge main"><i class="fas fa-star badge-icon"></i>${main}</span>
<span class="assignee-badge sub">+${subCount}</span>
`;
}

// 담당자 표시 HTML 생성 (상세 모달용)
function renderAssigneesDetailHtml(assignees) {
    if (!assignees || assignees.length === 0) {
        return '<span style="color: var(--text-secondary); font-style: italic;">미지정</span>';
    }

    if (typeof assignees === 'string') {
        return `<span class="assignee-badge main"><i class="fas fa-star badge-icon"></i>${assignees}</span>`;
    }

    return assignees.map((assignee, index) => `
<span class="assignee-badge ${index === 0 ? 'main' : 'sub'}">
    ${index === 0 ? '<i class="fas fa-star badge-icon"></i>' : ''}${assignee}
</span>
`).join(' ');
}

// 태그 입력 영역 렌더링
function renderTagsInput() {
    const container = document.getElementById('tags-input-container');
    const input = document.getElementById('tags-input');

    // 기존 태그 제거
    container.querySelectorAll('.tag-item').forEach(el => el.remove());

    // 태그 추가
    currentTags.forEach((tag, index) => {
        const tagEl = document.createElement('span');
        tagEl.className = 'tag-item';
        tagEl.innerHTML = `#${tag} <button type="button" onclick="removeTag(${index})">&times;</button>`;
        container.insertBefore(tagEl, input);
    });
}

// 태그 제거
function removeTag(index) {
    currentTags.splice(index, 1);
    renderTagsInput();
}

// 필터 설정
function setFilter(filter) {
    currentFilter = filter;

    // 버튼 활성화 상태 변경
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.filter === filter) {
            btn.classList.add('active');
        }
    });

    renderTasks();
}
window.setFilter = setFilter; // 즉시 노출

// 체크박스 드롭다운 설정
function setupAssigneeDropdowns() {
    // Activity 담당자 드롭다운
    const activityBtn = document.getElementById('activity-assignee-dropdown-btn');
    const activityMenu = document.getElementById('activity-assignee-dropdown-menu');
    
    if (activityBtn && activityMenu) {
        activityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = activityMenu.classList.contains('show');
            
            // 다른 드롭다운 닫기
            document.querySelectorAll('.assignee-dropdown-menu.show').forEach(menu => {
                if (menu !== activityMenu) {
                    menu.classList.remove('show');
                    menu.previousElementSibling?.classList.remove('active');
                }
            });
            
            activityMenu.classList.toggle('show', !isActive);
            activityBtn.classList.toggle('active', !isActive);
        });
    }

    // Calendar 담당자 드롭다운
    const calendarBtn = document.getElementById('calendar-assignee-dropdown-btn');
    const calendarMenu = document.getElementById('calendar-assignee-dropdown-menu');
    
    if (calendarBtn && calendarMenu) {
        calendarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isActive = calendarMenu.classList.contains('show');
            
            // 다른 드롭다운 닫기
            document.querySelectorAll('.assignee-dropdown-menu.show').forEach(menu => {
                if (menu !== calendarMenu) {
                    menu.classList.remove('show');
                    menu.previousElementSibling?.classList.remove('active');
                }
            });
            
            calendarMenu.classList.toggle('show', !isActive);
            calendarBtn.classList.toggle('active', !isActive);
        });
    }

    // 외부 클릭 시 드롭다운 닫기
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.assignee-dropdown-wrapper')) {
            document.querySelectorAll('.assignee-dropdown-menu.show').forEach(menu => {
                menu.classList.remove('show');
                menu.previousElementSibling?.classList.remove('active');
            });
        }
    });
}

// 담당자 검색 초기화
function clearAssigneeSearch() {
    currentAssigneeSearch = '';
    document.getElementById('assignee-search').value = '';
    document.getElementById('search-clear-btn').classList.remove('show');
    renderCurrentView();
    updateFilterCounts();
    updateViewCounts();
}

// 태스크 또는 Activity에 담당자가 포함되어 있는지 확인
function taskMatchesAssigneeSearch(task, searchTerm) {
    if (!searchTerm) return true;

    const lowerSearch = searchTerm.toLowerCase();

    // 태스크 담당자 확인
    const taskAssignees = task.assignees || (task.assignee ? [task.assignee] : []);
    const taskMatch = taskAssignees.some(a => a.toLowerCase().includes(lowerSearch));

    if (taskMatch) return true;

    // Activity 담당자 확인
    const activityMatch = task.activities.some(activity => {
        const activityAssignees = activity.assignees || [];
        return activityAssignees.some(a => a.toLowerCase().includes(lowerSearch));
    });

    return activityMatch;
}

// 필터 카운트 업데이트
function updateFilterCounts() {
    // DOM 요소가 없으면 조용하게 return
    if (!document.getElementById('filter-all-count')) {
        return;
    }
    
    // 담당자 검색이 적용된 태스크들
    let filteredTasks = tasks;
    if (currentAssigneeSearch) {
        filteredTasks = tasks.filter(t => taskMatchesAssigneeSearch(t, currentAssigneeSearch));
    }

    const total = filteredTasks.length;
    const completed = filteredTasks.filter(t => isTaskCompleted(t)).length;
    const active = total - completed;

    const allCountEl = document.getElementById('filter-all-count');
    const activeCountEl = document.getElementById('filter-active-count');
    const completedCountEl = document.getElementById('filter-completed-count');
    
    if (allCountEl) allCountEl.textContent = total;
    if (activeCountEl) activeCountEl.textContent = active;
    if (completedCountEl) completedCountEl.textContent = completed;
}
window.updateFilterCounts = updateFilterCounts;

// 뷰 모드 설정
function setViewMode(mode) {
    currentViewMode = mode;
    updateViewToggleButtons();
    renderCurrentView();
}
window.setViewMode = setViewMode; // 즉시 노출

// 뷰 토글 버튼 상태 업데이트
function updateViewToggleButtons() {
    document.querySelectorAll('.view-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === currentViewMode);
    });
}

// 현재 뷰 렌더링
function renderCurrentView() {
    const tasksContainer = document.getElementById('tasks-container');
    const activitiesContainer = document.getElementById('activities-container');
    const calendarContainer = document.getElementById('calendar-container');

    if (currentViewMode === 'activity') {
        tasksContainer.style.display = 'none';
        activitiesContainer.style.display = 'grid';
        if (calendarContainer) calendarContainer.style.display = 'none';
        renderActivities();
    } else if (currentViewMode === 'calendar') {
        tasksContainer.style.display = 'none';
        activitiesContainer.style.display = 'none';
        if (calendarContainer) {
            calendarContainer.style.display = 'block';
        }
        
        // 캘린더 담당자 드롭다운 설정 (캘린더 뷰로 전환할 때마다 호출)
        setupAssigneeDropdowns();
        
        // 캘린더 렌더링 전에 체크박스 드롭다운 업데이트
        callWindowFn('updateCalendarAssigneeDropdown');
        
        // FullCalendar가 로드되었는지 확인 후 렌더링
        let FullCalendarLib = null;
        try {
            if (typeof window !== 'undefined' && window.FullCalendar) {
                FullCalendarLib = window.FullCalendar;
            } else if (typeof FullCalendar !== 'undefined') {
                FullCalendarLib = FullCalendar;
            }
        } catch (e) {
            // FullCalendar 체크 중 에러 무시
        }
        
        if (FullCalendarLib) {
            renderCalendar();
        } else {
            // FullCalendar 로드 이벤트 대기
            const handleFullCalendarLoaded = () => {
                renderCalendar();
                window.removeEventListener('fullcalendarLoaded', handleFullCalendarLoaded);
            };
            window.addEventListener('fullcalendarLoaded', handleFullCalendarLoaded);
            
            // 타임아웃 설정 (최대 5초 대기)
            setTimeout(() => {
                window.removeEventListener('fullcalendarLoaded', handleFullCalendarLoaded);
                let FullCalendarLibRetry = null;
                try {
                    if (typeof window !== 'undefined' && window.FullCalendar) {
                        FullCalendarLibRetry = window.FullCalendar;
                    } else if (typeof FullCalendar !== 'undefined') {
                        FullCalendarLibRetry = FullCalendar;
                    }
                } catch (e) {
                    // 재확인 중 에러 무시
                }
                if (FullCalendarLibRetry) {
                    renderCalendar();
                }
            }, 5000);
        }
    } else {
        tasksContainer.style.display = 'grid';
        activitiesContainer.style.display = 'none';
        if (calendarContainer) calendarContainer.style.display = 'none';
        renderTasks();
    }
}

// 뷰 카운트 업데이트
function updateViewCounts() {
    // DOM 요소가 없으면 조용하게 return
    const taskCountEl = document.getElementById('view-task-count');
    const activityCountEl = document.getElementById('view-activity-count');
    
    if (!taskCountEl || !activityCountEl) {
        return;
    }
    
    // 태스크 카운트
    const filteredTasks = getFilteredTasks();
    taskCountEl.textContent = filteredTasks.length;

    // Activity 카운트
    const filteredActivities = getFilteredActivities();
    activityCountEl.textContent = filteredActivities.length;
}
window.updateViewCounts = updateViewCounts;

// 필터링된 Activity 가져오기
function getFilteredActivities() {
    const results = [];
    const lowerSearch = currentAssigneeSearch ? currentAssigneeSearch.toLowerCase() : '';
    // Activity 탭의 담당자 필터 (드롭다운)
    const activityAssigneeFilter = currentActivityAssigneeFilter || '';

    tasks.forEach(task => {
        task.activities.forEach(activity => {
            // 담당자 검색 필터 (헤더 검색창)
            if (lowerSearch) {
                const activityAssignees = activity.assignees || [];
                const taskAssignees = task.assignees || (task.assignee ? [task.assignee] : []);
                const allAssignees = [...activityAssignees, ...taskAssignees];

                const matchesAssignee = allAssignees.some(a =>
                    a.toLowerCase().includes(lowerSearch)
                );

                if (!matchesAssignee) return;
            }

            // Activity 탭 담당자 필터 (드롭다운 - 다중 선택)
            if (activityAssigneeFilter && activityAssigneeFilter.length > 0) {
                const activityAssignees = activity.assignees || [];
                const taskAssignees = task.assignees || (task.assignee ? [task.assignee] : []);
                const allAssignees = [...activityAssignees, ...taskAssignees];
                
                // 선택된 담당자 중 하나라도 포함되어 있으면 표시
                const hasMatchingAssignee = activityAssigneeFilter.some(filterAssignee => 
                    allAssignees.includes(filterAssignee)
                );
                
                if (!hasMatchingAssignee) {
                    return;
                }
            }

            // 상태 필터 적용
            const isCompleted = activity.status === 'completed';
            if (currentFilter === 'completed' && !isCompleted) return;
            if (currentFilter === 'active' && isCompleted) return;

            results.push({
                ...activity,
                taskId: task.id,
                taskName: task.name,
                taskTags: task.tags || [],
                taskAssignees: task.assignees || (task.assignee ? [task.assignee] : [])
            });
        });
    });

    // 정렬: 상태별 그룹 → 마감일 오름차순 (지연이 최상단)
    const statusOrder = { 'overdue': 0, 'in-progress': 1, 'pending': 2, 'completed': 3 };

    results.sort((a, b) => {
        const statusDiff = statusOrder[a.status] - statusOrder[b.status];
        if (statusDiff !== 0) return statusDiff;
        return new Date(a.dueDate) - new Date(b.dueDate);
    });

    return results;
}

// Activity 담당자 필터 드롭다운 채우기 (체크박스)
function populateActivityAssigneeFilter() {
    const checkboxesContainer = document.getElementById('activity-assignee-checkboxes');
    const dropdownBtn = document.getElementById('activity-assignee-dropdown-btn');
    if (!checkboxesContainer || !dropdownBtn) return;

    const assigneeSet = new Set();
    tasks.forEach(task => {
        (task.assignees || []).forEach(a => assigneeSet.add(a));
        task.activities.forEach(activity => {
            (activity.assignees || []).forEach(a => assigneeSet.add(a));
        });
    });

    const assignees = Array.from(assigneeSet).filter(a => a).sort();
    
    checkboxesContainer.innerHTML = '';
    assignees.forEach(assignee => {
        const item = document.createElement('div');
        item.className = 'assignee-dropdown-item';
        const isChecked = currentActivityAssigneeFilter.includes(assignee);
        // ID에 특수문자 제거
        const safeId = assignee.replace(/[^a-zA-Z0-9가-힣]/g, '_');
        item.innerHTML = `
            <input type="checkbox" id="activity-check-${safeId}" ${isChecked ? 'checked' : ''} value="${assignee}">
            <label for="activity-check-${safeId}">${assignee}</label>
        `;
        checkboxesContainer.appendChild(item);
    });

    // 버튼 텍스트 업데이트
    updateActivityAssigneeButtonText();
}

// Activity 담당자 필터 버튼 텍스트 업데이트
function updateActivityAssigneeButtonText() {
    const btn = document.getElementById('activity-assignee-dropdown-btn');
    const countBadge = document.getElementById('activity-selected-count');
    if (!btn) return;

    const selectedText = btn.querySelector('.selected-text');
    if (currentActivityAssigneeFilter.length === 0) {
        selectedText.textContent = '전체 담당자';
        if (countBadge) countBadge.classList.remove('show');
    } else if (currentActivityAssigneeFilter.length === 1) {
        selectedText.textContent = currentActivityAssigneeFilter[0];
        if (countBadge) countBadge.classList.remove('show');
    } else {
        selectedText.textContent = `${currentActivityAssigneeFilter[0]} 외 ${currentActivityAssigneeFilter.length - 1}명`;
        if (countBadge) {
            countBadge.textContent = currentActivityAssigneeFilter.length;
            countBadge.classList.add('show');
        }
    }
}

// Activity 담당자 필터 적용
function applyActivityAssigneeFilter() {
    const checkboxes = document.querySelectorAll('#activity-assignee-checkboxes input[type="checkbox"]');
    const selected = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
    
    currentActivityAssigneeFilter = selected;
    updateActivityAssigneeButtonText();
    
    // 드롭다운 닫기
    const menu = document.getElementById('activity-assignee-dropdown-menu');
    const btn = document.getElementById('activity-assignee-dropdown-btn');
    if (menu) menu.classList.remove('show');
    if (btn) btn.classList.remove('active');
    
    // Activity 다시 렌더링
    renderActivities();
    updateViewCounts();
}

// Activity 담당자 필터 전체 해제
function clearActivityAssigneeFilter() {
    const checkboxes = document.querySelectorAll('#activity-assignee-checkboxes input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    currentActivityAssigneeFilter = [];
    updateActivityAssigneeButtonText();
    
    // 드롭다운 닫기
    const menu = document.getElementById('activity-assignee-dropdown-menu');
    const btn = document.getElementById('activity-assignee-dropdown-btn');
    if (menu) menu.classList.remove('show');
    if (btn) btn.classList.remove('active');
    
    // Activity 다시 렌더링
    renderActivities();
    updateViewCounts();
}

// Activity 렌더링
function renderActivities() {
    const container = document.getElementById('activities-container');
    
    // 담당자 필터 드롭다운 업데이트
    populateActivityAssigneeFilter();
    
    const activities = getFilteredActivities();

    if (activities.length === 0) {
        const message = currentActivityAssigneeFilter && currentActivityAssigneeFilter.length > 0
            ? `선택한 담당자(${currentActivityAssigneeFilter.join(', ')})의 Activity가 없습니다.`
            : currentAssigneeSearch
            ? `"${currentAssigneeSearch}" 담당자의 Activity가 없습니다.`
            : '표시할 Activity가 없습니다.';
        container.innerHTML = `
<div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
    <i class="fas fa-list-check" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
    <p style="font-size: 16px;">${message}</p>
</div>
`;
        return;
    }

    // 상태별 그룹핑 (지연이 최상단)
    const groups = {
        'overdue': { label: '지연', icon: 'fa-exclamation-triangle', items: [] },
        'in-progress': { label: '진행중', icon: 'fa-spinner', items: [] },
        'pending': { label: '대기', icon: 'fa-clock', items: [] },
        'completed': { label: '완료', icon: 'fa-check-circle', items: [] }
    };

    activities.forEach(activity => {
        if (groups[activity.status]) {
            groups[activity.status].items.push(activity);
        }
    });

    let html = '';

    Object.entries(groups).forEach(([status, group]) => {
        if (group.items.length === 0) return;

        html += `
    <div class="activity-group-header ${status}">
        <i class="fas ${group.icon}"></i>
        ${group.label}
        <span class="activity-group-count">${group.items.length}</span>
    </div>
`;

        group.items.forEach(activity => {
            const dueDate = new Date(activity.dueDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

            let dueDateClass = '';
            if (activity.status !== 'completed') {
                if (diffDays < 0) dueDateClass = 'overdue';
                else if (diffDays <= 3) dueDateClass = 'soon';
            }

            const displayAssignees = activity.assignees && activity.assignees.length > 0
                ? activity.assignees
                : activity.taskAssignees;

            html += `
<div class="activity-card" onclick="openDetailModal('${activity.taskId}')">
<div class="activity-card-status ${activity.status}"></div>
<div class="activity-card-content">
    <div class="activity-card-name">${activity.name}</div>
    <div class="activity-card-task">
        <i class="fas fa-folder"></i>
        ${activity.taskName}
    </div>
</div>
<div class="activity-card-assignee">
    <div class="activity-card-due-label">담당자</div>
    <div class="activity-card-assignee-name">${displayAssignees.length > 0 ? displayAssignees[0] : '미지정'}${displayAssignees.length > 1 ? ` +${displayAssignees.length - 1}` : ''}</div>
</div>
<div class="activity-card-due">
    <div class="activity-card-due-label">마감일</div>
    <div class="activity-card-due-date ${dueDateClass}">${formatDate(activity.dueDate)}</div>
</div>
<div class="activity-card-badge ${activity.status}">
    ${getStatusLabel(activity.status)}
</div>
</div>
`;
        });
    });

    container.innerHTML = html;
}

// 태스크 완료 여부 확인
function isTaskCompleted(task) {
    return task.activities.every(a => a.status === 'completed');
}

// 필터링된 태스크 가져오기
function getFilteredTasks() {
    let filtered = tasks;

    // 상태 필터
    if (currentFilter === 'completed') {
        filtered = filtered.filter(t => isTaskCompleted(t));
    } else if (currentFilter === 'active') {
        filtered = filtered.filter(t => !isTaskCompleted(t));
    }

    // 담당자 검색 필터
    if (currentAssigneeSearch) {
        filtered = filtered.filter(t => taskMatchesAssigneeSearch(t, currentAssigneeSearch));
    }

    return filtered;
}

// 태스크 렌더링
function renderTasks() {
    const container = document.getElementById('tasks-container');
    
    if (!container) {
        // tasks-container가 없으면 조용하게 return (페이지가 아직 로드되지 않았을 수 있음)
        return;
    }
    
    const filteredTasks = getFilteredTasks();

    if (filteredTasks.length === 0) {
        container.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary);">
        <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
        <p style="font-size: 16px;">표시할 태스크가 없습니다.</p>
    </div>
`;
        return;
    }

    const draggableAttr = window.canEdit() ? 'true' : 'false';

    container.innerHTML = filteredTasks.map(task => {
        const { timelineProgress, completionProgress } = calculateProgress(task);
        const top3Activities = getTop3Activities(task.activities);

        return `
<div class="task-card" data-id="${task.id}" draggable="${draggableAttr}" onclick="handleCardClick(event, '${task.id}')">
${window.canEdit() ? `
<div class="drag-handle" title="드래그하여 우선순위 변경">
    <i class="fas fa-grip-vertical"></i>
</div>
` : ''}
<div class="card-top-bar"></div>
<div class="card-header">
    <div class="card-header-top">
        <div class="tags-container">
            ${(task.tags || []).slice(0, 3).map(tag => `
                <span class="tag-badge"><i class="fas fa-hashtag"></i>${tag}</span>
            `).join('')}
            ${(task.tags || []).length > 3 ? `<span class="tag-badge">+${task.tags.length - 3}</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
            ${isTaskCompleted(task) ? '<i class="fas fa-check-circle" style="color: var(--success);"></i>' : ''}
            <span class="priority-badge" style="background: ${getPriorityColor(task.priority, tasks.length)}">
<span class="priority-label">Priority</span>
<span class="priority-number">${task.priority}</span>
</span>
        </div>
    </div>
            <div class="task-name">${task.name}</div>
            <div class="task-purpose">${task.purpose}</div>
        </div>
                <div class="card-meta">
<div class="meta-item">
<i class="fas fa-user"></i>
<div class="assignees-container">
    ${renderAssigneesHtml(task.assignees || task.assignee)}
</div>
</div>
                    <div class="meta-item">
                        <i class="fas fa-calendar"></i>
                        ${formatDate(task.issueDate)}
                    </div>
                    <div class="meta-item">
                        <i class="fas fa-file-alt"></i>
                        ${task.output}
                    </div>
                </div>
                <div class="card-activities">
                    <div class="activities-title">
                        <i class="fas fa-list-check"></i>
                        주요 Activity (${task.activities.filter(a => a.status === 'completed').length}/${task.activities.length})
                    </div>
                    ${top3Activities.map(activity => `
                        <div class="activity-item">
                            <div class="activity-status-dot ${activity.status}"></div>
                            <div class="activity-content">
                                <div class="activity-name">${activity.name}</div>
                                <div class="activity-due">마감: ${formatDate(activity.dueDate)}</div>
                            </div>
                            <span class="activity-status-badge ${activity.status}">${getStatusLabel(activity.status)}</span>
                        </div>
                    `).join('')}
                </div>
                <div class="card-progress">
                    <div class="progress-item">
                        <div class="progress-header">
                            <span class="progress-label">타임라인</span>
                            <span class="progress-value timeline">${timelineProgress}%</span>
                        </div>
                        <div class="progress-bar-wrapper">
                            <div class="progress-bar-fill timeline" style="width: ${timelineProgress}%"></div>
                        </div>
                    </div>
                    <div class="progress-item">
                        <div class="progress-header">
                            <span class="progress-label">진행률</span>
                            <span class="progress-value completion">${completionProgress}%</span>
                        </div>
                        <div class="progress-bar-wrapper">
                            <div class="progress-bar-fill completion" style="width: ${completionProgress}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}
window.renderTasks = renderTasks;

// TOP 3 Activity 가져오기 (완료 제외, 마감일 오름차순)
function getTop3Activities(activities) {
    // 완료되지 않은 것들만: 마감일 오름차순
    const notCompleted = activities
        .filter(a => a.status !== 'completed')
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    return notCompleted.slice(0, 3);
}

// Activity 지연 상태 자동 업데이트
function updateOverdueStatus() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    tasks.forEach(task => {
        task.activities.forEach(activity => {
            // 완료되지 않은 Activity만 체크
            if (activity.status !== 'completed') {
                const dueDate = new Date(activity.dueDate);
                dueDate.setHours(0, 0, 0, 0);

                // 마감일이 오늘보다 이전이면 지연 상태로 변경
                if (dueDate < today) {
                    activity.status = 'overdue';
                } else if (activity.status === 'overdue') {
                    // 마감일이 아직 안 지났는데 overdue면 pending으로 복구
                    activity.status = 'pending';
                }
            }
        });
    });
}
window.updateOverdueStatus = updateOverdueStatus;

// Activity 상태 라벨
function getStatusLabel(status) {
    const labels = {
        'completed': '완료',
        'in-progress': '진행중',
        'pending': '대기',
        'overdue': '지연'
    };
    return labels[status] || status;
}

// Timeline 아이템 렌더링 (상세 모달용)
function renderTimelineItem(activity, taskId, isCompletedSection) {
    const activityImages = activity.images || [];
    const canEditActivity = window.canEdit();
    
    return `
<div class="timeline-item ${activity.status} ${isCompletedSection ? 'completed-section' : ''}" data-activity-id="${activity.id}" data-task-id="${taskId}">
    <div class="timeline-dot"></div>
    <div class="timeline-item-header">
        <div class="timeline-item-title">${activity.name}</div>
        <div style="position: relative;">
            <span class="timeline-item-status clickable" onclick="toggleStatusDropdown(event, '${taskId}', '${activity.id}')">
                ${getStatusLabel(activity.status)}
                <i class="fas fa-chevron-down" style="font-size: 10px; margin-left: 4px;"></i>
            </span>
        </div>
    </div>
    <div class="timeline-item-description">${activity.description}</div>
    <div class="timeline-item-meta">
        <span>
            <i class="fas fa-play-circle"></i>
            시작일: ${formatDate(activity.startDate || getDefaultStartDate(activity.dueDate))}
        </span>
        <span>
            <i class="fas fa-calendar"></i>
            마감일: ${formatDate(activity.dueDate)}
        </span>
        ${activity.assignees && activity.assignees.length > 0 ? `
        <span>
            <i class="fas fa-user"></i>
            ${activity.assignees.join(', ')}
        </span>
        ` : ''}
        ${activity.completedDate ? `
        <span>
            <i class="fas fa-check"></i>
            완료일: ${formatDate(activity.completedDate)}
        </span>
        ` : ''}
    </div>
    <!-- 이미지 섹션 -->
    <div class="timeline-item-images" data-activity-id="${activity.id}">
        <div class="activity-images-header">
            <span class="activity-images-title">
                <i class="fas fa-images"></i>
                사진 (${activityImages.length})
            </span>
            ${canEditActivity ? `
            <div class="activity-image-upload-area" 
                 data-activity-id="${activity.id}" 
                 data-task-id="${taskId}"
                 ondrop="handleImageDrop(event)" 
                 ondragover="handleImageDragOver(event)" 
                 ondragleave="handleImageDragLeave(event)">
                <input type="file" 
                       class="activity-image-input" 
                       data-activity-id="${activity.id}" 
                       data-task-id="${taskId}"
                       accept="image/*" 
                       multiple 
                       style="display: none;">
                <button type="button" class="btn-upload-image" onclick="triggerImageUpload('${taskId}', '${activity.id}')">
                    <i class="fas fa-plus"></i>
                    사진 추가
                </button>
                <div class="upload-hint">드래그 앤 드롭 또는 클릭하여 업로드</div>
            </div>
            ` : ''}
        </div>
        ${activityImages.length > 0 ? `
        <div class="activity-images-gallery">
            ${activityImages.map((img, idx) => `
            <div class="activity-image-item" data-image-index="${idx}">
                <img src="${img.url}" alt="Activity image ${idx + 1}" loading="lazy" onclick="openImageLightbox('${img.url}', ${idx})">
                ${canEditActivity ? `
                <button type="button" class="btn-delete-image" onclick="deleteActivityImage('${taskId}', '${activity.id}', ${idx})" title="삭제">
                    <i class="fas fa-times"></i>
                </button>
                ` : ''}
            </div>
            `).join('')}
        </div>
        ` : canEditActivity ? '' : `
        <div class="activity-images-empty">
            <i class="fas fa-image" style="font-size: 24px; opacity: 0.3; margin-bottom: 8px;"></i>
            <p style="margin: 0; color: var(--text-secondary); font-size: 13px;">등록된 사진이 없습니다</p>
        </div>
        `}
    </div>
</div>
`;
}

// 상태 드롭다운 토글
function toggleStatusDropdown(event, taskId, activityId) {
    if (!window.canEdit()) return;
    event.stopPropagation();

    // 기존 드롭다운 제거
    document.querySelectorAll('.status-dropdown').forEach(d => d.remove());

    const statusBtn = event.currentTarget;
    const dropdown = document.createElement('div');
    dropdown.className = 'status-dropdown';
    dropdown.innerHTML = `
<div class="status-dropdown-item pending" onclick="changeActivityStatus('${taskId}', '${activityId}', 'pending')">
    <i class="fas fa-clock"></i> 대기
</div>
<div class="status-dropdown-item in-progress" onclick="changeActivityStatus('${taskId}', '${activityId}', 'in-progress')">
    <i class="fas fa-spinner"></i> 진행중
</div>
<div class="status-dropdown-item completed" onclick="changeActivityStatus('${taskId}', '${activityId}', 'completed')">
    <i class="fas fa-check"></i> 완료
</div>
<div class="status-dropdown-item overdue" onclick="changeActivityStatus('${taskId}', '${activityId}', 'overdue')">
    <i class="fas fa-exclamation-triangle"></i> 지연
</div>
`;

    statusBtn.parentElement.appendChild(dropdown);

    // 외부 클릭 시 닫기
    setTimeout(() => {
        document.addEventListener('click', closeStatusDropdown, { once: true });
    }, 0);
}

// 드롭다운 닫기
function closeStatusDropdown() {
    document.querySelectorAll('.status-dropdown').forEach(d => d.remove());
}

// Activity 상태 변경
async function changeActivityStatus(taskId, activityId, newStatus) {
    if (!window.canEdit()) {
        callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const activity = task.activities.find(a => a.id === activityId);
    if (!activity) return;

    // 히스토리 저장
    saveToHistory('상태 변경');

    activity.status = newStatus;

    // 완료일 처리
    if (newStatus === 'completed') {
        activity.completedDate = new Date().toISOString().split('T')[0];
    } else {
        activity.completedDate = null;
    }

    // Firestore에 저장
    if (window.saveTaskToFirestore) {
        try {
            const wsId = window.currentWorkspaceId || currentWorkspaceId;
            await window.saveTaskToFirestore(task, wsId);
        } catch (error) {
            debugError("상태 변경 저장 실패:", error);
        }
    }

    // 드롭다운 닫기
    closeStatusDropdown();

    // 모달 및 카드 업데이트
    openDetailModal(taskId);
    renderTasks();
    updateFilterCounts();

    showToast(`"${activity.name}" 상태가 "${getStatusLabel(newStatus)}"(으)로 변경되었습니다.`, 'success');
}

// Progress 계산
function calculateProgress(task) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const issueDate = new Date(task.issueDate);
    issueDate.setHours(0, 0, 0, 0);

    const lastDueDate = new Date(Math.max(...task.activities.map(a => new Date(a.dueDate))));
    lastDueDate.setHours(0, 0, 0, 0);

    const totalDays = Math.max(1, (lastDueDate - issueDate) / (1000 * 60 * 60 * 24));
    const elapsedDays = Math.max(0, (today - issueDate) / (1000 * 60 * 60 * 24));
    const timelineProgress = Math.min(100, Math.round((elapsedDays / totalDays) * 100));

    const completedCount = task.activities.filter(a => a.status === 'completed').length;
    const completionProgress = Math.round((completedCount / task.activities.length) * 100);

    return { timelineProgress, completionProgress };
}

// 상세 모달 열기
function openDetailModal(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    currentTaskId = taskId;
    isEditMode = false;

    document.getElementById('modal-task-title').textContent = task.name;

    // 푸터 버튼 초기화 (Viewer면 닫기만 표시)
    document.getElementById('modal-footer-actions').innerHTML = window.canEdit()
        ? `
<button class="btn-delete" onclick="deleteTask()">
    <i class="fas fa-trash"></i>
    삭제
</button>
<button class="btn-edit" onclick="toggleEditMode()">
    <i class="fas fa-edit"></i>
    수정
</button>
`
        : `
<button class="btn-edit" onclick="closeDetailModal()">
    <i class="fas fa-times"></i>
    닫기
</button>
`;

    const { timelineProgress, completionProgress } = calculateProgress(task);
    const completedCount = task.activities.filter(a => a.status === 'completed').length;
    const inProgressCount = task.activities.filter(a => a.status === 'in-progress').length;
    const pendingCount = task.activities.filter(a => a.status === 'pending').length;
    const overdueCount = task.activities.filter(a => a.status === 'overdue').length;

    const modalBody = document.getElementById('modal-body-content');
    modalBody.innerHTML = `
<div class="tags-container" style="margin-bottom: 20px;">
    ${(task.tags || []).map(tag => `
        <span class="tag-badge"><i class="fas fa-hashtag"></i>${tag}</span>
    `).join('')}
</div>
<div class="detail-grid">
    <div class="detail-card">
        <div class="detail-card-title">
            <i class="fas fa-bullseye"></i>
            목적
        </div>
        <div class="detail-card-content">${task.purpose}</div>
    </div>
            <div class="detail-card">
                <div class="detail-card-title">
                    <i class="fas fa-list-check"></i>
                    Instruction
                </div>
                <div class="detail-card-content">${task.instruction}</div>
            </div>
            <div class="detail-card">
                <div class="detail-card-title">
                    <i class="fas fa-file-export"></i>
                    최종 산출물
                </div>
                <div class="detail-card-content">${task.output}</div>
            </div>
                        <div class="detail-card">
<div class="detail-card-title">
<i class="fas fa-info-circle"></i>
기본 정보
</div>
<div class="detail-card-content">
<div style="margin-bottom: 8px;">
    <strong>담당자:</strong> 
    <div class="assignees-container" style="display: inline-flex; margin-left: 4px;">
        ${renderAssigneesDetailHtml(task.assignees || task.assignee)}
    </div>
</div>
<div>
    <strong>시작일:</strong> ${formatDate(task.issueDate)}
</div>
</div>
</div>
        </div>

        <div class="timeline-section">
            <div class="timeline-header">
                <h3 class="timeline-title">
                    <i class="fas fa-stream"></i>
                    Activity Timeline
                </h3>
                <div class="timeline-stats">
                    <div class="timeline-stat">
                        <div class="timeline-stat-value" style="color: var(--success)">${completedCount}</div>
                        <div class="timeline-stat-label">완료</div>
                    </div>
                    <div class="timeline-stat">
                        <div class="timeline-stat-value" style="color: var(--info)">${inProgressCount}</div>
                        <div class="timeline-stat-label">진행중</div>
                    </div>
                    <div class="timeline-stat">
                        <div class="timeline-stat-value" style="color: var(--text-secondary)">${pendingCount}</div>
                        <div class="timeline-stat-label">대기</div>
                    </div>
                    ${overdueCount > 0 ? `
                    <div class="timeline-stat">
                        <div class="timeline-stat-value" style="color: var(--danger)">${overdueCount}</div>
                        <div class="timeline-stat-label">지연</div>
                    </div>
                    ` : ''}
                </div>
            </div>
                                <div class="timeline-container">
                <div class="timeline-line"></div>
                ${(() => {
            // 완료되지 않은 것들 (마감일 오름차순)
            const notCompleted = task.activities
                .filter(a => a.status !== 'completed')
                .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

            // 완료된 것들 (마감일 오름차순)
            const completed = task.activities
                .filter(a => a.status === 'completed')
                .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

            let html = '';

            // 미완료 Activity
            notCompleted.forEach(activity => {
                html += renderTimelineItem(activity, task.id, false);
            });

            // 완료 구분선 (완료된 항목이 있을 때만)
            if (completed.length > 0) {
                html += `
                            <div class="completed-divider">
                                <i class="fas fa-check-circle"></i>
                                완료된 활동 (${completed.length})
                            </div>
                        `;

                // 완료된 Activity
                completed.forEach(activity => {
                    html += renderTimelineItem(activity, task.id, true);
                });
            }

            return html;
        })()}
            </div>
        </div>
        </div >

    <div class="modal-progress">
        <div class="modal-progress-item">
            <div class="modal-progress-header">
                <span class="modal-progress-label">
                    <i class="fas fa-clock"></i>
                    Time Line
                </span>
                <span class="modal-progress-value" style="color: var(--info)">${timelineProgress}%</span>
            </div>
            <div class="modal-progress-bar">
                <div class="modal-progress-fill" style="width: ${timelineProgress}%; background: linear-gradient(90deg, var(--info), #60a5fa);"></div>
            </div>
        </div>
        <div class="modal-progress-item">
            <div class="modal-progress-header">
                <span class="modal-progress-label">
                    <i class="fas fa-check-circle"></i>
                    진행률
                </span>
                <span class="modal-progress-value" style="color: var(--success)">${completionProgress}%</span>
            </div>
            <div class="modal-progress-bar">
                <div class="modal-progress-fill" style="width: ${completionProgress}%; background: linear-gradient(90deg, var(--success), #4ade80);"></div>
            </div>
        </div>
    </div>
`;

    if (detailModal) detailModal.show();
}

// 수정 모드 토글
// 수정 모드 토글
// 수정 모드 토글
// 수정 모드 토글
function toggleEditMode() {
    if (!window.canEdit()) {
        callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }
    const task = tasks.find(t => t.id === currentTaskId);
    if (!task) return;

    isEditMode = true;

    // 푸터 버튼 변경
    document.getElementById('modal-footer-actions').innerHTML = window.canEdit()
        ? `
<button class="btn-cancel" onclick="openDetailModal('${currentTaskId}')">
    취소
</button>
<button class="btn-save" onclick="saveEditedTask()">
    <i class="fas fa-save"></i>
    저장
</button>
`
        : `
<button class="btn-edit" onclick="closeDetailModal()">
    <i class="fas fa-times"></i>
    닫기
</button>
`;

    const { timelineProgress, completionProgress } = calculateProgress(task);

    // Activity Timeline과 동일한 순서로 정렬 (미완료 → 완료)
    const notCompletedActivities = task.activities
        .filter(a => a.status !== 'completed')
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    const completedActivities = task.activities
        .filter(a => a.status === 'completed')
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    const sortedActivities = [...notCompletedActivities, ...completedActivities];

    const modalBody = document.getElementById('modal-body-content');
    modalBody.innerHTML = `
<div class="mb-3">
    <label class="form-label text-secondary">태스크 이름</label>
    <input type="text" class="editable-field" id="edit-task-name" value="${task.name}" placeholder="태스크 이름을 입력하세요" style="font-size: 16px; font-weight: 600;" autocomplete="off">
</div>
<div class="mb-3">
    <label class="form-label text-secondary">태그</label>
    <div class="tags-input-container" id="edit-tags-container">
        ${(task.tags || []).map((tag, i) => `
            <span class="tag-item">#${tag} <button type="button" onclick="removeEditTag(${i})">&times;</button></span>
        `).join('')}
        <input type="text" class="tags-input" id="edit-tags-input" placeholder="태그 입력 후 Enter" autocomplete="off">
    </div>
</div>
<div class="detail-grid">
    <div class="detail-card">
        <div class="detail-card-title">
            <i class="fas fa-bullseye"></i>
            목적
        </div>
        <textarea class="editable-field" id="edit-purpose" rows="3" placeholder="이 태스크의 목적을 입력하세요" autocomplete="off">${task.purpose}</textarea>
    </div>
    <div class="detail-card">
        <div class="detail-card-title">
            <i class="fas fa-list-check"></i>
            Instruction
        </div>
        <textarea class="editable-field" id="edit-instruction" rows="3" placeholder="수행 방법이나 지시사항을 입력하세요" autocomplete="off">${task.instruction}</textarea>
    </div>
    <div class="detail-card">
        <div class="detail-card-title">
            <i class="fas fa-file-export"></i>
            최종 산출물
        </div>
        <input type="text" class="editable-field" id="edit-output" value="${task.output}" placeholder="예상되는 산출물을 입력하세요" autocomplete="off">
    </div>
    <div class="detail-card">
        <div class="detail-card-title">
            <i class="fas fa-info-circle"></i>
            기본 정보
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px;">
            <div>
                <label class="form-label text-secondary" style="font-size: 12px;">담당자</label>
                <div class="tags-input-container" id="edit-assignees-container">
                    ${(task.assignees || (task.assignee ? [task.assignee] : [])).map((assignee, i) => `
                        <span class="assignee-item ${i === 0 ? 'main' : 'sub'}" style="
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            padding: 4px 8px 4px 10px;
                            background: ${i === 0 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(100, 116, 139, 0.1)'};
                            color: ${i === 0 ? 'var(--primary)' : 'var(--text-secondary)'};
                            border-radius: 12px;
                            font-size: 12px;
                            font-weight: 500;
                            overflow: hidden;
                            box-sizing: border-box;
                        ">${i === 0 ? '<i class="fas fa-star" style="font-size: 9px;"></i>' : ''}${assignee} <button type="button" style="background:none;border:none;cursor:pointer;padding:0;margin:0;color:inherit;opacity:0.7;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;" onclick="removeEditAssignee(${i})">&times;</button></span>
                    `).join('')}
                    <input type="text" class="tags-input" id="edit-assignees-input" placeholder="담당자 추가 (Enter)" autocomplete="off">
                </div>
                <small class="text-muted" style="font-size: 10px;">첫 번째가 Main 담당자</small>
            </div>
            <div>
                <label class="form-label text-secondary" style="font-size: 12px;">시작일</label>
                <input type="date" class="editable-field" id="edit-issueDate" value="${task.issueDate}">
            </div>
        </div>
    </div>
</div>

<div class="timeline-section">
    <div class="timeline-header">
        <h3 class="timeline-title">
            <i class="fas fa-stream"></i>
            Activity 관리
        </h3>
    </div>
    <div id="activities-edit-container">
        ${sortedActivities.map((activity, index) => `
            <div class="activity-edit-item" data-index="${index}" data-activity-id="${activity.id}" draggable="true">
                <div class="activity-drag-handle" title="드래그하여 순서 변경">
                    <i class="fas fa-grip-vertical"></i>
                </div>
                <div class="activity-edit-header">
                    <div class="activity-name-row">
                        <div class="activity-name-field">
                            <label>Activity</label>
                            <input type="text" class="editable-field activity-name-input" value="${activity.name}" placeholder="활동명을 입력하세요" autocomplete="off">
                        </div>
                    </div>
                    <button type="button" class="btn-remove-activity" onclick="removeActivity(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="activity-edit-row">
                    <label>Description</label>
                    <input type="text" class="editable-field activity-desc-input" value="${activity.description}" placeholder="설명을 입력하세요" autocomplete="off">
                </div>
                <div class="activity-edit-grid">
                    <div>
                        <label>시작일</label>
                        <input type="date" class="editable-field activity-start-input" value="${activity.startDate || getDefaultStartDate(activity.dueDate)}">
                    </div>
                    <div>
                        <label>마감일</label>
                        <input type="date" class="editable-field activity-due-input" value="${activity.dueDate}">
                    </div>
                    <div>
                        <label>상태</label>
                        <select class="editable-field activity-status-input">
                            <option value="pending" ${activity.status === 'pending' ? 'selected' : ''}>대기</option>
                            <option value="in-progress" ${activity.status === 'in-progress' ? 'selected' : ''}>진행중</option>
                            <option value="completed" ${activity.status === 'completed' ? 'selected' : ''}>완료</option>
                            <option value="overdue" ${activity.status === 'overdue' ? 'selected' : ''}>지연</option>
                        </select>
                    </div>
                    <div>
                        <label>담당자</label>
                        <div class="activity-assignee-selector" data-activity-index="${index}">
                            ${renderActivityAssigneeChips(task, activity.assignees || [], index)}
                        </div>
                    </div>
                </div>
            </div>
        `).join('')}
    </div>
    <button type="button" class="btn-add-activity" onclick="addActivity()">
        <i class="fas fa-plus"></i>
        Activity 추가
    </button>
</div>
`;

    // 수정 모드 태그 입력 이벤트
    document.getElementById('edit-tags-input').addEventListener('keydown', handleEditTagInput);

    // 수정 모드 담당자 입력 이벤트
    document.getElementById('edit-assignees-input').addEventListener('keydown', handleEditAssigneeInput);

    // Activity 드래그 앤 드롭 이벤트
    setupActivityDragAndDrop();
}

// 수정 모드 담당자 입력 처리
function handleEditAssigneeInput(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const task = tasks.find(t => t.id === currentTaskId);
        if (!task) return;

        const value = e.target.value.trim();
        if (!task.assignees) {
            task.assignees = task.assignee ? [task.assignee] : [];
        }

        if (value && !task.assignees.includes(value)) {
            task.assignees.push(value);
            renderEditAssignees();
        }
        e.target.value = '';
    }
}

// 수정 모드 담당자 렌더링
function renderEditAssignees() {
    const task = tasks.find(t => t.id === currentTaskId);
    if (!task) return;

    const container = document.getElementById('edit-assignees-container');
    const input = document.getElementById('edit-assignees-input');

    container.querySelectorAll('.assignee-item').forEach(el => el.remove());

    (task.assignees || []).forEach((assignee, index) => {
        const assigneeEl = document.createElement('span');
        assigneeEl.className = `assignee-item ${index === 0 ? 'main' : 'sub'}`;
        assigneeEl.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px 4px 10px;
    background: ${index === 0 ? 'rgba(99, 102, 241, 0.15)' : 'rgba(100, 116, 139, 0.1)'};
    color: ${index === 0 ? 'var(--primary)' : 'var(--text-secondary)'};
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    box-sizing: border-box;
`;
        assigneeEl.innerHTML = `${index === 0 ? '<i class="fas fa-star" style="font-size: 9px;"></i>' : ''}${assignee} <button type="button" style="background:none;border:none;cursor:pointer;padding:0;margin:0;color:inherit;opacity:0.7;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;flex-shrink:0;" onclick="removeEditAssignee(${index})">&times;</button>`;
        container.insertBefore(assigneeEl, input);
    });
}

// 수정 모드 담당자 제거
function removeEditAssignee(index) {
    const task = tasks.find(t => t.id === currentTaskId);
    if (!task || !task.assignees) return;

    task.assignees.splice(index, 1);
    renderEditAssignees();
}

// Activity 담당자 칩 렌더링
function renderActivityAssigneeChips(task, selectedAssignees, activityIndex) {
    const taskAssignees = task?.assignees || (task?.assignee ? [task.assignee] : []);
    const selected = selectedAssignees || [];

    // 태스크 담당자 칩들
    let html = taskAssignees.map(assignee => {
        const isSelected = selected.includes(assignee);
        return `<span class="assignee-chip ${isSelected ? 'selected' : ''}" 
              onclick="toggleActivityAssignee(${activityIndex}, '${assignee}', this)"
              data-assignee="${assignee}">
            ${assignee}
        </span>`;
    }).join('');

    // 커스텀 담당자 (태스크 담당자에 없는 선택된 담당자)
    const customAssignees = selected.filter(a => !taskAssignees.includes(a));
    html += customAssignees.map(assignee => {
        return `<span class="assignee-chip selected custom" 
              data-assignee="${assignee}"
              data-custom="true">
            ${assignee}
            <span class="chip-remove" onclick="removeCustomActivityAssignee(${activityIndex}, '${assignee}', event)">×</span>
        </span>`;
    }).join('');

    // 추가 버튼
    html += `<button type="button" class="add-custom-assignee" onclick="showCustomAssigneeInput(${activityIndex}, this)">
        <i class="fas fa-plus"></i> 추가
     </button>`;

    return html;
}

// Activity 담당자 토글
function toggleActivityAssignee(activityIndex, assignee, chipElement) {
    chipElement.classList.toggle('selected');
}

// 커스텀 담당자 입력창 표시
function showCustomAssigneeInput(activityIndex, buttonElement) {
    // 이미 입력창이 있으면 제거
    const existingInput = buttonElement.parentElement.querySelector('.custom-assignee-input');
    if (existingInput) {
        existingInput.remove();
        return;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-assignee-input';
    input.placeholder = '이름 입력';

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const value = input.value.trim();
            if (value) {
                addCustomActivityAssignee(activityIndex, value, buttonElement.parentElement);
            }
            input.remove();
        } else if (e.key === 'Escape') {
            input.remove();
        }
    });

    input.addEventListener('blur', () => {
        const value = input.value.trim();
        if (value) {
            addCustomActivityAssignee(activityIndex, value, buttonElement.parentElement);
        }
        input.remove();
    });

    buttonElement.parentElement.insertBefore(input, buttonElement);
    input.focus();
}

// 커스텀 담당자 추가
function addCustomActivityAssignee(activityIndex, assignee, container) {
    // 이미 존재하는지 확인
    const existingChips = container.querySelectorAll('.assignee-chip');
    for (const chip of existingChips) {
        if (chip.dataset.assignee === assignee) {
            chip.classList.add('selected');
            return;
        }
    }

    // 새 커스텀 칩 추가
    const addButton = container.querySelector('.add-custom-assignee');
    const newChip = document.createElement('span');
    newChip.className = 'assignee-chip selected custom';
    newChip.dataset.assignee = assignee;
    newChip.dataset.custom = 'true';
    newChip.innerHTML = `${assignee}<span class="chip-remove" onclick="removeCustomActivityAssignee(${activityIndex}, '${assignee}', event)">×</span>`;

    container.insertBefore(newChip, addButton);
}

// 커스텀 담당자 제거
function removeCustomActivityAssignee(activityIndex, assignee, event) {
    event.stopPropagation();
    const chip = event.target.closest('.assignee-chip');
    if (chip) {
        chip.remove();
    }
}

// Activity 담당자 수집 (저장 시 사용)
function getActivityAssignees(activityItem) {
    const selector = activityItem.querySelector('.activity-assignee-selector');
    if (!selector) return [];

    const selectedChips = selector.querySelectorAll('.assignee-chip.selected');
    return Array.from(selectedChips).map(chip => chip.dataset.assignee);
}

// 기본 시작일 계산 (마감일 - 7일)
function getDefaultStartDate(dueDate) {
    const due = new Date(dueDate);
    due.setDate(due.getDate() - 7);
    return due.toISOString().split('T')[0];
}

// 수정 모드 태그 입력 처리
function handleEditTagInput(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        const task = tasks.find(t => t.id === currentTaskId);
        if (!task) return;

        const value = e.target.value.trim();
        if (!task.tags) task.tags = [];

        if (value && !task.tags.includes(value)) {
            task.tags.push(value);
            renderEditTags();
        }
        e.target.value = '';
    }
}

// 수정 모드 태그 렌더링
function renderEditTags() {
    const task = tasks.find(t => t.id === currentTaskId);
    if (!task) return;

    const container = document.getElementById('edit-tags-container');
    const input = document.getElementById('edit-tags-input');

    container.querySelectorAll('.tag-item').forEach(el => el.remove());

    (task.tags || []).forEach((tag, index) => {
        const tagEl = document.createElement('span');
        tagEl.className = 'tag-item';
        tagEl.innerHTML = `#${tag} <button type="button" onclick="removeEditTag(${index})">&times;</button>`;
        container.insertBefore(tagEl, input);
    });
}

// 수정 모드 태그 제거
function removeEditTag(index) {
    const task = tasks.find(t => t.id === currentTaskId);
    if (!task || !task.tags) return;

    task.tags.splice(index, 1);
    renderEditTags();
}

// Activity 추가
// Activity 추가
function addActivity() {
    const container = document.getElementById('activities-edit-container');
    const index = container.children.length;
    const newActivityId = 'a' + Date.now() + Math.random().toString(36).substr(2, 9);

    const newActivity = document.createElement('div');
    newActivity.className = 'activity-edit-item';
    newActivity.dataset.index = index;
    newActivity.dataset.activityId = newActivityId;
    newActivity.draggable = true;
    newActivity.innerHTML = `
<div class="activity-drag-handle" title="드래그하여 순서 변경">
<i class="fas fa-grip-vertical"></i>
</div>
<div class="activity-edit-header">
<div class="activity-name-row">
    <div class="activity-name-field">
        <label>Activity</label>
        <input type="text" class="editable-field activity-name-input" value="" placeholder="활동명을 입력하세요" autocomplete="off">
    </div>
</div>
<button type="button" class="btn-remove-activity" onclick="removeActivity(${index})">
    <i class="fas fa-trash"></i>
</button>
</div>
<div class="activity-edit-row">
<label>Description</label>
<input type="text" class="editable-field activity-desc-input" value="" placeholder="설명을 입력하세요" autocomplete="off">
</div>
<div class="activity-edit-grid">
            <div>
                <label>시작일</label>
                <input type="date" class="editable-field activity-start-input" value="">
            </div>
            <div>
                <label>마감일</label>
                <input type="date" class="editable-field activity-due-input" value="">
            </div>
            <div>
                <label>상태</label>
                <select class="editable-field activity-status-input">
                    <option value="pending" selected>대기</option>
                    <option value="in-progress">진행중</option>
                    <option value="completed">완료</option>
                    <option value="overdue">지연</option>
                </select>
            </div>
            <div>
                <label>담당자</label>
                <div class="activity-assignee-selector" data-activity-index="${index}">
                    ${renderActivityAssigneeChips(tasks.find(t => t.id === currentTaskId), [], index)}
                </div>
            </div>
        </div>
    `;
    container.appendChild(newActivity);
}

// Activity 제거
function removeActivity(index) {
    const container = document.getElementById('activities-edit-container');
    const items = container.querySelectorAll('.activity-edit-item');

    if (items.length <= 1) {
        alert('최소 1개의 Activity가 필요합니다.');
        return;
    }

    items[index].remove();

    // 인덱스 재정렬
    updateActivityIndices();
}

// Activity 드래그 앤 드롭 설정
function setupActivityDragAndDrop() {
    const container = document.getElementById('activities-edit-container');
    if (!container) return;

    let draggedItem = null;

    container.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.activity-edit-item');
        if (!item) return;

        draggedItem = item;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    container.addEventListener('dragend', (e) => {
        const item = e.target.closest('.activity-edit-item');
        if (item) {
            item.classList.remove('dragging');
        }

        document.querySelectorAll('.activity-edit-item.drag-over').forEach(i => {
            i.classList.remove('drag-over');
        });

        draggedItem = null;
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const item = e.target.closest('.activity-edit-item');
        if (item && item !== draggedItem) {
            document.querySelectorAll('.activity-edit-item.drag-over').forEach(i => {
                if (i !== item) i.classList.remove('drag-over');
            });
            item.classList.add('drag-over');
        }
    });

    container.addEventListener('dragleave', (e) => {
        const item = e.target.closest('.activity-edit-item');
        if (item && !item.contains(e.relatedTarget)) {
            item.classList.remove('drag-over');
        }
    });

    container.addEventListener('drop', (e) => {
        e.preventDefault();

        const targetItem = e.target.closest('.activity-edit-item');
        if (!targetItem || !draggedItem || targetItem === draggedItem) return;

        // DOM 순서 변경
        const items = [...container.querySelectorAll('.activity-edit-item')];
        const draggedIndex = items.indexOf(draggedItem);
        const targetIndex = items.indexOf(targetItem);

        if (draggedIndex < targetIndex) {
            targetItem.after(draggedItem);
        } else {
            targetItem.before(draggedItem);
        }

        targetItem.classList.remove('drag-over');

        // 인덱스 업데이트
        updateActivityIndices();
    });
}

// Activity 인덱스 업데이트
function updateActivityIndices() {
    const container = document.getElementById('activities-edit-container');
    container.querySelectorAll('.activity-edit-item').forEach((item, i) => {
        item.dataset.index = i;
        const selector = item.querySelector('.activity-assignee-selector');
        if (selector) {
            selector.dataset.activityIndex = i;
        }
        const removeBtn = item.querySelector('.btn-remove-activity');
        if (removeBtn) {
            removeBtn.setAttribute('onclick', `removeActivity(${i})`);
        }
    });
}

// 수정된 태스크 저장
async function saveEditedTask() {
    if (!window.canEdit()) {
        callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }
    const task = tasks.find(t => t.id === currentTaskId);
    if (!task) return;

    // 히스토리 저장
    saveToHistory('태스크 수정');

    // 기본 정보 저장
    task.name = document.getElementById('edit-task-name').value.trim();
    task.purpose = document.getElementById('edit-purpose').value.trim();
    task.instruction = document.getElementById('edit-instruction').value.trim();
    task.output = document.getElementById('edit-output').value.trim();
    // assignees는 이미 실시간으로 업데이트됨
    if (!task.assignees || task.assignees.length === 0) {
        task.assignees = ['미지정'];
    }
    delete task.assignee; // 기존 단일 담당자 필드 제거
    task.issueDate = document.getElementById('edit-issueDate').value;

    // Activities 저장
    const activityItems = document.querySelectorAll('.activity-edit-item');
    task.activities = Array.from(activityItems).map(item => {
        const status = item.querySelector('.activity-status-input').value;
        const dueDate = item.querySelector('.activity-due-input').value;
        const startDate = item.querySelector('.activity-start-input').value;
        const assignees = getActivityAssignees(item);
        // 기존 activity ID 유지 (있으면)
        const existingId = item.dataset.activityId || ('a' + Date.now() + Math.random().toString(36).substr(2, 9));
        return {
            id: existingId,
            name: item.querySelector('.activity-name-input').value.trim(),
            description: item.querySelector('.activity-desc-input').value.trim(),
            startDate: startDate || getDefaultStartDate(dueDate),
            dueDate: dueDate,
            completedDate: status === 'completed' ? new Date().toISOString().split('T')[0] : null,
            status: status,
            assignees: assignees
        };
    });

    // Firestore에 저장
    if (window.saveTaskToFirestore) {
        try {
            const wsId = window.currentWorkspaceId || currentWorkspaceId;
            await window.saveTaskToFirestore(task, wsId);
        } catch (error) {
            debugError("태스크 수정 저장 실패:", error);
        }
    }

    // 렌더링 업데이트
    renderTasks();
    updateFilterCounts();

    // 상세 모달 다시 열기
    openDetailModal(currentTaskId);
}

// 태스크 삭제
async function deleteTask() {
    if (!window.canEdit()) {
        callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }
    if (!currentTaskId) return;

    if (confirm('정말로 이 태스크를 삭제하시겠습니까?')) {
        const taskName = tasks.find(t => t.id === currentTaskId)?.name || '';
        const taskIdToDelete = currentTaskId;

        // 히스토리 저장
        saveToHistory('태스크 삭제');

        // Firestore에서 삭제
        if (window.deleteTaskFromFirestore) {
            try {
                const wsId = window.currentWorkspaceId || currentWorkspaceId;
                await window.deleteTaskFromFirestore(taskIdToDelete, wsId);
            } catch (error) {
                debugError("태스크 삭제 실패:", error);
            }
        }

        tasks = tasks.filter(t => t.id !== currentTaskId);
        window.tasks = tasks; // window.tasks 동기화
        normalizePriorities();

        // 우선순위 변경 후 Firestore에 저장
        if (window.saveAllTasksToFirestore) {
            try {
                const wsId = window.currentWorkspaceId || currentWorkspaceId;
                await window.saveAllTasksToFirestore(wsId);
            } catch (error) {
                debugError("우선순위 업데이트 저장 실패:", error);
            }
        }

        renderTasks();
        updateFilterCounts();
        if (detailModal) detailModal.hide();
        currentTaskId = null;

        showToast(`"${taskName}" 태스크가 삭제되었습니다.`, 'success');
    }
}

// 태스크 모달 열기
function openTaskModal(task = null) {
    if (!task && !window.canEdit()) {
        callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }
    
    const modalTitleEl = document.getElementById('task-modal-title');
    const taskFormEl = document.getElementById('task-form');
    
    if (!modalTitleEl || !taskFormEl) {
        console.error('Task modal elements not found');
        return;
    }
    
    modalTitleEl.textContent = task ? '태스크 수정' : '새 태스크 추가';
    taskFormEl.reset();
    currentTags = [];
    currentAssignees = [];

    // Viewer일 때 모든 입력 필드 readonly 처리
    const isReadOnly = !window.canEdit();

    if (task) {
        document.getElementById('task-id').value = task.id;
        document.getElementById('task-name').value = task.name;
        document.getElementById('task-purpose').value = task.purpose;
        document.getElementById('task-instruction').value = task.instruction;
        document.getElementById('task-output').value = task.output;
        document.getElementById('task-start-date').value = task.issueDate;
        currentTags = [...(task.tags || [])];
        currentAssignees = [...(task.assignees || (task.assignee ? [task.assignee] : []))];
    } else {
        document.getElementById('task-id').value = '';
        document.getElementById('task-start-date').value = new Date().toISOString().split('T')[0];
    }

    renderTagsInput();
    renderAssigneesInput();

    // Viewer일 때 모든 입력 필드 readonly 처리
    if (isReadOnly) {
        const inputs = document.querySelectorAll('#task-modal input, #task-modal textarea');
        inputs.forEach(input => {
            input.readOnly = true;
            input.disabled = true;
        });
        // 저장 버튼 숨김
        const saveBtn = document.getElementById('save-task-btn');
        if (saveBtn) saveBtn.style.display = 'none';
    } else {
        const inputs = document.querySelectorAll('#task-modal input, #task-modal textarea');
        inputs.forEach(input => {
            input.readOnly = false;
            input.disabled = false;
        });
        const saveBtn = document.getElementById('save-task-btn');
        if (saveBtn) saveBtn.style.display = '';
    }

    if (taskModal) {
        taskModal.show();
    } else {
        console.error('Task modal not initialized');
        // 모달이 초기화되지 않았으면 다시 초기화 시도
        const taskModalEl = document.getElementById('task-modal');
        if (taskModalEl) {
            taskModal = new bootstrap.Modal(taskModalEl);
            taskModal.show();
        }
    }
}

// 태스크 저장
async function saveTask() {
    if (!window.canEdit()) {
        callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }
    const id = document.getElementById('task-id').value;
    const name = document.getElementById('task-name').value.trim();
    const purpose = document.getElementById('task-purpose').value.trim();
    const instruction = document.getElementById('task-instruction').value.trim();
    const output = document.getElementById('task-output').value.trim();
    const issueDate = document.getElementById('task-start-date').value;

    if (!name) {
        alert('태스크 이름을 입력해주세요.');
        return;
    }

    if (id) {
        // 기존 태스크 수정
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex !== -1) {
            tasks[taskIndex] = {
                ...tasks[taskIndex],
                name,
                purpose,
                instruction,
                output,
                tags: [...currentTags],
                issueDate,
                assignees: currentAssignees.length > 0 ? [...currentAssignees] : ['미지정']
            };
            delete tasks[taskIndex].assignee; // 기존 단일 담당자 필드 제거
            // tasks[taskIndex] 수정은 window.tasks가 같은 배열을 참조하므로 자동 반영됨

            // Firestore에 저장
            if (window.saveTaskToFirestore) {
                try {
                    const wsId = window.currentWorkspaceId || currentWorkspaceId;
                    await window.saveTaskToFirestore(tasks[taskIndex], wsId);
                } catch (error) {
                    debugError("태스크 수정 저장 실패:", error);
                }
            }
        }
    } else {
        // 새 태스크 추가
        // 히스토리 저장
        saveToHistory('태스크 추가');

        const defaultDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const newTaskId = Date.now().toString();
        const newTask = {
            id: newTaskId,
            name,
            priority: tasks.length + 1,
            purpose: purpose || '',
            instruction: instruction || '',
            output: output || '',
            tags: [...currentTags],
            issueDate: issueDate || new Date().toISOString().split('T')[0],
            assignees: currentAssignees.length > 0 ? [...currentAssignees] : [],
            activities: [
                {
                    id: 'a1',
                    name: '새 활동',
                    description: '',
                    startDate: getDefaultStartDate(defaultDueDate),
                    dueDate: defaultDueDate,
                    completedDate: null,
                    status: 'pending'
                }
            ]
        };
        tasks.push(newTask);
        window.tasks = tasks; // window.tasks 동기화

        // Firestore에 저장
        if (window.saveTaskToFirestore) {
            try {
                const wsId = window.currentWorkspaceId || currentWorkspaceId;
                await window.saveTaskToFirestore(newTask, wsId);
            } catch (error) {
                debugError("태스크 추가 저장 실패:", error);
            }
        }
    }

    sortTasksByPriority();
    renderTasks();
    updateFilterCounts();
    if (taskModal) taskModal.hide();
}

// 날짜 포맷
function formatDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${year}.${month.toString().padStart(2, '0')}.${day.toString().padStart(2, '0')}`;
}

// 토스트 메시지 표시
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast-message ${type}`;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle'
    };

    toast.innerHTML = `<i class="fas ${icons[type]}"></i>${message}`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}
window.showToast = showToast; // Firebase 모듈에서 접근 가능하도록

// ========== 추가 함수들 ==========

// 날짜 형식 검증 함수
function isValidDate(dateString) {
    if (!dateString) return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date);
}

// 템플릿 다운로드 함수 (Excel 형식)
function downloadTemplate() {
    try {
        // Tasks 시트 데이터
        const tasksData = [
            {
                taskKey: 'PJT1_TASK01',
                name: '샘플 태스크 1',
                purpose: '목적 예시',
                instruction: '지시사항 예시',
                output: '산출물 예시',
                tags: '태그1,태그2',
                assignees: '담당자1,담당자2',
                issueDate: '2024-01-15',
                startDate: '2024-01-15',
                priority: 1
            },
            {
                taskKey: 'PJT1_TASK02',
                name: '샘플 태스크 2',
                purpose: '',
                instruction: '',
                output: '',
                tags: '',
                assignees: '',
                issueDate: '2024-01-20',
                startDate: '2024-01-20',
                priority: 2
            }
        ];

        // Activities 시트 데이터
        const activitiesData = [
            {
                taskKey: 'PJT1_TASK01',
                name: 'Activity 1',
                description: '설명 예시',
                startDate: '2024-01-15',
                dueDate: '2024-01-20',
                status: 'pending',
                assignees: '담당자1'
            },
            {
                taskKey: 'PJT1_TASK01',
                name: 'Activity 2',
                description: '',
                startDate: '2024-01-16',
                dueDate: '2024-01-25',
                status: 'in-progress',
                assignees: '담당자2'
            },
            {
                taskKey: 'PJT1_TASK02',
                name: 'Activity 1',
                description: '',
                startDate: '2024-01-20',
                dueDate: '2024-01-30',
                status: 'pending',
                assignees: '담당자1'
            }
        ];

        // 워크북 생성
        const workbook = XLSX.utils.book_new();

        // Tasks 시트 생성
        const tasksWS = XLSX.utils.json_to_sheet(tasksData);
        XLSX.utils.book_append_sheet(workbook, tasksWS, 'Tasks');

        // Activities 시트 생성
        const activitiesWS = XLSX.utils.json_to_sheet(activitiesData);
        XLSX.utils.book_append_sheet(workbook, activitiesWS, 'Activities');

        // Excel 파일로 다운로드
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const excelBlob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
        const link = document.createElement('a');
        const url = URL.createObjectURL(excelBlob);
        link.href = url;
        link.download = 'Template.xlsx';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        callWindowFn('showToast', '템플릿 파일이 다운로드되었습니다.', 'success');
    } catch (error) {
        debugError('템플릿 다운로드 오류:', error);
        alert('템플릿 다운로드 중 오류가 발생했습니다: ' + error.message);
    }
}
window.downloadTemplate = downloadTemplate;

// 파일 업로드 시 미리보기 표시
function setupUploadPreview() {
    const fileInput = document.getElementById('upload-file-input');
    if (!fileInput) return;

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) {
            debugLog('파일이 선택되지 않았습니다.');
            return;
        }

        const previewDiv = document.getElementById('upload-preview');
        const previewContent = document.getElementById('upload-preview-content');
        const errorsDiv = document.getElementById('upload-errors');
        const errorsList = document.getElementById('upload-errors-list');
        const importBtn = document.getElementById('upload-process-btn');

        if (!previewDiv || !previewContent || !errorsDiv || !errorsList || !importBtn) {
            debugError('필요한 DOM 요소를 찾을 수 없습니다.');
            return;
        }

        previewDiv.style.display = 'block';
        errorsDiv.style.display = 'none';
        errorsList.innerHTML = '';
        importBtn.disabled = true;

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });

            // Tasks 시트 찾기
            const tasksSheet = workbook.SheetNames.find(name => 
                name.toLowerCase().includes('task') || name === 'Sheet1'
            ) || workbook.SheetNames[0];
            
            // Activities 시트 찾기
            const activitiesSheet = workbook.SheetNames.find(name => 
                name.toLowerCase().includes('activit')
            ) || (workbook.SheetNames.length > 1 ? workbook.SheetNames[1] : workbook.SheetNames[0]);

            const tasksRows = XLSX.utils.sheet_to_json(workbook.Sheets[tasksSheet]);
            const activitiesRows = workbook.SheetNames.length > 1 && activitiesSheet !== tasksSheet ? 
                XLSX.utils.sheet_to_json(workbook.Sheets[activitiesSheet]) : [];

            const errors = [];
            const tasksMap = new Map();
            const previewTasks = [];

            // Tasks 파싱 및 검증
            tasksRows.forEach((row, index) => {
                if (!row.taskKey || !row.name) {
                    errors.push(`Tasks 행 ${index + 2}: taskKey 또는 name이 없습니다.`);
                    return;
                }

                if (row.issueDate && !isValidDate(row.issueDate)) {
                    errors.push(`Tasks 행 ${index + 2}: issueDate 형식이 잘못되었습니다 (YYYY-MM-DD 필요).`);
                }
                if (row.startDate && !isValidDate(row.startDate)) {
                    errors.push(`Tasks 행 ${index + 2}: startDate 형식이 잘못되었습니다 (YYYY-MM-DD 필요).`);
                }

                const task = {
                    taskKey: String(row.taskKey),
                    name: String(row.name),
                    purpose: String(row.purpose || ''),
                    instruction: String(row.instruction || ''),
                    output: String(row.output || ''),
                    tags: row.tags ? String(row.tags).split(',').map(s => s.trim()) : [],
                    assignees: row.assignees ? String(row.assignees).split(',').map(s => s.trim()) : [],
                    issueDate: row.issueDate || row.startDate || new Date().toISOString().split('T')[0],
                    priority: parseInt(row.priority) || tasks.length + index + 1
                };

                tasksMap.set(task.taskKey, { ...task, activities: [] });
                previewTasks.push(task);
            });

            // Activities 파싱 및 검증
            activitiesRows.forEach((row, index) => {
                if (!row.taskKey || !row.name) {
                    errors.push(`Activities 행 ${index + 2}: taskKey 또는 name이 없습니다.`);
                    return;
                }

                if (row.dueDate && !isValidDate(row.dueDate)) {
                    errors.push(`Activities 행 ${index + 2}: dueDate 형식이 잘못되었습니다 (YYYY-MM-DD 필요).`);
                }
                if (row.startDate && !isValidDate(row.startDate)) {
                    errors.push(`Activities 행 ${index + 2}: startDate 형식이 잘못되었습니다 (YYYY-MM-DD 필요).`);
                }

                const validStatuses = ['pending', 'in-progress', 'completed', 'overdue'];
                if (row.status && !validStatuses.includes(String(row.status).toLowerCase())) {
                    errors.push(`Activities 행 ${index + 2}: status가 유효하지 않습니다 (${validStatuses.join('/')} 중 하나).`);
                }

                const task = tasksMap.get(String(row.taskKey));
                if (task) {
                    task.activities.push({
                        name: String(row.name),
                        description: String(row.description || ''),
                        startDate: row.startDate || '',
                        dueDate: row.dueDate || '',
                        status: (row.status || 'pending').toLowerCase(),
                        assignees: row.assignees ? String(row.assignees).split(',').map(s => s.trim()) : []
                    });
                } else {
                    errors.push(`Activities 행 ${index + 2}: taskKey "${row.taskKey}"에 해당하는 Task가 없습니다.`);
                }
            });

            // 미리보기 표시 (최대 10개)
            const previewHTML = previewTasks.slice(0, 10).map(task => {
                const taskData = tasksMap.get(task.taskKey);
                const activitiesCount = taskData ? taskData.activities.length : 0;
                return `
                    <div style="border-bottom: 1px solid #eee; padding: 8px 0;">
                        <strong>${task.taskKey}</strong>: ${task.name}<br>
                        <small class="text-muted">Activities: ${activitiesCount}개</small>
                    </div>
                `;
            }).join('');

            previewContent.innerHTML = previewHTML + 
                (previewTasks.length > 10 ? `<div class="text-muted small mt-2">... 외 ${previewTasks.length - 10}개 더</div>` : '');

            // 워크스페이스 ID 캡처
            const wsId = window.currentWorkspaceId || currentWorkspaceId;
            debugLog('[ExcelImport] 파일 파싱 시점 workspace ID:', wsId);

            if (!wsId) {
                errors.push('워크스페이스가 선택되지 않았습니다. 로그인 후 다시 시도해주세요.');
                debugError('[ExcelImport] 워크스페이스 ID가 없습니다.');
            }

            if (errors.length > 0) {
                errorsDiv.style.display = 'block';
                errorsList.innerHTML = errors.map(e => `<li>${e}</li>`).join('');
                importBtn.disabled = true;
            } else {
                importBtn.disabled = false;
            }

            // 전역 변수에 저장 (Import 시 사용)
            window.uploadPreviewData = { tasksMap, errors, wsId };

        } catch (error) {
            debugError('파일 읽기 오류:', error);
            if (previewContent) {
                previewContent.innerHTML = `<div class="text-danger">파일 읽기 실패: ${error.message}</div>`;
            }
            if (importBtn) {
                importBtn.disabled = true;
            }
        }
    });
}
window.setupUploadPreview = setupUploadPreview;

// 엑셀 업로드 처리 함수
async function handleExcelUpload() {
    if (!window.canEdit()) {
        callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }

    if (!window.uploadPreviewData || window.uploadPreviewData.errors.length > 0) {
        alert('파일을 먼저 선택하고 에러를 수정해주세요.');
        return;
    }

    const progressDiv = document.getElementById('upload-progress');
    const progressBar = progressDiv?.querySelector('.progress-bar');
    const statusText = document.getElementById('upload-status');
    const previewDiv = document.getElementById('upload-preview');
    const importBtn = document.getElementById('upload-process-btn');

    if (previewDiv) previewDiv.style.display = 'none';
    if (progressDiv) progressDiv.style.display = 'block';
    if (importBtn) importBtn.disabled = true;
    if (progressBar) progressBar.style.width = '10%';
    if (statusText) statusText.textContent = '데이터 준비 중...';

    try {
        const { tasksMap } = window.uploadPreviewData;
        const wsId = window.uploadPreviewData?.wsId || window.currentWorkspaceId || currentWorkspaceId;
        
        if (!wsId) {
            const errorMsg = '워크스페이스가 선택되지 않았습니다. 다시 선택 후 업로드하세요.';
            debugError('[ExcelImport] ABORT: wsId is falsy');
            callWindowFn('showToast', errorMsg, 'error') || alert(errorMsg);
            if (importBtn) importBtn.disabled = false;
            if (progressDiv) progressDiv.style.display = 'none';
            if (previewDiv) previewDiv.style.display = 'block';
            return;
        }

        // 권한 검증
        if (window.validateWritePermission) {
            try {
                await window.validateWritePermission(wsId);
            } catch (error) {
                debugError('[ExcelImport] 권한 검증 실패:', error);
                callWindowFn('showToast', `권한 검증 실패: ${error.message}`, 'error') || alert(`권한 검증 실패: ${error.message}`);
                if (importBtn) importBtn.disabled = false;
                if (progressDiv) progressDiv.style.display = 'none';
                if (previewDiv) previewDiv.style.display = 'block';
                return;
            }
        }

        const tasksToUpload = [];

        // tasksMap을 배열로 변환
        tasksMap.forEach((taskData, taskKey) => {
            const taskId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
            const task = {
                id: taskId,
                name: taskData.name,
                purpose: taskData.purpose || '',
                instruction: taskData.instruction || '',
                output: taskData.output || '',
                tags: taskData.tags || [],
                assignees: taskData.assignees || [],
                issueDate: taskData.issueDate,
                priority: taskData.priority || tasks.length + tasksToUpload.length + 1,
                activities: taskData.activities.map((act, idx) => ({
                    id: 'a' + Date.now() + idx + Math.random().toString(36).substr(2, 9),
                    name: act.name,
                    description: act.description || '',
                    startDate: act.startDate || getDefaultStartDate(act.dueDate),
                    dueDate: act.dueDate || '',
                    status: act.status || 'pending',
                    assignees: act.assignees || []
                }))
            };
            tasksToUpload.push(task);
        });

        if (progressBar) progressBar.style.width = '30%';
        if (statusText) statusText.textContent = `태스크 ${tasksToUpload.length}개 저장 중...`;

        // Firestore에 일괄 저장
        if (window.saveTaskToFirestore) {
            for (let i = 0; i < tasksToUpload.length; i++) {
                const task = tasksToUpload[i];
                try {
                    await window.saveTaskToFirestore(task, wsId);
                    if (progressBar) {
                        progressBar.style.width = `${30 + (i + 1) / tasksToUpload.length * 60}%`;
                    }
                } catch (error) {
                    debugError(`태스크 "${task.name}" 저장 실패:`, error);
                }
            }
        }

        // 로컬 tasks 배열에 추가
        tasks.push(...tasksToUpload);
        window.tasks = tasks;

        // 우선순위 정규화 및 정렬
        normalizePriorities();
        sortTasksByPriority();

        // 렌더링 업데이트
        renderTasks();
        updateFilterCounts();

        if (progressBar) progressBar.style.width = '100%';
        if (statusText) statusText.textContent = '완료!';

        setTimeout(() => {
            if (progressDiv) progressDiv.style.display = 'none';
            if (previewDiv) previewDiv.style.display = 'block';
            if (importBtn) importBtn.disabled = false;
            const uploadModal = bootstrap.Modal.getInstance(document.getElementById('upload-modal'));
            if (uploadModal) uploadModal.hide();
            callWindowFn('showToast', `${tasksToUpload.length}개의 태스크가 업로드되었습니다.`, 'success');
        }, 500);

    } catch (error) {
        debugError('업로드 처리 오류:', error);
        if (statusText) statusText.textContent = '오류 발생';
        callWindowFn('showToast', `업로드 실패: ${error.message}`, 'error') || alert(`업로드 실패: ${error.message}`);
        if (importBtn) importBtn.disabled = false;
        if (progressDiv) progressDiv.style.display = 'none';
        if (previewDiv) previewDiv.style.display = 'block';
    }
}
window.handleExcelUpload = handleExcelUpload;

// 캘린더 렌더링 함수
function renderCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    // 기존 캘린더 제거
    if (calendarInstance) {
        calendarInstance.destroy();
    }

    // 필터링된 태스크 가져오기
    const filteredTasks = getFilteredTasks();
    const lowerSearch = currentAssigneeSearch ? currentAssigneeSearch.toLowerCase() : '';

    // 이벤트 생성
    const events = [];
    const assigneeSet = new Set();
    assigneeSet.add('전체');

    filteredTasks.forEach(task => {
        if (lowerSearch) {
            const taskAssignees = task.assignees || [];
            const matchesTask = taskAssignees.some(a => a.toLowerCase().includes(lowerSearch));
            if (!matchesTask && !task.name.toLowerCase().includes(lowerSearch)) {
                return;
            }
        }

        task.activities.forEach(activity => {
            if (!activity.dueDate) return;

            if (lowerSearch) {
                const activityAssignees = activity.assignees || [];
                const matchesActivity = activityAssignees.some(a => a.toLowerCase().includes(lowerSearch));
                if (!matchesActivity && !activity.name.toLowerCase().includes(lowerSearch)) {
                    return;
                }
            }

            const isCompleted = activity.status === 'completed';
            if (currentFilter === 'completed' && !isCompleted) return;
            if (currentFilter === 'active' && isCompleted) return;

            const activityAssignees = activity.assignees || [];
            const taskAssignees = task.assignees || [];
            const allAssignees = [...activityAssignees, ...taskAssignees];
            allAssignees.forEach(a => assigneeSet.add(a));

            events.push({
                title: `${task.name} - ${activity.name}`,
                start: activity.dueDate,
                extendedProps: {
                    assignees: allAssignees,
                    status: activity.status,
                    taskId: task.id,
                    activityId: activity.id
                },
                backgroundColor: activity.status === 'completed' ? '#22c55e' :
                    activity.status === 'in-progress' ? '#3b82f6' :
                        activity.status === 'overdue' ? '#ef4444' : '#64748b',
                classNames: [`status-${activity.status}`]
            });
        });
    });

    // 담당자 필터 적용
    let filteredEvents = events;
    if (currentCalendarAssigneeFilter && currentCalendarAssigneeFilter.length > 0) {
        filteredEvents = events.filter(e =>
            currentCalendarAssigneeFilter.some(filterAssignee =>
                e.extendedProps.assignees.includes(filterAssignee)
            )
        );
    }

    // FullCalendar가 로드되었는지 확인 (전역 또는 window.FullCalendar)
    let FullCalendarLib = null;
    try {
        if (typeof window !== 'undefined' && window.FullCalendar) {
            FullCalendarLib = window.FullCalendar;
        } else if (typeof FullCalendar !== 'undefined') {
            FullCalendarLib = FullCalendar;
        }
    } catch (e) {
        // FullCalendar 체크 중 에러 무시
    }
    
    if (!FullCalendarLib) {
        // FullCalendar 로드 이벤트 대기
        const handleFullCalendarLoaded = () => {
            renderCalendar();
            window.removeEventListener('fullcalendarLoaded', handleFullCalendarLoaded);
        };
        window.addEventListener('fullcalendarLoaded', handleFullCalendarLoaded);
        
        // 타임아웃 설정 (최대 5초 대기)
        setTimeout(() => {
            window.removeEventListener('fullcalendarLoaded', handleFullCalendarLoaded);
            let FullCalendarLibRetry = null;
            try {
                if (typeof window !== 'undefined' && window.FullCalendar) {
                    FullCalendarLibRetry = window.FullCalendar;
                } else if (typeof FullCalendar !== 'undefined') {
                    FullCalendarLibRetry = FullCalendar;
                }
            } catch (e) {
                // 재확인 중 에러 무시
            }
            if (FullCalendarLibRetry) {
                renderCalendar();
            }
        }, 5000);
        return;
    }

    // FullCalendarLib.Calendar가 존재하는지 확인
    if (!FullCalendarLib || !FullCalendarLib.Calendar) {
        return;
    }
    // 캘린더 생성
    calendarInstance = new FullCalendarLib.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ko',
        editable: false,
        height: 'auto',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: ''
        },
        views: {
            dayGridMonth: {
                titleFormat: { year: 'numeric', month: 'long' },
                dayHeaderFormat: { weekday: 'short' },
                dayMaxEvents: 3,
                moreLinkClick: 'popover'
            }
        },
        events: filteredEvents,
        eventClick: function (info) {
            const taskId = info.event.extendedProps.taskId;
            if (taskId) {
                callWindowFn('openDetailModal', taskId);
            }
        },
        eventContent: function(arg) {
            // 이벤트 내용 커스터마이징: 제목과 담당자 태그 표시
            const assignees = arg.event.extendedProps.assignees || [];
            const title = arg.event.title;
            
            // 담당자 태그 생성 (항상 표시, 최대 3명까지)
            let assigneeTags = '';
            if (assignees && assignees.length > 0) {
                // 필터가 적용된 경우 필터링된 담당자만, 아니면 모든 담당자 표시
                let displayAssignees = assignees;
                if (currentCalendarAssigneeFilter && currentCalendarAssigneeFilter.length > 0) {
                    displayAssignees = assignees.filter(a => currentCalendarAssigneeFilter.includes(a));
                }
                
                // 최대 3명까지 표시
                if (displayAssignees.length > 0) {
                    const tagsToShow = displayAssignees.slice(0, 3);
                    assigneeTags = tagsToShow.map(assignee => {
                        // 이름에서 성만 추출 (예: "김부장" -> "김")
                        const shortName = assignee && assignee.length > 2 ? assignee.substring(0, 1) : (assignee || '');
                        return `<span class="calendar-assignee-tag" title="${assignee}">${shortName}</span>`;
                    }).join('');
                    
                    // 3명 초과 시 "+N" 표시
                    if (displayAssignees.length > 3) {
                        assigneeTags += `<span class="calendar-assignee-tag">+${displayAssignees.length - 3}</span>`;
                    }
                }
            }
            
            // 이벤트 내용 구성
            const titleDiv = document.createElement('div');
            titleDiv.className = 'fc-event-title';
            titleDiv.textContent = title;
            
            const wrapperDiv = document.createElement('div');
            wrapperDiv.className = 'fc-event-main-frame';
            wrapperDiv.appendChild(titleDiv);
            
            if (assigneeTags) {
                const tagsDiv = document.createElement('div');
                tagsDiv.className = 'fc-event-assignee-tags';
                tagsDiv.innerHTML = assigneeTags;
                wrapperDiv.appendChild(tagsDiv);
            }
            
            return { domNodes: [wrapperDiv] };
        },
        eventClassNames: function(info) {
            return [`status-${info.event.extendedProps.status}`, 'calendar-event'];
        },
        eventDisplay: 'block',
        eventTextColor: '#fff',
        eventBorderColor: 'transparent',
        dayMaxEvents: 4,
        moreLinkClick: 'popover'
    });

    calendarInstance.render();
}
window.renderCalendar = renderCalendar;

// Calendar 담당자 필터 드롭다운 업데이트
function updateCalendarAssigneeDropdown() {
    const checkboxesContainer = document.getElementById('calendar-assignee-checkboxes');
    const dropdownBtn = document.getElementById('calendar-assignee-dropdown-btn');
    if (!checkboxesContainer || !dropdownBtn) return;

    const assigneeSet = new Set();
    tasks.forEach(task => {
        (task.assignees || []).forEach(a => assigneeSet.add(a));
        task.activities.forEach(activity => {
            (activity.assignees || []).forEach(a => assigneeSet.add(a));
        });
    });

    const assignees = Array.from(assigneeSet).filter(a => a).sort();
    
    checkboxesContainer.innerHTML = '';
    assignees.forEach(assignee => {
        const item = document.createElement('div');
        item.className = 'assignee-dropdown-item';
        const isChecked = currentCalendarAssigneeFilter.includes(assignee);
        const safeId = assignee.replace(/[^a-zA-Z0-9가-힣]/g, '_');
        item.innerHTML = `
            <input type="checkbox" id="calendar-check-${safeId}" ${isChecked ? 'checked' : ''} value="${assignee}">
            <label for="calendar-check-${safeId}">${assignee}</label>
        `;
        checkboxesContainer.appendChild(item);
    });

    updateCalendarAssigneeButtonText();
}
window.updateCalendarAssigneeDropdown = updateCalendarAssigneeDropdown;

// Calendar 담당자 필터 버튼 텍스트 업데이트
function updateCalendarAssigneeButtonText() {
    const btn = document.getElementById('calendar-assignee-dropdown-btn');
    const countBadge = document.getElementById('calendar-selected-count');
    if (!btn) return;

    const selectedText = btn.querySelector('.selected-text');
    if (currentCalendarAssigneeFilter.length === 0) {
        selectedText.textContent = '전체 담당자';
        if (countBadge) countBadge.classList.remove('show');
    } else if (currentCalendarAssigneeFilter.length === 1) {
        selectedText.textContent = currentCalendarAssigneeFilter[0];
        if (countBadge) countBadge.classList.remove('show');
    } else {
        selectedText.textContent = `${currentCalendarAssigneeFilter[0]} 외 ${currentCalendarAssigneeFilter.length - 1}명`;
        if (countBadge) {
            countBadge.textContent = currentCalendarAssigneeFilter.length;
            countBadge.classList.add('show');
        }
    }
}

// Calendar 담당자 필터 적용
function applyCalendarAssigneeFilter() {
    const checkboxes = document.querySelectorAll('#calendar-assignee-checkboxes input[type="checkbox"]');
    const selected = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);
    
    currentCalendarAssigneeFilter = selected;
    updateCalendarAssigneeButtonText();
    
    const menu = document.getElementById('calendar-assignee-dropdown-menu');
    const btn = document.getElementById('calendar-assignee-dropdown-btn');
    if (menu) menu.classList.remove('show');
    if (btn) btn.classList.remove('active');
    
    renderCalendar();
}
window.applyCalendarAssigneeFilter = applyCalendarAssigneeFilter;

// Calendar 담당자 필터 전체 해제
function clearCalendarAssigneeFilter() {
    const checkboxes = document.querySelectorAll('#calendar-assignee-checkboxes input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = false);
    currentCalendarAssigneeFilter = [];
    updateCalendarAssigneeButtonText();
    
    const menu = document.getElementById('calendar-assignee-dropdown-menu');
    const btn = document.getElementById('calendar-assignee-dropdown-btn');
    if (menu) menu.classList.remove('show');
    if (btn) btn.classList.remove('active');
    
    renderCalendar();
}
window.clearCalendarAssigneeFilter = clearCalendarAssigneeFilter;

// 모달 닫기 헬퍼 함수
window.closeDetailModal = () => {
    if (detailModal) detailModal.hide();
};
window.closeTaskModal = () => {
    if (taskModal) taskModal.hide();
};

// 전역 함수 노출
window.openDetailModal = openDetailModal;
window.openTaskModal = openTaskModal;
window.deleteTask = deleteTask;
window.toggleEditMode = toggleEditMode;
window.saveEditedTask = saveEditedTask;
window.handleCardClick = handleCardClick;
window.removeTag = removeTag;
window.removeAssignee = removeAssignee;
window.removeEditTag = removeEditTag;
window.removeEditAssignee = removeEditAssignee;
window.addActivity = addActivity;
window.removeActivity = removeActivity;
window.toggleActivityAssignee = toggleActivityAssignee;
window.showCustomAssigneeInput = showCustomAssigneeInput;
window.removeCustomActivityAssignee = removeCustomActivityAssignee;
window.toggleStatusDropdown = toggleStatusDropdown;
window.changeActivityStatus = changeActivityStatus;
window.applyActivityAssigneeFilter = applyActivityAssigneeFilter;
window.clearActivityAssigneeFilter = clearActivityAssigneeFilter;
// 함수를 window에 노출 (HTML의 onclick에서 사용 가능하도록)
window.setFilter = setFilter;
window.setViewMode = setViewMode;

// 즉시 실행 함수로도 노출 (스크립트 로드 순서와 무관하게)
(function() {
    if (typeof setFilter === 'function') {
        window.setFilter = setFilter;
    }
    if (typeof setViewMode === 'function') {
        window.setViewMode = setViewMode;
    }
})();

// ========== 이미지 업로드/관리 기능 ==========

// 이미지 업로드 트리거 (파일 선택 다이얼로그 열기)
function triggerImageUpload(taskId, activityId) {
    const input = document.querySelector(`input.activity-image-input[data-task-id="${taskId}"][data-activity-id="${activityId}"]`);
    if (input) {
        input.click();
    }
}
window.triggerImageUpload = triggerImageUpload;

// 파일 선택 시 업로드 처리
document.addEventListener('change', async (e) => {
    if (e.target.classList.contains('activity-image-input')) {
        const taskId = e.target.getAttribute('data-task-id');
        const activityId = e.target.getAttribute('data-activity-id');
        const files = Array.from(e.target.files);
        
        if (files.length > 0) {
            await uploadActivityImages(taskId, activityId, files);
            e.target.value = ''; // 입력 초기화
        }
    }
});

// 드래그 앤 드롭 처리
function handleImageDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drag-over');
}
window.handleImageDragOver = handleImageDragOver;

function handleImageDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
}
window.handleImageDragLeave = handleImageDragLeave;

function handleImageDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
    
    const taskId = e.currentTarget.getAttribute('data-task-id');
    const activityId = e.currentTarget.getAttribute('data-activity-id');
    const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    
    if (files.length > 0) {
        uploadActivityImages(taskId, activityId, files);
    }
}
window.handleImageDrop = handleImageDrop;

// Activity 이미지 업로드 함수
async function uploadActivityImages(taskId, activityId, files) {
    if (!window.canEdit()) {
        showToast('수정 권한이 없습니다.', 'error');
        return;
    }
    
    if (!window.firebaseStorage) {
        showToast('Firebase Storage가 초기화되지 않았습니다. Firebase Console에서 Storage를 활성화해주세요.', 'error');
        console.error('Firebase Storage가 초기화되지 않음');
        return;
    }
    
    const wsId = window.currentWorkspaceId || currentWorkspaceId;
    if (!wsId) {
        showToast('워크스페이스 ID가 없습니다.', 'error');
        return;
    }
    
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
        showToast('태스크를 찾을 수 없습니다.', 'error');
        return;
    }
    
    const activity = task.activities.find(a => a.id === activityId);
    if (!activity) {
        showToast('Activity를 찾을 수 없습니다.', 'error');
        return;
    }
    
    // 이미지 배열 초기화 (없으면)
    if (!activity.images) {
        activity.images = [];
    }
    
    try {
        // Firebase Storage import
        const { ref, uploadBytesResumable, getDownloadURL } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js");
        
        const uploadPromises = files.map(async (file) => {
            // 파일 크기 체크 (10MB 제한)
            if (file.size > 10 * 1024 * 1024) {
                throw new Error(`파일 "${file.name}"이 너무 큽니다. (최대 10MB)`);
            }
            
            // 파일 타입 체크
            if (!file.type.startsWith('image/')) {
                throw new Error(`파일 "${file.name}"은 이미지 파일이 아닙니다.`);
            }
            
            // Storage 경로 생성
            const imageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
            const storagePath = `workspaces/${wsId}/tasks/${taskId}/activities/${activityId}/images/${imageId}_${file.name}`;
            const storageRef = ref(window.firebaseStorage, storagePath);
            
            // 업로드 진행률 표시를 위한 UI 업데이트
            const uploadArea = document.querySelector(`.activity-image-upload-area[data-activity-id="${activityId}"]`);
            if (uploadArea) {
                uploadArea.classList.add('uploading');
            }
            
            // 파일 업로드
            const uploadTask = uploadBytesResumable(storageRef, file);
            
            return new Promise((resolve, reject) => {
                uploadTask.on('state_changed',
                    (snapshot) => {
                        // 업로드 진행률 (선택사항)
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    },
                    (error) => {
                        reject(error);
                    },
                    async () => {
                        // 업로드 완료 후 다운로드 URL 가져오기
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
        
        // 모든 업로드 완료 대기
        const uploadedImages = await Promise.all(uploadPromises);
        
        // Activity에 이미지 추가
        activity.images.push(...uploadedImages);
        
        // Firestore에 저장
        if (window.saveTaskToFirestore) {
            await window.saveTaskToFirestore(task, wsId);
        }
        
        // UI 업데이트
        const uploadArea = document.querySelector(`.activity-image-upload-area[data-activity-id="${activityId}"]`);
        if (uploadArea) {
            uploadArea.classList.remove('uploading');
        }
        
        // 상세 모달 다시 렌더링
        if (currentTaskId === taskId) {
            openDetailModal(taskId);
        }
        
        showToast(`${uploadedImages.length}개의 사진이 업로드되었습니다.`, 'success');
        
    } catch (error) {
        console.error('이미지 업로드 오류:', error);
        let errorMessage = error.message || '알 수 없는 오류';
        
        // CORS 오류 또는 Storage 미활성화 오류 처리
        if (errorMessage.includes('CORS') || errorMessage.includes('preflight') || error.code === 'storage/unauthorized') {
            errorMessage = 'Firebase Storage가 활성화되지 않았거나 권한이 없습니다. Firebase Console에서 Storage를 활성화하고 규칙을 배포해주세요.';
        } else if (error.code === 'storage/object-not-found') {
            errorMessage = 'Storage 경로를 찾을 수 없습니다.';
        }
        
        showToast(`이미지 업로드 실패: ${errorMessage}`, 'error');
        
        const uploadArea = document.querySelector(`.activity-image-upload-area[data-activity-id="${activityId}"]`);
        if (uploadArea) {
            uploadArea.classList.remove('uploading');
        }
    }
}

// Activity 이미지 삭제 함수
async function deleteActivityImage(taskId, activityId, imageIndex) {
    if (!window.canEdit()) {
        showToast('수정 권한이 없습니다.', 'error');
        return;
    }
    
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
        showToast('태스크를 찾을 수 없습니다.', 'error');
        return;
    }
    
    const activity = task.activities.find(a => a.id === activityId);
    if (!activity || !activity.images || !activity.images[imageIndex]) {
        showToast('이미지를 찾을 수 없습니다.', 'error');
        return;
    }
    
    const imageToDelete = activity.images[imageIndex];
    
    if (!confirm('이 이미지를 삭제하시겠습니까?')) {
        return;
    }
    
    try {
        // Firebase Storage에서 파일 삭제
        if (imageToDelete.url && window.firebaseStorage) {
            const { ref, deleteObject } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js");
            
            // URL에서 Storage 경로 추출
            try {
                const urlObj = new URL(imageToDelete.url);
                const pathMatch = urlObj.pathname.match(/\/o\/(.+)\?/);
                if (pathMatch) {
                    const decodedPath = decodeURIComponent(pathMatch[1]);
                    const storageRef = ref(window.firebaseStorage, decodedPath);
                    await deleteObject(storageRef);
                }
            } catch (storageError) {
                console.warn('Storage에서 파일 삭제 실패 (이미 삭제되었을 수 있음):', storageError);
            }
        }
        
        // 배열에서 이미지 제거
        activity.images.splice(imageIndex, 1);
        
        // Firestore에 저장
        if (window.saveTaskToFirestore) {
            const wsId = window.currentWorkspaceId || currentWorkspaceId;
            await window.saveTaskToFirestore(task, wsId);
        }
        
        // UI 업데이트
        if (currentTaskId === taskId) {
            openDetailModal(taskId);
        }
        
        showToast('이미지가 삭제되었습니다.', 'success');
        
    } catch (error) {
        console.error('이미지 삭제 오류:', error);
        showToast(`이미지 삭제 실패: ${error.message}`, 'error');
    }
}
window.deleteActivityImage = deleteActivityImage;

// 이미지 라이트박스 열기
function openImageLightbox(imageUrl, index) {
    // 간단한 라이트박스 구현
    const lightbox = document.createElement('div');
    lightbox.className = 'image-lightbox';
    lightbox.innerHTML = `
        <div class="lightbox-overlay" onclick="closeImageLightbox()"></div>
        <div class="lightbox-content">
            <button class="lightbox-close" onclick="closeImageLightbox()">
                <i class="fas fa-times"></i>
            </button>
            <img src="${imageUrl}" alt="Image ${index + 1}">
        </div>
    `;
    document.body.appendChild(lightbox);
    document.body.style.overflow = 'hidden';
}
window.openImageLightbox = openImageLightbox;

// 이미지 라이트박스 닫기
function closeImageLightbox() {
    const lightbox = document.querySelector('.image-lightbox');
    if (lightbox) {
        lightbox.remove();
        document.body.style.overflow = '';
    }
}
window.closeImageLightbox = closeImageLightbox;
}


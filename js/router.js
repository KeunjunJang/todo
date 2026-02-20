// 라우터 모듈 - 페이지 간 네비게이션 관리
// 중복 로드 방지: 이미 선언되었으면 재선언하지 않음
if (typeof window.Router === 'undefined') {
    window.Router = class Router {
        constructor() {
        this.routes = {
            '/': 'pages/login.html',
            '/login': 'pages/login.html',
            '/hub': 'pages/hub.html',
            '/todo': 'pages/todo.html',
            '/todowithphoto': 'pages/todowithphoto.html',
            '/new_task_1': 'pages/new_task_1.html',
            '/new_task_2': 'pages/new_task_2.html',
            '/new_task_3': 'pages/new_task_3.html',
            '/new_task_4': 'pages/new_task_4.html',
            '/new_task_5': 'pages/new_task_5.html'
        };
        this.currentPage = null;
        this.init();
    }

    init() {
        // 인증 상태 확인은 auth.js에서 처리하므로 여기서는 제거
        // router.js의 onAuthStateChanged는 auth.js와 충돌을 일으킬 수 있음

        // 브라우저 뒤로/앞으로 버튼 처리
        window.addEventListener('popstate', (e) => {
            this.loadPage(window.location.pathname);
        });

        // 초기 페이지 로드
        this.loadPage(window.location.pathname);
    }

    navigate(path) {
        if (this.routes[path]) {
            window.history.pushState({}, '', path);
            this.loadPage(path);
        } else {
            console.error(`Route not found: ${path}`);
        }
    }

    async loadPage(path) {
        const route = this.routes[path] || this.routes['/'];
        
        try {
            const appContainer = document.getElementById('app-container');
            
            const response = await fetch(route);
            if (!response.ok) {
                throw new Error(`Failed to load page: ${route}`);
            }
            
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // 새 페이지 내용 준비
            let newContent = '';
            if (appContainer) {
                // navigation-placeholder는 제외하고 나머지 내용만 복사
                const contentToLoad = document.createElement('div');
                Array.from(doc.body.children).forEach(child => {
                    // navigation-placeholder는 제외하고 모든 내용 복사
                    if (!child.id || child.id !== 'navigation-placeholder') {
                        contentToLoad.appendChild(child.cloneNode(true));
                    }
                });
                newContent = contentToLoad.innerHTML;
            } else {
                newContent = doc.body.innerHTML;
            }
            
            // navigation-placeholder에 네비게이션을 로드 (app-container 내부의 placeholder)
            // Hub, Login 페이지가 아닐 때만 로드
            if (path !== '/hub' && path !== '/' && path !== '/login') {
                setTimeout(() => {
                    const placeholder = document.getElementById('navigation-placeholder');
                    if (placeholder && !placeholder.querySelector('.main-navigation')) {
                        try {
                            fetch('components/navigation.html')
                                .then(response => {
                                    if (!response.ok) {
                                        throw new Error(`HTTP error! status: ${response.status}`);
                                    }
                                    return response.text();
                                })
                                .then(html => {
                                    if (html) {
                                        const parser = new DOMParser();
                                        const navDoc = parser.parseFromString(html, 'text/html');
                                        const navElement = navDoc.body.querySelector('.main-navigation');
                                        // 다시 한 번 placeholder 확인 (비동기 처리 중에 DOM이 변경될 수 있음)
                                        const currentPlaceholder = document.getElementById('navigation-placeholder');
                                        if (navElement && currentPlaceholder) {
                                            currentPlaceholder.innerHTML = '';
                                            const navClone = navElement.cloneNode(true);
                                            
                                            // 스크립트 태그 추출
                                            const navScript = navClone.querySelector('script');
                                            let scriptContent = null;
                                            if (navScript) {
                                                scriptContent = navScript.textContent;
                                                navScript.remove();
                                            }
                                            
                                            // 네비게이션 DOM 추가
                                            currentPlaceholder.appendChild(navClone);
                                            
                                            // 스크립트 실행 후 초기화 함수 호출
                                            setTimeout(() => {
                                                // 스크립트 실행 (setupNavigation 함수 정의)
                                                if (scriptContent) {
                                                    try {
                                                        eval(scriptContent);
                                                    } catch (e) {
                                                        console.error('네비게이션 스크립트 실행 오류:', e);
                                                    }
                                                }
                                                
                                                // 네비게이션 초기화 함수 호출
                                                if (window.setupNavigation) {
                                                    window.setupNavigation();
                                                } else {
                                                    // setupNavigation이 없으면 직접 로그아웃 버튼 설정
                                                    const logoutBtn = document.getElementById('nav-logout-btn');
                                                    if (logoutBtn) {
                                                        const newLogoutBtn = logoutBtn.cloneNode(true);
                                                        logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
                                                        newLogoutBtn.onclick = async function(e) {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            if (window.handleLogout) {
                                                                await window.handleLogout();
                                                            }
                                                        };
                                                    }
                                                }
                                            }, 50);
                                        }
                                    }
                                })
                                .catch(error => {
                                    console.error('[Router] 네비게이션 로드 실패:', error);
                                });
                        } catch (error) {
                            console.error('[Router] 네비게이션 로드 실패:', error);
                        }
                    }
                }, 100);
            } else {
                // Hub Page에서는 네비게이션 제거
                setTimeout(() => {
                    const placeholder = document.getElementById('navigation-placeholder');
                    if (placeholder) {
                        placeholder.innerHTML = '';
                        placeholder.style.display = 'none';
                    }
                    // 전역 네비게이션도 제거
                    const globalNav = document.querySelector('.main-navigation:not(#navigation-placeholder .main-navigation)');
                    if (globalNav) {
                        globalNav.remove();
                    }
                }, 100);
            }
            
            // head와 body의 스크립트와 스타일 추가
            const headScripts = Array.from(doc.head.querySelectorAll('script'));
            const bodyScripts = Array.from(doc.body.querySelectorAll('script'));
            const allScripts = [...headScripts, ...bodyScripts];
            
            // 스크립트 로드 순서 보장을 위해 Promise 배열 생성
            const scriptPromises = [];
            
            allScripts.forEach((script, index) => {
                // 이미 로드된 스크립트는 건너뛰기
                const scriptSrc = script.src;
                
                // common.js, router.js, auth.js, todo.js는 index.html에서 이미 로드되었으므로 건너뛰기
                if (scriptSrc && (scriptSrc.includes('common.js') || scriptSrc.includes('router.js') || scriptSrc.includes('auth.js') || scriptSrc.includes('todo.js') || scriptSrc.includes('gallery.js') || scriptSrc.includes('new_task_1.js'))) {
                    return;
                }
                
                const existingScript = scriptSrc ? Array.from(document.querySelectorAll('script')).find(
                    s => s.src === scriptSrc
                ) : null;
                
                if (!existingScript) {
                    const newScript = document.createElement('script');
                    if (script.src) {
                        newScript.src = script.src;
                        // 스크립트 로드 완료 대기
                        const scriptPromise = new Promise((resolve, reject) => {
                            newScript.onload = () => {
                                resolve();
                            };
                            newScript.onerror = () => {
                                console.error('[Router] Script load error:', script.src);
                                reject(new Error(`Failed to load script: ${script.src}`));
                            };
                        });
                        scriptPromises.push(scriptPromise);
                    } else {
                        // 인라인 스크립트는 try-catch로 감싸서 실행 (에러 방지)
                        const scriptContent = script.textContent;
                        if (scriptContent && scriptContent.trim()) {
                            // 스크립트를 try-catch로 감싸서 실행
                            newScript.textContent = `
                                try {
                                    ${scriptContent}
                                } catch (e) {
                                    // 인라인 스크립트 실행 중 에러 발생 (조용하게 무시)
                                }
                            `;
                        }
                    }
                    if (script.type) {
                        newScript.type = script.type;
                    }
                    // body 스크립트는 body에, head 스크립트는 head에 추가
                    if (bodyScripts.includes(script)) {
                        document.body.appendChild(newScript);
                    } else {
                        document.head.appendChild(newScript);
                    }
                } else {
                    // todo.js가 이미 로드되어 있으면 이벤트 리스너가 등록되었는지 확인하고 없으면 등록
                    if (script.src && script.src.includes('todo.js')) {
                        // 약간의 지연 후 이벤트 리스너가 등록되었는지 확인
                        setTimeout(() => {
                            if (!window._todoEventListenersRegistered) {
                                // tasksLoaded 이벤트를 발생시켜서 렌더링 유도
                                if (window.tasks && Array.isArray(window.tasks) && window.tasks.length > 0) {
                                    window.dispatchEvent(new CustomEvent('tasksLoaded', { detail: { tasks: window.tasks } }));
                                }
                            }
                        }, 100);
                    }
                }
            });
            
            // 모든 스크립트가 로드될 때까지 대기
            if (scriptPromises.length > 0) {
                await Promise.all(scriptPromises);
            }

            // 스타일 로드 완료 대기
            const styles = doc.head.querySelectorAll('link[rel="stylesheet"]');
            const stylePromises = [];
            styles.forEach(style => {
                if (!document.head.querySelector(`link[href="${style.href}"]`)) {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = style.href;
                    const stylePromise = new Promise((resolve) => {
                        if (link.sheet) {
                            resolve();
                        } else {
                            link.onload = () => resolve();
                            link.onerror = () => resolve();
                            setTimeout(() => resolve(), 100);
                        }
                    });
                    stylePromises.push(stylePromise);
                    document.head.appendChild(link);
                }
            });

            // 페이지 전환 시 이전 페이지 전용 스타일 제거
            const oldPageStyle = document.getElementById('todo-page-styles');
            if (oldPageStyle) oldPageStyle.remove();

            // 인라인 <style> 태그 주입 (todo.html 등 페이지 전용 스타일)
            const inlineStyles = doc.head.querySelectorAll('style');
            inlineStyles.forEach(styleEl => {
                if (styleEl.textContent.trim()) {
                    const newStyle = document.createElement('style');
                    newStyle.id = 'todo-page-styles';
                    newStyle.textContent = styleEl.textContent;
                    document.head.appendChild(newStyle);
                }
            });
            
            // 모든 스타일 로드 완료 대기
            if (stylePromises.length > 0) {
                await Promise.all(stylePromises);
            }
            
            // 추가 초기화 대기 (렌더링 완료 보장)
            await new Promise(resolve => setTimeout(resolve, 50));

            this.currentPage = path;
            
            // 모든 준비가 완료된 후 화면 전환 (한 번에 교체)
            if (appContainer) {
                appContainer.innerHTML = newContent;
            } else {
                document.body.innerHTML = doc.body.innerHTML;
            }

            // 이전 페이지의 모달 백드롭 및 튜토리얼 오버레이 제거
            document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
            document.body.classList.remove('modal-open');
            document.body.style.removeProperty('overflow');
            document.body.style.removeProperty('padding-right');
            const tutorialOverlay = document.getElementById('todo-tutorial-overlay');
            const tutorialHighlight = document.getElementById('todo-tutorial-highlight');
            if (tutorialOverlay) tutorialOverlay.style.display = 'none';
            if (tutorialHighlight) tutorialHighlight.style.display = 'none';
            
            // DOM 렌더링 완료 대기 후 이벤트 발생
            await new Promise(resolve => setTimeout(resolve, 50));
            
            window.dispatchEvent(new CustomEvent('pageLoaded', { detail: { path } }));
            
            // 네비게이션 컴포넌트의 로그아웃 버튼 이벤트 재설정
            setTimeout(() => {
                const logoutBtn = document.getElementById('nav-logout-btn');
                if (logoutBtn && window.attachLoginButtons) {
                    window.attachLoginButtons();
                }
            }, 100);
            
            // todo.js가 이미 로드되어 있으면 수동으로 초기화 시도
            if (path === '/todo') {
                setTimeout(() => {
                    // initializeTodoPage 함수가 있으면 호출
                    if (typeof window.initializeTodoPage === 'function') {
                        window.initializeTodoPage();
                    } else {
                        // tasksLoaded 이벤트를 발생시켜서 렌더링 유도
                        if (window.tasks && Array.isArray(window.tasks) && window.tasks.length > 0) {
                            window.dispatchEvent(new CustomEvent('tasksLoaded', { detail: { tasks: window.tasks } }));
                        }
                        
                        // renderTasks가 있으면 직접 호출
                        const tasksContainer = document.getElementById('tasks-container');
                        if (tasksContainer && typeof window.renderTasks === 'function') {
                            window.renderTasks();
                        }
                    }
                    
                    // tasksLoaded 이벤트를 다시 발생시켜서 렌더링 유도
                    if (window.tasks && Array.isArray(window.tasks) && window.tasks.length > 0) {
                        window.dispatchEvent(new CustomEvent('tasksLoaded', { detail: { tasks: window.tasks } }));
                    }
                    
                    // renderTasks 함수가 있으면 직접 호출
                    if (typeof window.renderTasks === 'function' && document.getElementById('tasks-container')) {
                        window.renderTasks();
                    }
                }, 200);
            }
            
            // Gallery 페이지 초기화
            if (path === '/todowithphoto') {
                setTimeout(() => {
                    if (typeof window.initializeGalleryPage === 'function') {
                        window.initializeGalleryPage();
                    }
                    // tasksLoaded 이벤트로 갤러리 렌더링 유도
                    if (window.tasks && Array.isArray(window.tasks) && window.tasks.length > 0) {
                        window.dispatchEvent(new CustomEvent('tasksLoaded', { detail: { tasks: window.tasks } }));
                    }
                }, 200);
            }
            
            // 2D/3D Plot 페이지 초기화
            if (path === '/new_task_1') {
                setTimeout(() => {
                    if (typeof window.initializeInteriorPage === 'function') {
                        window.initializeInteriorPage();
                    }
                }, 200);
            }
        } catch (error) {
            console.error('Error loading page:', error);
            if (typeof showToast === 'function') {
                showToast('페이지를 불러오는데 실패했습니다.', 'error');
            } else {
                alert('페이지를 불러오는데 실패했습니다.');
            }
        }
    } // loadPage 메서드 닫기
    }; // class Router 닫기
} // if 블록 닫기

// 전역 라우터 인스턴스 (중복 생성 방지)
if (!window.router) {
    window.router = new window.Router();
}

// 네비게이션 헬퍼 함수
window.navigateTo = (path) => {
    window.router.navigate(path);
};


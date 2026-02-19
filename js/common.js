// 공통 유틸리티 함수들
// 중복 로드 방지: 이미 선언되었으면 재선언하지 않음
if (typeof window._commonJsLoaded === 'undefined') {
    window._commonJsLoaded = true;
    
    const DEBUG = false;
    const debugLog = (...args) => DEBUG && console.log(...args);
    const debugError = (...args) => DEBUG && console.error(...args);
    const debugWarn = (...args) => DEBUG && console.warn(...args);

    // window 함수 호출 헬퍼
    const callWindowFn = (name, ...args) => {
        if (typeof window[name] === 'function') {
            return window[name](...args);
        }
        return undefined;
    };

    // 토스트 메시지 표시
    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) {
            // 토스트 컨테이너가 없으면 생성
            const newContainer = document.createElement('div');
            newContainer.id = 'toast-container';
            newContainer.className = 'toast-container';
            document.body.appendChild(newContainer);
            return showToast(message, type);
        }
        
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

    // 날짜 포맷
    function formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${year}.${month.toString().padStart(2, '0')}.${day.toString().padStart(2, '0')}`;
    }

    // 전역에 노출
    window.debugLog = debugLog;
    window.debugError = debugError;
    window.debugWarn = debugWarn;
    window.callWindowFn = callWindowFn;
    window.showToast = showToast;
    window.formatDate = formatDate;
}

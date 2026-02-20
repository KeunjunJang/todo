// Firebase 인증 및 Firestore 모듈
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
    getAuth, onAuthStateChanged,
    GoogleAuthProvider, signInWithPopup,
    createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
    getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
    serverTimestamp, query, orderBy, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
    getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDL4YrhwjcCjXLvQMkTON5t4efayCgXMYo",
    authDomain: "todo-95b42.firebaseapp.com",
    projectId: "todo-95b42",
    storageBucket: "todo-95b42.firebasestorage.app",
    messagingSenderId: "832070829003",
    appId: "1:832070829003:web:3cfa65538f34bc038aec4e",
    measurementId: "G-K7CXD4X33G"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// 프로젝트 ID 목록
const PROJECT_IDS = ["ws_p1", "ws_p2", "ws_p3"];

// 현재 워크스페이스 ID (로그인 후 멤버십 확인으로 설정됨)
let currentWorkspaceId = null;

// auth를 window에 노출하여 로그인 상태 확인 가능하도록
window.firebaseAuth = auth;
window.firebaseDb = db;
window.firebaseStorage = storage;

// 로그인 상태 확인 헬퍼 함수
function isUserLoggedIn() {
    return window.firebaseAuth && window.firebaseAuth.currentUser !== null;
}

// 쓰기 전 권한 검증 헬퍼 함수
async function validateWritePermission(wsId) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('로그인이 필요합니다.');
    }
    if (!wsId || wsId.trim() === '') {
        throw new Error('워크스페이스 ID가 없습니다.');
    }

    const memberRef = doc(db, "workspaces", wsId, "members", user.uid);
    let memberSnap;
    try {
        memberSnap = await getDoc(memberRef);
    } catch (error) {
        window.debugError(`[validateWritePermission] member doc 읽기 실패:`, {
            uid: user.uid,
            wsId: wsId,
            memberRefPath: `workspaces/${wsId}/members/${user.uid}`,
            error: error.message
        });
        throw new Error(`멤버 문서 읽기 실패: ${error.message}`);
    }

    // 멤버 문서가 없으면 생성 시도
    if (!memberSnap.exists()) {
        window.debugWarn(`[validateWritePermission] 멤버 문서 없음, 자동 생성 시도:`, {
            uid: user.uid,
            wsId: wsId,
            memberRefPath: `workspaces/${wsId}/members/${user.uid}`
        });
        try {
            await ensureWorkspaceAndMembership(user, wsId);
            // 재확인
            memberSnap = await getDoc(memberRef);
            if (!memberSnap.exists()) {
                throw new Error('멤버 문서 생성 후에도 존재하지 않습니다.');
            }
        } catch (error) {
            window.debugError(`[validateWritePermission] 멤버 문서 생성 실패:`, error);
            throw new Error(`멤버 문서 생성 실패: ${error.message}`);
        }
    }

    const memberData = memberSnap.data();
    const roleRaw = memberData.role || 'viewer';
    const roleNormalized = String(roleRaw).toLowerCase();

    window.debugLog(`[validateWritePermission] 검증 성공:`, {
        uid: user.uid,
        wsId: wsId,
        memberRefPath: `workspaces/${wsId}/members/${user.uid}`,
        memberExists: memberSnap.exists(),
        roleRaw: roleRaw,
        roleNormalized: roleNormalized,
        canWrite: ['owner', 'admin', 'planner'].includes(roleNormalized)
    });

    if (!['owner', 'admin', 'planner'].includes(roleNormalized)) {
        throw new Error(`쓰기 권한이 없습니다. 현재 역할: ${roleNormalized}`);
    }

    return { user, wsId, memberData, roleNormalized };
}

// Firestore에 태스크 저장
async function saveTaskToFirestore(task, wsId = null) {
    if (window.canEdit && !window.canEdit()) {
        window.debugLog("Viewer 권한으로 저장 불가");
        return;
    }
    if (!isUserLoggedIn()) {
        window.debugLog("로그인하지 않아 로컬에만 저장됩니다.");
        return;
    }

    const targetWsId = wsId || currentWorkspaceId || window.currentWorkspaceId;
    if (!targetWsId) {
        window.debugError("[saveTaskToFirestore] wsId 없음");
        throw new Error('워크스페이스 ID가 없습니다.');
    }

    try {
        await validateWritePermission(targetWsId);

        const taskRef = doc(db, "workspaces", targetWsId, "tasks", task.id);
        const taskData = { ...task };
        delete taskData.assignee;

        window.debugLog(`[saveTaskToFirestore] 쓰기 시도:`, {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            taskId: task.id,
            taskRefPath: `workspaces/${targetWsId}/tasks/${task.id}`
        });

        await setDoc(taskRef, taskData, { merge: true });
        window.debugLog(`[saveTaskToFirestore] 저장 성공:`, { taskId: task.id });
    } catch (error) {
        window.debugError("[saveTaskToFirestore] 저장 오류:", {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            taskId: task.id,
            error: error.message,
            errorCode: error.code
        });
        throw error;
    }
}

// Firestore에서 태스크 삭제
async function deleteTaskFromFirestore(taskId, wsId = null) {
    if (window.canEdit && !window.canEdit()) {
        window.debugLog("Viewer 권한으로 삭제 불가");
        return;
    }
    if (!isUserLoggedIn()) {
        window.debugLog("로그인하지 않아 로컬에서만 삭제됩니다.");
        return;
    }

    const targetWsId = wsId || currentWorkspaceId || window.currentWorkspaceId;
    if (!targetWsId) {
        window.debugError("[deleteTaskFromFirestore] wsId 없음");
        throw new Error('워크스페이스 ID가 없습니다.');
    }

    try {
        await validateWritePermission(targetWsId);

        const taskRef = doc(db, "workspaces", targetWsId, "tasks", taskId);
        window.debugLog(`[deleteTaskFromFirestore] 삭제 시도:`, {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            taskId: taskId,
            taskRefPath: `workspaces/${targetWsId}/tasks/${taskId}`
        });

        await deleteDoc(taskRef);
        window.debugLog(`[deleteTaskFromFirestore] 삭제 성공:`, { taskId: taskId });
    } catch (error) {
        window.debugError("[deleteTaskFromFirestore] 삭제 오류:", {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            taskId: taskId,
            error: error.message,
            errorCode: error.code
        });
        throw error;
    }
}

// 모든 태스크를 Firestore에 일괄 저장
async function saveAllTasksToFirestore(wsId = null) {
    if (window.canEdit && !window.canEdit()) {
        window.debugLog("Viewer 권한으로 저장 불가");
        return;
    }
    if (!isUserLoggedIn()) {
        window.debugLog("로그인하지 않아 로컬에만 저장됩니다.");
        return;
    }

    const targetWsId = wsId || currentWorkspaceId || window.currentWorkspaceId;
    if (!targetWsId) {
        window.debugError("[saveAllTasksToFirestore] wsId 없음");
        throw new Error('워크스페이스 ID가 없습니다.');
    }

    try {
        await validateWritePermission(targetWsId);

        if (!window.tasks || window.tasks.length === 0) return;

        window.debugLog(`[saveAllTasksToFirestore] 일괄 저장 시작:`, {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            tasksCount: window.tasks.length
        });

        const savePromises = window.tasks.map(task => {
            const taskRef = doc(db, "workspaces", targetWsId, "tasks", task.id);
            const taskData = { ...task };
            delete taskData.assignee;
            return setDoc(taskRef, taskData, { merge: true });
        });

        await Promise.all(savePromises);
        window.debugLog(`[saveAllTasksToFirestore] 일괄 저장 성공:`, { tasksCount: window.tasks.length });
    } catch (error) {
        window.debugError("[saveAllTasksToFirestore] 일괄 저장 오류:", {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            error: error.message,
            errorCode: error.code
        });
        throw error;
    }
}

// Firestore에서 워크스페이스 데이터 로드
async function loadWorkspace(workspaceId) {
    try {
        const tasksRef = collection(db, "workspaces", workspaceId, "tasks");
        const tasksQuery = query(tasksRef, orderBy("priority", "asc"));
        const tasksSnap = await getDocs(tasksQuery);

        const loadedTasks = [];
        tasksSnap.forEach((docSnap) => {
            loadedTasks.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });

        // window.tasks가 없으면 생성
        if (window.tasks === undefined) {
            window.tasks = [];
        }

        // tasks 배열을 완전히 교체
        window.tasks.splice(0, window.tasks.length, ...loadedTasks);

        // 기존 함수들 호출 (DOM 요소가 있을 때만)
        window.callWindowFn('initializePriorities');
        window.callWindowFn('sortTasksByPriority');
        window.callWindowFn('updateOverdueStatus');
        // renderTasks, updateFilterCounts, updateViewCounts는 tasks-container가 있을 때만 호출
        if (document.getElementById('tasks-container')) {
            window.callWindowFn('renderTasks');
            window.callWindowFn('updateFilterCounts');
            window.callWindowFn('updateViewCounts');
        }
        
        // 항상 tasksLoaded 이벤트 발생 (TODO 페이지가 나중에 로드될 수 있음)
        window.dispatchEvent(new CustomEvent('tasksLoaded', { detail: { tasks: window.tasks } }));
    } catch (error) {
        window.debugError("워크스페이스 로드 오류:", error);
        if (window.tasks !== undefined) {
            window.tasks.length = 0;
            if (document.getElementById('tasks-container')) {
                window.callWindowFn('renderTasks');
            }
        }
    }
}

// 사용자 role 로드 함수
async function loadMyRole(user, wsId = null) {
    const targetWsId = wsId || currentWorkspaceId || window.currentWorkspaceId;
    if (!targetWsId) {
        window.debugWarn("[loadMyRole] wsId 없음");
        window.currentUserRole = "VIEWER";
        window.callWindowFn('applyRoleToUI', "VIEWER");
        return;
    }

    try {
        const memberRef = doc(db, "workspaces", targetWsId, "members", user.uid);
        window.debugLog(`[loadMyRole] 멤버 문서 읽기 시도:`, {
            uid: user.uid,
            wsId: targetWsId,
            memberRefPath: `workspaces/${targetWsId}/members/${user.uid}`
        });
        const snap = await getDoc(memberRef);
        const roleRaw = snap.exists() ? (snap.data().role || "viewer") : "viewer";
        const roleNormalized = String(roleRaw).toLowerCase();
        const roleForUI = roleNormalized.toUpperCase();
        window.currentUserRole = roleForUI;
        window.callWindowFn('applyRoleToUI', roleForUI);
        window.debugLog("[loadMyRole] Role 로드 성공:", {
            uid: user.uid,
            wsId: targetWsId,
            roleRaw: roleRaw,
            roleNormalized: roleNormalized,
            roleForUI: roleForUI,
            memberExists: snap.exists()
        });
    } catch (e) {
        window.debugWarn("[loadMyRole] Role 로드 실패 -> fallback VIEWER:", {
            uid: user.uid,
            wsId: targetWsId,
            error: e.message,
            errorCode: e.code
        });
        window.currentUserRole = "VIEWER";
        window.callWindowFn('applyRoleToUI', "VIEWER");
    }
}

// 멤버십 확인 및 워크스페이스 선택 함수
async function findUserWorkspace(user) {
    console.log(`[findUserWorkspace] 시작:`, {
        uid: user.uid,
        email: user.email,
        projectIds: PROJECT_IDS
    });
    
    for (const wsId of PROJECT_IDS) {
        try {
            const memberRef = doc(db, "workspaces", wsId, "members", user.uid);
            console.log(`[findUserWorkspace] 멤버 문서 확인 시도:`, {
                wsId: wsId,
                uid: user.uid,
                memberRefPath: `workspaces/${wsId}/members/${user.uid}`
            });
            
            const memberSnap = await getDoc(memberRef);
            
            console.log(`[findUserWorkspace] 멤버 문서 확인 결과:`, {
                wsId: wsId,
                exists: memberSnap.exists(),
                data: memberSnap.exists() ? memberSnap.data() : null
            });

            if (memberSnap.exists()) {
                console.log(`[findUserWorkspace] 워크스페이스 찾음:`, wsId);
                return wsId;
            }
        } catch (error) {
            console.error(`[findUserWorkspace] 오류 발생:`, {
                wsId: wsId,
                uid: user.uid,
                errorCode: error.code,
                errorMessage: error.message,
                errorStack: error.stack
            });
            
            if (error.code === 'permission-denied') {
                console.log(`[findUserWorkspace] ${wsId}에서 권한 거부됨`);
            } else {
                console.error(`[findUserWorkspace] ${wsId} 확인 중 오류:`, error);
            }
        }
    }
    
    console.warn(`[findUserWorkspace] 워크스페이스를 찾지 못함`);
    return null;
}

// 워크스페이스와 멤버십 자동 생성 함수
async function ensureWorkspaceAndMembership(user, wsId = null) {
    const targetWsId = wsId || currentWorkspaceId || window.currentWorkspaceId;
    if (!targetWsId) {
        throw new Error('워크스페이스 ID가 필요합니다.');
    }

    const memberRef = doc(db, "workspaces", targetWsId, "members", user.uid);
    const wsRef = doc(db, "workspaces", targetWsId);

    const [memberSnap, wsSnap] = await Promise.all([
        getDoc(memberRef),
        getDoc(wsRef),
    ]);

    if (!memberSnap.exists()) {
        const initialRole = wsSnap.exists() ? "viewer" : "owner";

        window.debugLog(`[ensureWorkspaceAndMembership] 멤버 문서 생성:`, {
            uid: user.uid,
            wsId: targetWsId,
            initialRole: initialRole.toLowerCase(),
            memberRefPath: `workspaces/${targetWsId}/members/${user.uid}`
        });

        await setDoc(memberRef, {
            email: user.email || "",
            role: initialRole.toLowerCase(),
            joinedAt: serverTimestamp()
        });

        if (!wsSnap.exists()) {
            await setDoc(wsRef, {
                name: "Demo",
                ownerUid: user.uid,
                createdAt: serverTimestamp()
            });
        }
    }
}

// Firestore 워크스페이스 동기화 함수
async function syncWorkspaceToFirestore(wsId = null) {
    if (window.canEdit && !window.canEdit()) {
        window.callWindowFn('showToast', '읽기 전용 권한입니다.', 'error');
        return;
    }
    if (!isUserLoggedIn()) {
        window.callWindowFn('showToast', '로그인이 필요합니다.', 'error');
        return;
    }

    const targetWsId = wsId || currentWorkspaceId || window.currentWorkspaceId;
    if (!targetWsId) {
        const errorMsg = '워크스페이스 ID가 없습니다.';
        window.debugError("[syncWorkspaceToFirestore] wsId 없음");
        window.callWindowFn('showToast', errorMsg, 'error');
        throw new Error(errorMsg);
    }

    try {
        await validateWritePermission(targetWsId);

        const tasksRef = collection(db, "workspaces", targetWsId, "tasks");

        window.debugLog(`[syncWorkspaceToFirestore] 동기화 시작:`, {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            tasksRefPath: `workspaces/${targetWsId}/tasks`
        });

        const tasksSnap = await getDocs(tasksRef);
        const remoteIds = new Set();
        tasksSnap.forEach((docSnap) => {
            remoteIds.add(docSnap.id);
        });

        const localTasks = window.tasks || [];
        const localIds = new Set(localTasks.map(t => t.id));

        const idsToDelete = Array.from(remoteIds).filter(id => !localIds.has(id));

        const BATCH_SIZE = 450;
        const allOperations = [];

        idsToDelete.forEach(id => {
            allOperations.push({ type: 'delete', id });
        });

        const existingDocs = new Map();
        const idsToUpsert = Array.from(localIds);

        if (idsToUpsert.length > 0) {
            const readPromises = idsToUpsert.map(async (id) => {
                const taskRef = doc(db, "workspaces", targetWsId, "tasks", id);
                const taskSnap = await getDoc(taskRef);
                if (taskSnap.exists()) {
                    existingDocs.set(id, taskSnap.data());
                }
            });
            await Promise.all(readPromises);
        }

        localTasks.forEach(task => {
            const taskData = { ...task };
            delete taskData.assignee;

            if (existingDocs.has(task.id)) {
                const existingData = existingDocs.get(task.id);
                Object.assign(existingData, taskData);
                allOperations.push({ type: 'set', id: task.id, data: existingData });
            } else {
                allOperations.push({ type: 'set', id: task.id, data: taskData });
            }
        });

        for (let i = 0; i < allOperations.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            const batchOps = allOperations.slice(i, i + BATCH_SIZE);

            batchOps.forEach(op => {
                const taskRef = doc(db, "workspaces", targetWsId, "tasks", op.id);
                if (op.type === 'delete') {
                    batch.delete(taskRef);
                } else {
                    batch.set(taskRef, op.data);
                }
            });

            await batch.commit();
        }

        window.debugLog(`[syncWorkspaceToFirestore] 동기화 성공:`, {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            deletedCount: idsToDelete.length,
            upsertedCount: idsToUpsert.length
        });

        window.callWindowFn('showToast', 'Firebase에 저장 완료', 'success');
    } catch (error) {
        window.debugError("[syncWorkspaceToFirestore] 동기화 오류:", {
            uid: auth.currentUser?.uid,
            wsId: targetWsId,
            error: error.message,
            errorCode: error.code
        });
        window.callWindowFn('showToast', `저장 실패: ${error.message}`, 'error');
        throw error;
    }
}

// 에러 메시지 표시
function showLoginError(message) {
    const errorEl = document.getElementById('login-error');
    if (errorEl) {
        errorEl.textContent = message;
        setTimeout(() => {
            errorEl.textContent = '';
        }, 5000);
    }
}

// 로그인 함수들
async function handleGoogleLogin() {
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (error) {
        window.debugError('Google 로그인 오류:', error);
        showLoginError('Google 로그인에 실패했습니다.');
    }
}

async function handleSignup() {
    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;

    if (!email || !password) {
        showLoginError('이메일과 비밀번호를 입력해주세요.');
        return;
    }

    try {
        await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
        window.debugError('회원가입 오류:', error);
        let errorMessage = '회원가입에 실패했습니다.';
        if (error.code === 'auth/email-already-in-use') {
            errorMessage = '이미 사용 중인 이메일입니다.';
        } else if (error.code === 'auth/weak-password') {
            errorMessage = '비밀번호는 6자 이상이어야 합니다.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = '유효하지 않은 이메일입니다.';
        }
        showLoginError(errorMessage);
    }
}

async function handleLogin() {
    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;

    if (!email || !password) {
        showLoginError('이메일과 비밀번호를 입력해주세요.');
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        window.debugError('로그인 오류:', error);
        let errorMessage = '로그인에 실패했습니다.';
        if (error.code === 'auth/user-not-found') {
            errorMessage = '등록되지 않은 이메일입니다.';
        } else if (error.code === 'auth/wrong-password') {
            errorMessage = '비밀번호가 올바르지 않습니다.';
        } else if (error.code === 'auth/invalid-email') {
            errorMessage = '유효하지 않은 이메일입니다.';
        }
        showLoginError(errorMessage);
    }
}

async function handleLogout() {
    try {
        await signOut(auth);
        
        // 세션 스토리지 초기화
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('todo_app_is_refreshing');
        }
        
        // 로그인 페이지로 이동
        if (window.router) {
            window.router.navigate('/login');
        } else if (window.navigateTo) {
            window.navigateTo('/login');
        } else {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('로그아웃 오류:', error);
        window.debugError('로그아웃 오류:', error);
        if (window.showToast) {
            window.showToast('로그아웃에 실패했습니다.', 'error');
        }
    }
}

// window에 노출
window.handleLogout = handleLogout;

// 인증 상태 변경 리스너
// 새로고침 감지: beforeunload 이벤트와 sessionStorage를 사용하여 정확한 새로고침 감지
let isInitialLoad = true;
const REFRESH_KEY = 'todo_app_is_refreshing';

// 새로고침 감지: beforeunload 이벤트로 새로고침 플래그 설정
window.addEventListener('beforeunload', () => {
    if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(REFRESH_KEY, 'true');
    }
});

// performance API를 사용하여 새로고침 감지
function isPageRefresh() {
    // sessionStorage에서 새로고침 플래그 확인
    if (typeof sessionStorage !== 'undefined') {
        const isRefreshing = sessionStorage.getItem(REFRESH_KEY);
        if (isRefreshing === 'true') {
            // 플래그 제거
            sessionStorage.removeItem(REFRESH_KEY);
            return true;
        }
    }
    
    // performance API로도 확인 (보조 방법)
    if (typeof performance !== 'undefined' && performance.getEntriesByType) {
        const navEntries = performance.getEntriesByType('navigation');
        if (navEntries.length > 0) {
            const navType = navEntries[0].type;
            if (navType === 'reload') {
                return true;
            }
        }
    }
    
    return false;
}

isInitialLoad = isPageRefresh();

// 로그인 처리 완료 플래그 (중복 처리 방지)
let isLoginProcessing = false;

onAuthStateChanged(auth, async (user) => {
    const currentPath = window.location.pathname;

    // 새로고침 시에는 항상 로그인 화면을 보여주고 세션을 무시
    if (isInitialLoad && user) {
        isInitialLoad = false;
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem(REFRESH_KEY);
        }
        await signOut(auth);
        if (window.router) {
            window.router.navigate('/login');
        } else if (window.navigateTo) {
            window.navigateTo('/login');
        } else {
            window.location.href = '/login';
        }
        return;
    }

    isInitialLoad = false;

    if (user) {
        // 이미 로그인 처리가 완료되었고, 워크스페이스가 설정되어 있으면 리다이렉트하지 않음
        if (currentWorkspaceId && window.currentWorkspaceId === currentWorkspaceId) {
            return;
        }
        
        // 보호된 페이지에 있을 때 워크스페이스가 이미 설정되어 있으면 아무것도 하지 않음
        if (currentPath !== '/' && currentPath !== '/login') {
            if (currentWorkspaceId || window.currentWorkspaceId) {
                return;
            }
        }

        // 중복 처리 방지
        if (isLoginProcessing) {
            return;
        }

        isLoginProcessing = true;
        console.log("[AUTH] Signed in:", user.email, user.uid);

        try {
            const selectedWorkspaceId = await findUserWorkspace(user);

            if (!selectedWorkspaceId) {
                alert("어느 프로젝트에도 멤버로 등록되어있지 않습니다.");
                await signOut(auth);
                isLoginProcessing = false;
                return;
            }

            currentWorkspaceId = selectedWorkspaceId;
            window.currentWorkspaceId = currentWorkspaceId;

            await loadWorkspace(currentWorkspaceId);
            await loadMyRole(user, currentWorkspaceId);

            // 현재 경로가 로그인 페이지일 때만 Hub로 이동
            const finalPath = window.location.pathname;
            if (finalPath === '/' || finalPath === '/login') {
                if (window.router) {
                    window.router.navigate('/hub');
                } else if (window.navigateTo) {
                    window.navigateTo('/hub');
                }
            }
            // 이미 다른 페이지에 있으면 그대로 유지
        } catch (error) {
            console.error("워크스페이스 선택 중 오류:", error);
            await signOut(auth);
            alert("워크스페이스 확인 중 오류가 발생했습니다.");
        } finally {
            isLoginProcessing = false;
        }
    } else {
        // user가 null인 경우
        // 워크스페이스가 설정되어 있으면 일시적인 상태 변경으로 간주 (로그아웃이 아님)
        const hasWorkspace = currentWorkspaceId !== null || window.currentWorkspaceId !== null;
        
        if (hasWorkspace) {
            return; // 일시적인 상태 변경이므로 무시
        }
        
        // 실제 로그아웃인 경우에만 처리
        isLoginProcessing = false;
        currentWorkspaceId = null;
        window.currentWorkspaceId = null;

        if (window.tasks !== undefined) {
            window.tasks.length = 0;
            window.callWindowFn('renderTasks');
            window.callWindowFn('updateFilterCounts');
            window.callWindowFn('updateViewCounts');
        }

        // 로그인 페이지로 이동 (현재 경로가 로그인 페이지가 아닐 때만)
        const logoutPath = window.location.pathname;
        if (logoutPath !== '/' && logoutPath !== '/login') {
            if (window.router) {
                window.router.navigate('/login');
            } else if (window.navigateTo) {
                window.navigateTo('/login');
            }
        }
    }
});

// window에 노출
window.saveTaskToFirestore = saveTaskToFirestore;
window.deleteTaskFromFirestore = deleteTaskFromFirestore;
window.saveAllTasksToFirestore = saveAllTasksToFirestore;
window.syncWorkspaceToFirestore = syncWorkspaceToFirestore;
window.loadWorkspace = loadWorkspace;
window.findUserWorkspace = findUserWorkspace;
window.ensureWorkspaceAndMembership = ensureWorkspaceAndMembership;
window.loadMyRole = loadMyRole;
window.handleGoogleLogin = handleGoogleLogin;
window.handleSignup = handleSignup;
window.handleLogin = handleLogin;
window.handleLogout = handleLogout;
window.isUserLoggedIn = isUserLoggedIn;

// 로그인 버튼 이벤트 연결 함수
function attachLoginButtons() {
    const googleBtn = document.getElementById('login-btn-google');
    const signupBtn = document.getElementById('login-btn-signup');
    const loginBtn = document.getElementById('login-btn-login');
    // nav-logout-btn은 네비게이션 컴포넌트에서 처리하므로 header-logout-btn만 처리
    const logoutBtn = document.getElementById('header-logout-btn');

    if (googleBtn && !googleBtn.onclick) {
        googleBtn.onclick = handleGoogleLogin;
    }
    if (signupBtn && !signupBtn.onclick) {
        signupBtn.onclick = handleSignup;
    }
    if (loginBtn && !loginBtn.onclick) {
        loginBtn.onclick = handleLogin;
    }
    if (logoutBtn && !logoutBtn.onclick) {
        // 기존 이벤트 리스너 제거 후 새로 추가 (중복 방지)
        const newLogoutBtn = logoutBtn.cloneNode(true);
        logoutBtn.parentNode.replaceChild(newLogoutBtn, logoutBtn);
        
        newLogoutBtn.onclick = async function(e) {
            e.preventDefault();
            e.stopPropagation();
            await handleLogout();
        };
    }
}

// 즉시 실행 (DOMContentLoaded가 이미 발생했을 수 있음)
attachLoginButtons();

// DOMContentLoaded 시에도 실행
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachLoginButtons);
} else {
    // 이미 로드되었으면 즉시 실행
    setTimeout(attachLoginButtons, 0);
}

// pageLoaded 이벤트 시에도 실행 (SPA 라우팅 대응)
window.addEventListener('pageLoaded', () => {
    setTimeout(attachLoginButtons, 100); // 네비게이션 컴포넌트 로드 대기
});

// window에 노출
window.attachLoginButtons = attachLoginButtons;


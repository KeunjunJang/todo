// ============================================
// 3D Interior Plotter — Select & View
// 소품을 선택 → View 버튼 → 3D 조감도 생성
// ============================================
(function() {
    if (window._interiorJsLoaded) return;
    window._interiorJsLoaded = true;

    // ── 상태 ───────────────────────────────
    let roomW = 8, roomD = 6, roomH = 2.7;
    let wallColorHex = '#f5f0eb';
    let floorType = 'wood_light';
    let scene, camera, renderer, controls, animId;
    let isViewerActive = false;

    const FLOOR_COLORS = {
        wood_light:'#d4a574', wood_dark:'#5c3a1e',
        marble_white:'#f0ede8', marble_gray:'#b0aead',
        tile:'#e8e0d0', concrete:'#a0a0a0'
    };

    const SPECS = {
        ceiling_light:  {w:0.5,d:0.5,h:0.15,color:'#ffd700',name:'천장 조명'},
        floor_lamp:     {w:0.3,d:0.3,h:1.6, color:'#d4a853',name:'플로어 램프'},
        desk_lamp:      {w:0.2,d:0.2,h:0.45,color:'#e8d5b7',name:'데스크 램프'},
        pendant_light:  {w:0.4,d:0.4,h:0.3, color:'#c9a84c',name:'펜던트 조명'},
        dining_table:   {w:1.2,d:0.8,h:0.75,color:'#8B5E3C',name:'식탁 (4인)'},
        dining_table_6: {w:1.8,d:0.9,h:0.75,color:'#8B5E3C',name:'식탁 (6인)'},
        coffee_table:   {w:1.0,d:0.5,h:0.45,color:'#a0522d',name:'커피 테이블'},
        side_table:     {w:0.45,d:0.45,h:0.55,color:'#d2b48c',name:'사이드 테이블'},
        desk:           {w:1.2,d:0.6,h:0.75,color:'#6b4226',name:'책상'},
        sofa_2:         {w:1.6,d:0.85,h:0.8,color:'#4a6741',name:'2인 소파'},
        sofa_3:         {w:2.2,d:0.9, h:0.8,color:'#4a6741',name:'3인 소파'},
        armchair:       {w:0.85,d:0.85,h:0.9,color:'#8b6f47',name:'안락의자'},
        dining_chair:   {w:0.45,d:0.45,h:0.9,color:'#a67b5b',name:'식탁 의자'},
        bed_queen:      {w:1.6,d:2.0,h:0.55,color:'#ede0d4',name:'퀸 침대'},
        bed_double:     {w:1.4,d:2.0,h:0.55,color:'#f0e6d4',name:'더블 침대'},
        wardrobe:       {w:1.2,d:0.6,h:2.0, color:'#5c4033',name:'옷장'},
        nightstand:     {w:0.45,d:0.4,h:0.55,color:'#8b7355',name:'협탁'},
        dresser:        {w:1.0,d:0.5,h:0.8, color:'#f5f0eb',name:'화장대'},
        bookshelf:      {w:0.8,d:0.35,h:1.8,color:'#6b4226',name:'책장'},
        tv_stand:       {w:1.5,d:0.45,h:0.5,color:'#333333',name:'TV 거치대'},
        cabinet:        {w:0.8,d:0.45,h:1.0,color:'#5c4033',name:'수납장'},
        shoe_rack:      {w:0.8,d:0.35,h:1.0,color:'#d2b48c',name:'신발장'},
        plant:          {w:0.4,d:0.4,h:0.8, color:'#228B22',name:'화분'},
        rug:            {w:2.0,d:1.5,h:0.02,color:'#cd853f',name:'러그'},
        curtain:        {w:1.5,d:0.1,h:2.4, color:'#e8e0d8',name:'커튼'},
        mirror:         {w:0.6,d:0.05,h:1.2,color:'#c0c0c0',name:'거울'},
        fridge:         {w:0.7,d:0.7,h:1.8, color:'#c0c0c0',name:'냉장고'},
        kitchen_island: {w:1.5,d:0.8,h:0.9, color:'#f5f5f5',name:'아일랜드 식탁'},
        stove:          {w:0.6,d:0.6,h:0.9, color:'#2f2f2f',name:'가스레인지'},
        sink:           {w:0.6,d:0.5,h:0.9, color:'#d3d3d3',name:'싱크대'}
    };

    // ════════════════════════════════════════
    //  초기화 (선택 화면 세팅)
    // ════════════════════════════════════════
    window.initializeInteriorPage = function() {
        if (!document.getElementById('interior-app')) return;
        console.log('[Interior] 페이지 초기화');
        setupCheckboxListeners();
        updateSelectedCount();
    };

    function setupCheckboxListeners() {
        const checkboxes = document.querySelectorAll('#selection-categories input[type="checkbox"]');
        checkboxes.forEach(cb => {
            cb.removeEventListener('change', onCheckChange);
            cb.addEventListener('change', onCheckChange);
        });
    }

    function onCheckChange() {
        updateSelectedCount();
    }

    function updateSelectedCount() {
        const checked = document.querySelectorAll('#selection-categories input[type="checkbox"]:checked');
        const el = document.getElementById('selected-count');
        if (el) el.textContent = `선택: ${checked.length}개`;
        const btn = document.getElementById('view-btn');
        if (btn) btn.disabled = checked.length === 0;
    }

    // ════════════════════════════════════════
    //  View 생성 (3D 씬 빌드)
    // ════════════════════════════════════════
    window.generateView = function() {
        // 선택된 소품 수집
        const checked = document.querySelectorAll('#selection-categories input[type="checkbox"]:checked');
        if (checked.length === 0) {
            if (typeof showToast === 'function') showToast('소품을 하나 이상 선택해주세요.', 'warning');
            return;
        }

        const selectedTypes = Array.from(checked).map(cb => cb.dataset.type).filter(t => SPECS[t]);
        if (selectedTypes.length === 0) return;

        // 방 설정 읽기
        const wI = document.getElementById('room-width');
        const dI = document.getElementById('room-depth');
        const hI = document.getElementById('room-height');
        const fI = document.getElementById('floor-material');
        const cI = document.getElementById('wall-color');
        if (wI) roomW = parseFloat(wI.value) || 8;
        if (dI) roomD = parseFloat(dI.value) || 6;
        if (hI) roomH = parseFloat(hI.value) || 2.7;
        if (fI) floorType = fI.value;
        if (cI) wallColorHex = cI.value;

        // 화면 전환: 선택 → 3D뷰
        document.getElementById('selection-screen').style.display = 'none';
        document.getElementById('viewer-screen').style.display = 'flex';
        document.getElementById('view-controls').style.display = 'flex';

        // 3D 생성
        buildScene(selectedTypes);
        isViewerActive = true;
    };

    // ── 소품 선택 화면으로 돌아가기 ───────
    window.backToSelection = function() {
        destroyScene();
        document.getElementById('selection-screen').style.display = '';
        document.getElementById('viewer-screen').style.display = 'none';
        document.getElementById('view-controls').style.display = 'none';
        isViewerActive = false;
    };

    // ════════════════════════════════════════
    //  3D 씬 생성
    // ════════════════════════════════════════
    function buildScene(selectedTypes) {
        if (typeof THREE === 'undefined') {
            console.error('[Interior] Three.js not loaded');
            return;
        }

        const container = document.getElementById('threejs-container');
        if (!container) return;
        container.innerHTML = '';

        // Scene
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111320);

        // Camera
        const rect = container.getBoundingClientRect();
        const w = rect.width || 800;
        const h = rect.height || 600;
        camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
        camera.position.set(roomW + 3, roomH * 2.5, roomD + 3);

        // Renderer
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.1;
        container.appendChild(renderer.domElement);

        // Controls
        if (THREE.OrbitControls) {
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.target.set(roomW / 2, 0, roomD / 2);
            controls.enableDamping = true;
            controls.dampingFactor = 0.08;
            controls.minDistance = 2;
            controls.maxDistance = 30;
            controls.maxPolarAngle = Math.PI * 0.85;
            controls.update();
        }

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        const sun = new THREE.DirectionalLight(0xfff5e6, 0.85);
        sun.position.set(5, 10, 4);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const sc = sun.shadow.camera;
        sc.near = 0.5; sc.far = 30; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12;
        sun.shadow.bias = -0.001;
        scene.add(sun);
        scene.add(new THREE.DirectionalLight(0xe0eaff, 0.3).translateX(-4).translateY(6).translateZ(-3));
        const pt = new THREE.PointLight(0xffeedd, 0.5, 16);
        pt.position.set(roomW / 2, roomH - 0.2, roomD / 2);
        scene.add(pt);

        // Room (바닥 + 벽)
        addRoom();

        // 가구 자동 배치
        autoPlaceFurniture(selectedTypes);

        // Animate
        window.addEventListener('resize', onResize);
        animate();
    }

    function destroyScene() {
        if (animId) cancelAnimationFrame(animId);
        animId = null;
        window.removeEventListener('resize', onResize);
        if (renderer) renderer.dispose();
        scene = null; camera = null; renderer = null; controls = null;
    }

    function addRoom() {
        const floorClr = FLOOR_COLORS[floorType] || '#d4a574';

        // 바닥
        const floorMat = new THREE.MeshStandardMaterial({ color: floorClr, roughness: 0.65 });
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(roomW / 2, 0, roomD / 2);
        floor.receiveShadow = true;
        scene.add(floor);

        // 그리드
        const gridSize = Math.max(roomW, roomD);
        const divisions = Math.ceil(gridSize);
        const grid = new THREE.GridHelper(gridSize, divisions, 0x333355, 0x222244);
        grid.position.set(roomW / 2, 0.005, roomD / 2);
        grid.material.opacity = 0.2;
        grid.material.transparent = true;
        scene.add(grid);

        // 벽
        const wallMat = new THREE.MeshStandardMaterial({ color: wallColorHex, roughness: 0.9, side: THREE.DoubleSide });
        const t = 0.08;

        // 뒤 벽
        const bw = new THREE.Mesh(new THREE.BoxGeometry(roomW + t * 2, roomH, t), wallMat);
        bw.position.set(roomW / 2, roomH / 2, -t / 2);
        bw.receiveShadow = true;
        scene.add(bw);

        // 왼쪽 벽
        const lw = new THREE.Mesh(new THREE.BoxGeometry(t, roomH, roomD), wallMat);
        lw.position.set(-t / 2, roomH / 2, roomD / 2);
        lw.receiveShadow = true;
        scene.add(lw);

        // 오른쪽 벽
        const rw = new THREE.Mesh(new THREE.BoxGeometry(t, roomH, roomD), wallMat);
        rw.position.set(roomW + t / 2, roomH / 2, roomD / 2);
        rw.receiveShadow = true;
        scene.add(rw);

        // 바닥 테두리
        const pts = [
            new THREE.Vector3(0,0.01,0), new THREE.Vector3(roomW,0.01,0),
            new THREE.Vector3(roomW,0.01,roomD), new THREE.Vector3(0,0.01,roomD),
            new THREE.Vector3(0,0.01,0)
        ];
        scene.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0x6366f1 })
        ));
    }

    // ═══════════════════════════════════════
    //  자동 배치 알고리즘
    // ═══════════════════════════════════════
    function autoPlaceFurniture(types) {
        const margin = 0.15;
        const placed = []; // {x, z, w, d}

        // 벽 근처 vs 중앙 분류
        const wallItems = ['wardrobe','bookshelf','tv_stand','cabinet','shoe_rack','fridge','dresser',
                           'curtain','mirror','stove','sink'];
        const centerItems = ['sofa_3','sofa_2','coffee_table','rug','armchair','dining_table','dining_table_6',
                             'kitchen_island','desk'];
        const ceilingItems = ['ceiling_light','pendant_light'];
        const floorItems = ['floor_lamp','desk_lamp','plant','nightstand','side_table','dining_chair','bed_queen','bed_double'];

        // 벽 배치 영역 (시계방향: 뒤→오른쪽→앞→왼쪽)
        let wallSlots = [];
        // 뒤쪽 벽 (z=margin)
        let wx = margin;
        while (wx < roomW - margin) {
            wallSlots.push({ x: wx, z: margin, wall: 'back' });
            wx += 0.5;
        }
        // 왼쪽 벽 (x=margin)
        let wz = margin;
        while (wz < roomD - margin) {
            wallSlots.push({ x: margin, z: wz, wall: 'left' });
            wz += 0.5;
        }
        // 오른쪽 벽
        wz = margin;
        while (wz < roomD - margin) {
            wallSlots.push({ x: roomW - margin, z: wz, wall: 'right' });
            wz += 0.5;
        }

        let wallSlotIdx = 0;
        let centerX = roomW * 0.3;
        let centerZ = roomD * 0.4;

        types.forEach(type => {
            const spec = SPECS[type];
            if (!spec) return;
            let px, pz;

            if (ceilingItems.includes(type)) {
                // 천장: 방 중앙
                px = roomW / 2 - spec.w / 2;
                pz = roomD / 2 - spec.d / 2;
                addFurnitureMesh(type, spec, px, pz);
                return;
            }

            if (wallItems.includes(type)) {
                // 벽 근처 배치
                let slotFound = false;
                while (wallSlotIdx < wallSlots.length) {
                    const slot = wallSlots[wallSlotIdx];
                    wallSlotIdx++;
                    if (slot.wall === 'back') {
                        px = slot.x;
                        pz = margin;
                    } else if (slot.wall === 'left') {
                        px = margin;
                        pz = slot.z;
                    } else {
                        px = roomW - spec.w - margin;
                        pz = slot.z;
                    }
                    if (!isOverlapping(px, pz, spec.w, spec.d, placed)) {
                        slotFound = true;
                        break;
                    }
                }
                if (!slotFound) {
                    px = margin + Math.random() * (roomW - spec.w - margin * 2);
                    pz = margin;
                }
            } else {
                // 중앙 영역 배치
                px = centerX;
                pz = centerZ;
                // 겹침 방지: 빈 자리 찾기
                let tries = 0;
                while (isOverlapping(px, pz, spec.w, spec.d, placed) && tries < 30) {
                    px += 0.5;
                    if (px + spec.w > roomW - margin) {
                        px = margin + 0.5;
                        pz += 0.8;
                    }
                    if (pz + spec.d > roomD - margin) {
                        pz = roomD * 0.3;
                        px += 1;
                    }
                    tries++;
                }
                centerX = px + spec.w + 0.3;
                if (centerX > roomW - 1) {
                    centerX = roomW * 0.25;
                    centerZ += 1.2;
                }
            }

            // 경계 보정
            px = Math.max(margin, Math.min(roomW - spec.w - margin, px));
            pz = Math.max(margin, Math.min(roomD - spec.d - margin, pz));

            placed.push({ x: px, z: pz, w: spec.w, d: spec.d });
            addFurnitureMesh(type, spec, px, pz);
        });
    }

    function isOverlapping(x, z, w, d, placed) {
        for (const p of placed) {
            if (x < p.x + p.w && x + w > p.x && z < p.z + p.d && z + d > p.z) return true;
        }
        return false;
    }

    // ═══════════════════════════════════════
    //  3D 가구 메쉬 생성
    // ═══════════════════════════════════════
    function addFurnitureMesh(type, spec, px, pz) {
        const grp = new THREE.Group();
        const c = new THREE.Color(spec.color);
        const w = spec.w, d = spec.d, h = spec.h;

        if (type === 'plant') {
            grp.add(makeMesh(new THREE.CylinderGeometry(0.16,0.11,0.28,12), 0x8B4513, 0,0.14,0));
            grp.add(makeMesh(new THREE.SphereGeometry(0.22,10,10), 0x228B22, 0,0.52,0, true));
            grp.add(makeMesh(new THREE.CylinderGeometry(0.015,0.02,0.2,6), 0x2d5a1e, 0,0.38,0));
        }
        else if (['sofa_2','sofa_3','armchair'].includes(type)) {
            const sH = h * 0.4;
            grp.add(makeMesh(new THREE.BoxGeometry(w, sH, d), c, 0, sH/2, 0, true));
            grp.add(makeMesh(new THREE.BoxGeometry(w, h*0.5, 0.12), c.clone().offsetHSL(0,0,-0.03), 0, sH+h*0.25, -d/2+0.06, true));
            grp.add(makeMesh(new THREE.BoxGeometry(w*0.85, 0.08, d*0.7), c.clone().offsetHSL(0,0.05,0.08), 0, sH+0.04, 0.04));
            addLegs(grp, w, d, 0.12, 0.02);
        }
        else if (['bed_queen','bed_double'].includes(type)) {
            grp.add(makeMesh(new THREE.BoxGeometry(w, h*0.6, d), 0x6b4226, 0, h*0.3, 0, true));
            grp.add(makeMesh(new THREE.BoxGeometry(w-0.06, 0.2, d-0.1), 0xfafaf5, 0, h*0.6+0.1, 0, true));
            grp.add(makeMesh(new THREE.BoxGeometry(w-0.1, 0.06, d*0.55), c, 0, h*0.6+0.23, d*0.12));
            grp.add(makeMesh(new THREE.BoxGeometry(0.35,0.08,0.22), 0xf5f5f0, -0.22, h*0.6+0.24, -d/2+0.2));
            grp.add(makeMesh(new THREE.BoxGeometry(0.35,0.08,0.22), 0xf5f5f0, 0.22, h*0.6+0.24, -d/2+0.2));
            grp.add(makeMesh(new THREE.BoxGeometry(w+0.06, h*0.8, 0.06), 0x4a3520, 0, h*0.5, -d/2+0.03, true));
        }
        else if (['dining_table','dining_table_6','coffee_table','side_table','desk'].includes(type)) {
            grp.add(makeMesh(new THREE.BoxGeometry(w, 0.04, d), c, 0, h, 0, true));
            addLegs(grp, w, d, h-0.04, 0.03);
            if (type === 'desk') {
                grp.add(makeMesh(new THREE.BoxGeometry(w*0.4, 0.12, d-0.1), c.clone().offsetHSL(0,0,-0.08), w*0.15, h-0.12, 0));
            }
        }
        else if (type === 'dining_chair') {
            grp.add(makeMesh(new THREE.BoxGeometry(w, 0.03, d), c, 0, h*0.5, 0, true));
            grp.add(makeMesh(new THREE.BoxGeometry(w-0.04, h*0.45, 0.02), c, 0, h*0.72, -d/2+0.01, true));
            addLegs(grp, w, d, h*0.5, 0.02);
        }
        else if (type === 'rug') {
            const rug = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, side: THREE.DoubleSide }));
            rug.rotation.x = -Math.PI / 2;
            rug.position.y = 0.01;
            rug.receiveShadow = true;
            grp.add(rug);
        }
        else if (['wardrobe','bookshelf','cabinet','shoe_rack','tv_stand','fridge'].includes(type)) {
            grp.add(makeMesh(new THREE.BoxGeometry(w, h, d), c, 0, h/2, 0, true));
            grp.add(makeMesh(new THREE.BoxGeometry(w-0.02, h-0.04, 0.02), c.clone().offsetHSL(0,0,0.05), 0, h/2, d/2+0.01));
            if (type === 'tv_stand') {
                grp.add(makeMesh(new THREE.BoxGeometry(w*0.85, w*0.5, 0.04), 0x111111, 0, h+w*0.25, -d*0.3, true));
                const screen = makeMesh(new THREE.BoxGeometry(w*0.78, w*0.43, 0.005), 0x1a1a2e, 0, h+w*0.25, -d*0.3+0.025);
                screen.material.emissive = new THREE.Color(0x0a0a1e);
                screen.material.emissiveIntensity = 0.3;
                grp.add(screen);
            }
            if (['bookshelf','cabinet','shoe_rack'].includes(type)) {
                const cnt = Math.floor(h / 0.4);
                for (let i = 1; i < cnt; i++) {
                    grp.add(makeMesh(new THREE.BoxGeometry(w-0.04, 0.015, d-0.04), c.clone().offsetHSL(0,0,-0.05), 0, i*(h/cnt), 0));
                }
            }
        }
        else if (['curtain','mirror'].includes(type)) {
            const mat = new THREE.MeshStandardMaterial({
                color: c, roughness: type==='mirror'?0.1:0.9, metalness: type==='mirror'?0.8:0, side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, Math.max(d,0.03)), mat);
            mesh.position.y = h/2 + 0.5;
            mesh.castShadow = true;
            grp.add(mesh);
        }
        else if (['ceiling_light','pendant_light'].includes(type)) {
            grp.add(makeMesh(new THREE.CylinderGeometry(w/2, w/2+0.05, 0.12, 16), c, 0, roomH-0.1, 0));
            grp.add(makeMesh(new THREE.CylinderGeometry(0.005,0.005,0.4,4), 0x333333, 0, roomH-0.3, 0));
            const light = new THREE.PointLight(0xffeedd, 0.6, 6);
            light.position.y = roomH - 0.2;
            grp.add(light);
        }
        else if (type === 'floor_lamp') {
            grp.add(makeMesh(new THREE.CylinderGeometry(0.12,0.15,0.04,12), 0x333333, 0, 0.02, 0));
            grp.add(makeMesh(new THREE.CylinderGeometry(0.015,0.02,h-0.2,8), 0x888888, 0, h/2, 0, true));
            grp.add(makeMesh(new THREE.CylinderGeometry(0.08,0.15,0.2,12), c, 0, h-0.1, 0));
            const light = new THREE.PointLight(0xffeedd, 0.4, 5);
            light.position.y = h - 0.05;
            grp.add(light);
        }
        else if (type === 'desk_lamp') {
            grp.add(makeMesh(new THREE.CylinderGeometry(0.08,0.1,0.02,10), 0x333333, 0, 0.01, 0));
            const arm = makeMesh(new THREE.CylinderGeometry(0.01,0.01,0.35,6), 0x888888, 0, 0.2, 0);
            arm.rotation.z = -0.3;
            grp.add(arm);
            grp.add(makeMesh(new THREE.ConeGeometry(0.06,0.08,10), c, -0.05, 0.38, 0));
        }
        else if (['nightstand','dresser'].includes(type)) {
            grp.add(makeMesh(new THREE.BoxGeometry(w, h, d), c, 0, h/2, 0, true));
            addLegs(grp, w, d, 0.08, 0.02);
        }
        else if (['kitchen_island','stove','sink'].includes(type)) {
            grp.add(makeMesh(new THREE.BoxGeometry(w, h, d), c, 0, h/2, 0, true));
            grp.add(makeMesh(new THREE.BoxGeometry(w+0.02, 0.03, d+0.02), 0xf0ece8, 0, h, 0));
        }
        else {
            grp.add(makeMesh(new THREE.BoxGeometry(w, h, d), c, 0, h/2, 0, true));
        }

        grp.position.set(px + w/2, 0, pz + d/2);
        scene.add(grp);
    }

    function makeMesh(geo, color, x, y, z, castShadow) {
        const mat = new THREE.MeshStandardMaterial({
            color: typeof color === 'number' ? color : new THREE.Color(color),
            roughness: 0.6, metalness: 0.05
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x || 0, y || 0, z || 0);
        if (castShadow) { mesh.castShadow = true; mesh.receiveShadow = true; }
        return mesh;
    }

    function addLegs(grp, w, d, legH, legR) {
        const geo = new THREE.CylinderGeometry(legR, legR, legH, 6);
        const mat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.5 });
        const ins = 0.05;
        [[-w/2+ins,-d/2+ins],[w/2-ins,-d/2+ins],[-w/2+ins,d/2-ins],[w/2-ins,d/2-ins]].forEach(([lx,lz]) => {
            const leg = new THREE.Mesh(geo, mat);
            leg.position.set(lx, legH/2, lz);
            leg.castShadow = true;
            grp.add(leg);
        });
    }

    // ── 애니메이션 ────────────────────────
    function animate() {
        animId = requestAnimationFrame(animate);
        if (controls) controls.update();
        if (renderer && scene && camera) renderer.render(scene, camera);
    }

    function onResize() {
        const c = document.getElementById('threejs-container');
        if (!c || !camera || !renderer) return;
        const r = c.getBoundingClientRect();
        camera.aspect = r.width / Math.max(r.height, 1);
        camera.updateProjectionMatrix();
        renderer.setSize(r.width, r.height);
    }

    // ═══════════════════════════════════════
    //  전역 함수
    // ═══════════════════════════════════════
    window.set3DView = function(preset) {
        if (!camera || !controls) return;
        const cx = roomW/2, cz = roomD/2;
        document.querySelectorAll('.view-preset-btn').forEach(b => b.classList.remove('active'));
        if (event && event.target) {
            const btn = event.target.closest('.view-preset-btn');
            if (btn) btn.classList.add('active');
        }
        switch(preset) {
            case 'top': camera.position.set(cx,12,cz+0.01); controls.target.set(cx,0,cz); break;
            case 'front': camera.position.set(cx,roomH*0.6,roomD+5); controls.target.set(cx,roomH*0.3,cz); break;
            case 'corner': camera.position.set(roomW+3,roomH*2.5,roomD+3); controls.target.set(cx,0,cz); break;
            case 'walkthrough': camera.position.set(cx,1.6,roomD-0.3); controls.target.set(cx,1.4,cz*0.3); break;
        }
        controls.update();
    };

    window.clearAllFurniture = function() {
        backToSelection();
        document.querySelectorAll('#selection-categories input[type="checkbox"]').forEach(cb => cb.checked = false);
        updateSelectedCount();
    };

    window.captureScreenshot = function() {
        if (!renderer || !scene || !camera) return;
        renderer.render(scene, camera);
        const a = document.createElement('a');
        a.download = `interior_3d_${Date.now()}.png`;
        a.href = renderer.domElement.toDataURL('image/png');
        a.click();
        if (typeof showToast === 'function') showToast('스크린샷이 저장되었습니다.', 'success');
    };

    window.filterComponents = function(q) {
        const query = q.toLowerCase();
        document.querySelectorAll('.sel-item').forEach(el => {
            const txt = el.textContent.toLowerCase();
            el.style.display = txt.includes(query) || !query ? '' : 'none';
        });
        document.querySelectorAll('.sel-category').forEach(cat => {
            const vis = Array.from(cat.querySelectorAll('.sel-item')).some(el => el.style.display !== 'none');
            cat.style.display = vis ? '' : 'none';
        });
    };

    // ── pageLoaded 이벤트 ────────────────
    window.addEventListener('pageLoaded', function(e) {
        if (e.detail && e.detail.path === '/new_task_1') {
            setTimeout(() => window.initializeInteriorPage(), 150);
        }
    });

    // 직접 접근
    if (document.getElementById('interior-app')) {
        window.initializeInteriorPage();
    }

})();

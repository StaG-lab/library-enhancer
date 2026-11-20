// ==UserScript==
// @name         LTX Library Enhancer For Korean Users
// @namespace    http://tampermonkey.net/
// @version      1.1.10
// @description  배우 한글/영문/초성 검색, 다중 명의(대표 이름) 통합 검색, JSON/CSV 내보내기, 외부 검색 사이트(extLink) 기능
// @author       You
// @match        https://ltxlib.dpdns.org/*
// @connect      www.avdbs.com
// @connect      raw.githubusercontent.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceText
// @grant        GM_addStyle
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/LTX-Library-Enhancer-For-Korean.user.js
// @downloadURL  https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/LTX-Library-Enhancer-For-Korean.user.js
// @require      https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/js/01-ltx-utils-storage.js?v=1.1.10
// @require      https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/js/02-ltx-actor-avdbs.js?v=1.1.10
// @require      https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/js/03-ltx-card-dom.js?v=1.1.10
// @require      https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/js/04-ltx-modals.js?v=1.1.10
// @resource     LTX_CSS https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/css/ltx-enhancer.css?v=1.1.10
// @run-at       document-start
// ==/UserScript==
/* global DecompressionStream, LtxUtil, LtxUI, LtxActor, LtxCard, LtxIDB, LtxModal */
(function () {
    'use strict';

    /* ==========================================================================
     * 1. API 복호화 후킹 및 데이터 누적 (document-start)
     * ========================================================================== */
    const PREFIX = 'ltx-api-response-v1';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let baseMetadata = null;
    let latestTotal = 0;

    function mergeResponseData(jsonData) {
        if (!jsonData || typeof jsonData !== 'object') return;
        if (!baseMetadata || jsonData.metadataIncluded !== false) {
            const { items, ...rest } = jsonData;
            baseMetadata = { ...baseMetadata, ...rest };
        }
        if (Array.isArray(jsonData.actorCounts)) LtxActor.syncActorCountsFromApi(jsonData.actorCounts);
        if (typeof jsonData.total === 'number') latestTotal = Math.max(latestTotal, jsonData.total);
        if (typeof jsonData.catalogTotal === 'number') latestTotal = Math.max(latestTotal, jsonData.catalogTotal);

        if (Array.isArray(jsonData.items)) {
            for (const rawItem of jsonData.items) {
                if (!rawItem || !rawItem.code) continue;
                const code = String(rawItem.code).trim();
                const prev = LtxIDB.items.get(code) || {};
                const itemObj = { ...prev };

                for (const [k, v] of Object.entries(rawItem)) {
                    if (v === null || v === undefined) continue;
                    if (typeof v === 'string' && v.trim() === '' && prev[k]) continue;
                    if (Array.isArray(v) && v.length === 0 && Array.isArray(prev[k]) && prev[k].length > 0) continue;
                    itemObj[k] = v;
                }
                itemObj.code = code;
                LtxIDB.items.set(code, itemObj);
                LtxIDB.queueUpsert(itemObj);

                if (Array.isArray(itemObj.actors)) {
                    for (const actor of itemObj.actors) {
                        if (actor && !LtxActor.actorCache.has(actor) && !LtxActor.noDataCache.has(actor) && !LtxActor.ignoredCache.has(actor)) {
                            LtxActor.enqueueLookup(actor, false);
                        }
                    }
                }
            }
            updateMainButtonCounter();
            requestAnimationFrame(() => LtxCard.injectAliasActorCards(LtxModal.openListPickerModal, flashStatus));
        }
    }

    const origDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async function (algorithm, key, data) {
        const decryptedBuffer = await origDecrypt(algorithm, key, data);
        try {
            if (algorithm && algorithm.additionalData) {
                const aad = JSON.parse(decoder.decode(algorithm.additionalData));
                if (Array.isArray(aad) && aad[0] === PREFIX && aad[4] && aad[4].startsWith('/api/items')) {
                    let plainBuffer = decryptedBuffer.slice(0);
                    if (aad[6] === 'gzip') {
                        const stream = new Blob([plainBuffer]).stream().pipeThrough(new DecompressionStream('gzip'));
                        plainBuffer = await new Response(stream).arrayBuffer();
                    }
                    mergeResponseData(JSON.parse(decoder.decode(plainBuffer)));
                }
            }
        } catch (e) { }
        return decryptedBuffer;
    };

    LtxIDB.loadAll(() => {
        updateMainButtonCounter();
        requestAnimationFrame(() => LtxCard.injectAliasActorCards(LtxModal.openListPickerModal, flashStatus));
    });

    /* ==========================================================================
     * 2. JSON / CSV 내보내기, 파일 병합 및 자동 스크롤
     * ========================================================================== */
    const CSV_HEADERS = ['code', 'title', 'title_zh', 'actors', 'maker', 'date', 'score', 'rawScore', 'votes', 'added_at', 'pending', 'url', 'cover', 'shot', 'subtitle', 'link'];

    function escapeCsvField(val) {
        if (val === null || val === undefined) return '';
        const str = String(val);
        return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }

    function downloadCsv(itemsArray, filename, extraActorMap = {}) {
        const rows = [CSV_HEADERS.join(',')];
        for (const item of itemsArray) {
            const actorsStr = Array.isArray(item.actors)
                ? item.actors.map(a => LtxActor.formatActorForCsv(a, extraActorMap)).join(' / ')
                : (item.actors || '');
            let addedIso = '';
            if (item.added_at) {
                const d = new Date(item.added_at);
                addedIso = isNaN(d.getTime()) ? String(item.added_at) : d.toISOString();
            }
            const pendingVal = (item.pending === true || String(item.pending).toUpperCase() === 'TRUE') ? 'TRUE' : 'FALSE';
            rows.push([item.code, item.title, item.title_zh, actorsStr, item.maker, item.date, item.score, item.rawScore, item.votes, addedIso, pendingVal, item.url, item.cover, item.shot, item.subtitle, item.link].map(escapeCsvField).join(','));
        }
        LtxUtil.triggerBlobDownload(new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename);
    }

    function parseCsvToRows(text) {
        const clean = text.replace(/^\uFEFF/, '');
        const rows = []; let row = []; let field = ''; let inQuotes = false;
        for (let i = 0; i < clean.length; i++) {
            const c = clean[i];
            if (inQuotes) {
                if (c === '"') { if (clean[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
                else field += c;
            } else if (c === '"') inQuotes = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\r' || c === '\n') {
                if (c === '\r' && clean[i + 1] === '\n') i++;
                row.push(field);
                if (row.length > 1 || row[0] !== '') rows.push(row);
                row = []; field = '';
            } else field += c;
        }
        if (field !== '' || row.length > 0) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
        return rows;
    }

    function buildActorDict(itemsArray, extra = {}) {
        const dict = { ...extra };
        for (const item of itemsArray) {
            if (!Array.isArray(item.actors)) continue;
            for (const jName of item.actors) {
                if (!jName) continue;
                const cached = LtxActor.actorCache.get(jName);
                if (cached) dict[jName] = { jName: cached.jName, kName: cached.kName || cached.jName, eName: cached.eName || '', ...(cached.repName ? { repName: cached.repName } : {}) };
                else if (!dict[jName]) dict[jName] = { jName, kName: jName, eName: '' };
            }
        }
        return dict;
    }

    function exportCurrentJson() {
        const items = Array.from(LtxIDB.items.values());
        const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        LtxUtil.downloadJson({ ...(baseMetadata || {}), exportedAt: new Date().toISOString(), accumulatedCount: items.length, total: latestTotal || items.length, actorName: buildActorDict(items), items }, `ltx-items-${dateStr}-${items.length}ea.json`);
    }

    function exportCurrentCsv() {
        const items = Array.from(LtxIDB.items.values());
        const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        downloadCsv(items, `ltx-items-${dateStr}-${items.length}ea.csv`);
    }

    function handleMergeJsonFiles() {
        LtxUtil.selectLocalFiles('.json,application/json', async (files) => {
            try {
                const map = new Map(); let meta = {}; let dict = {};
                for (const file of files) {
                    const parsed = JSON.parse(await file.text());
                    if (Array.isArray(parsed)) parsed.forEach(it => { if (it?.code) map.set(String(it.code).trim(), it); });
                    else if (parsed && typeof parsed === 'object') {
                        const { items, actorName, ...rest } = parsed;
                        meta = { ...meta, ...rest };
                        if (actorName && typeof actorName === 'object') dict = { ...dict, ...actorName };
                        if (Array.isArray(items)) items.forEach(it => { if (it?.code) map.set(String(it.code).trim(), it); });
                    }
                }
                const items = Array.from(map.values());
                const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                LtxUtil.downloadJson({ ...meta, exportedAt: new Date().toISOString(), mergedFileCount: files.length, accumulatedCount: items.length, total: items.length, actorName: buildActorDict(items, dict), items }, `ltx-merged-${dateStr}-${items.length}ea.json`);
            } catch (err) { alert(`JSON 병합 오류: ${err.message}`); }
        });
    }

    function handleMergeCsvFiles() {
        LtxUtil.selectLocalFiles('.csv,text/csv', async (files) => {
            try {
                const map = new Map(); const actorMap = {};
                for (const file of files) {
                    const rows = parseCsvToRows(await file.text());
                    if (rows.length < 2) continue;
                    const headers = rows[0].map(h => h.trim());
                    const codeIdx = headers.indexOf('code');
                    for (let i = 1; i < rows.length; i++) {
                        const cols = rows[i]; const obj = {};
                        headers.forEach((h, idx) => { obj[h] = cols[idx] !== undefined ? cols[idx] : ''; });
                        const code = (codeIdx !== -1 ? cols[codeIdx] : obj.code || '').trim();
                        if (!code) continue;
                        if (typeof obj.actors === 'string') {
                            obj.actors = obj.actors ? obj.actors.split(/\s*\/\s*/).filter(Boolean).map(tok => {
                                const p = LtxActor.parseActorToken(tok);
                                if (p) { actorMap[p.jName] = p; return p.jName; }
                                return tok;
                            }) : [];
                        }
                        obj.pending = String(obj.pending).toUpperCase() === 'TRUE';
                        obj.code = code;
                        map.set(code, obj);
                    }
                }
                const items = Array.from(map.values());
                const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                downloadCsv(items, `ltx-merged-${dateStr}-${items.length}ea.csv`, actorMap);
            } catch (err) { alert(`CSV 병합 오류: ${err.message}`); }
        });
    }

    // 자동 스크롤
    const PENDING_AUTOSCROLL_KEY = 'ltx_pending_autoscroll_v1';
    let isAutoScrolling = false, scrollWorker = null, scrollFallback = null, idleTicks = 0, lastH = 0, lastCards = 0, lastAcc = 0;

    function updateMainButtonCounter(tempText) {
        const mainBtn = document.querySelector('.ltx-dataload-btn');
        const labelEl = mainBtn?.querySelector('.ltx-dataload-label');
        const scrollLabel = document.querySelector('.ltx-menu-autoscroll-label');
        if (scrollLabel) scrollLabel.textContent = isAutoScrolling ? '자동 스크롤 정지' : '자동 스크롤 (완료 시 자동 저장)';
        if (!mainBtn || !labelEl) return;
        mainBtn.classList.toggle('scrolling', isAutoScrolling);
        const cnt = `${LtxIDB.items.size}/${latestTotal || 0}`;
        labelEl.textContent = tempText ? `${tempText} (${cnt})` : isAutoScrolling ? `스크롤 중… ${cnt}` : `데이터로드 ${cnt}`;
    }

    function flashStatus(msg, ms = 1800) {
        updateMainButtonCounter(msg);
        setTimeout(() => { if (!isAutoScrolling) updateMainButtonCounter(); }, ms);
    }

    function stopAutoScroll(msg, completed = false) {
        isAutoScrolling = false;
        if (scrollWorker) { scrollWorker.postMessage('stop'); scrollWorker.terminate(); scrollWorker = null; }
        if (scrollFallback) { clearInterval(scrollFallback); scrollFallback = null; }
        updateMainButtonCounter(msg);
        /*
        if (completed) {
            exportCurrentJson();
            setTimeout(exportCurrentCsv, 350);
        }
        */
        if (msg) setTimeout(() => { if (!isAutoScrolling) updateMainButtonCounter(); }, 2200);
    }

    function runAutoScrollTick() {
        if (!isAutoScrolling) return;
        const retryBtn = document.querySelector('.load-state button.pbtn');
        if (retryBtn && !retryBtn.disabled) { retryBtn.click(); idleTicks = 0; return; }

        const isBusy = !!document.querySelector('.sk-more, .sk-replace, .grid[aria-busy="true"], [aria-busy="true"]');
        if (idleTicks > 0 && idleTicks % 4 === 0) window.scrollBy(0, -450);
        document.querySelector('.sentinel')?.scrollIntoView({ behavior: 'instant', block: 'end' });
        window.scrollTo(0, document.documentElement.scrollHeight);
        window.dispatchEvent(new Event('scroll'));

        const curH = document.documentElement.scrollHeight;
        const curC = document.querySelectorAll('article.card').length;
        const curA = LtxIDB.items.size;
        let target = latestTotal;
        const m = document.querySelector('.bar-end .result')?.textContent?.match(/(\d+)/);
        if (m) target = Math.max(target, parseInt(m[1], 10));

        if (target > 0 && (curC >= target || curA >= target) && !isBusy) { stopAutoScroll('스크롤 완료!', true); return; }
        if (curH > lastH || curC > lastCards || curA > lastAcc || isBusy) {
            lastH = curH; lastCards = curC; lastAcc = curA; idleTicks = 0;
        } else if (++idleTicks >= (target > 0 && curA < target ? 45 : 20)) {
            stopAutoScroll('스크롤 완료!', true);
        }
    }

    function toggleAutoScroll() {
        if (isAutoScrolling) { stopAutoScroll('정지됨', false); return; }
        isAutoScrolling = true; idleTicks = 0;
        lastH = document.documentElement.scrollHeight;
        lastCards = document.querySelectorAll('article.card').length;
        lastAcc = LtxIDB.items.size;
        updateMainButtonCounter();
        try {
            const blob = new Blob([`let t=null;self.onmessage=e=>{if(e.data==='start'){clearInterval(t);t=setInterval(()=>self.postMessage('tick'),450);}else{clearInterval(t);t=null;}};`], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            scrollWorker = new Worker(url);
            URL.revokeObjectURL(url);
            scrollWorker.onmessage = () => { if (isAutoScrolling) runAutoScrollTick(); };
            scrollWorker.postMessage('start');
        } catch (e) {
            scrollFallback = setInterval(runAutoScrollTick, 450);
        }
    }

    /* ==========================================================================
     * 3. 헤더 컨트롤 마운트, 검색창 "한/EN" 버튼 및 DOM 감시자
     * ========================================================================== */
    function enhanceSearchInputs() {
        document.querySelectorAll('.side .head input[type="search"], .search-wrap input[type="search"]').forEach(input => {
            if (input.dataset.ltxKoenEnhanced === 'true' || !input.parentElement) return;
            const parent = input.parentElement;
            if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

            const isSide = Boolean(input.closest('.side .head'));
            const hasClear = Boolean(parent.querySelector('button:not(.ltx-koen-trigger-btn)'));
            const rightOffset = (hasClear ? 30 : 8) + (isSide ? 4 : 0);
            input.style.paddingRight = `${Math.max(parseInt(getComputedStyle(input).paddingRight, 10) || 12, rightOffset + 48)}px`;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ltx-koen-trigger-btn';
            btn.style.right = `${rightOffset}px`;
            btn.textContent = '한/EN';
            btn.title = '한글/초성/영문 배우 검색 (Ctrl+K)';
            btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); LtxModal.openActorKoEnSearchModal(input); });
            parent.appendChild(btn);
            input.dataset.ltxKoenEnhanced = 'true';
        });
    }

    function mountHeaderControls() {
        if (document.querySelector('.ltx-custom-tools')) return;
        const header = document.querySelector('header.header');
        if (!header) return;

        const container = document.createElement('div');
        container.className = 'ltx-custom-tools';

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        mainBtn.className = 'ltx-dataload-btn';
        mainBtn.innerHTML = `<span class="ltx-dataload-label">데이터로드 0/0</span> ▾`;

        const queueBadge = document.createElement('span');
        queueBadge.className = 'ltx-avdbs-queue-badge';

        const menu = document.createElement('div');
        menu.className = 'ltx-dropdown-menu';

        const addMenuItem = (label, onClick, extraClass = '', color = '') => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ltx-dropdown-item';
            if (color) btn.style.color = color;
            btn.innerHTML = `<span class="${extraClass}">${label}</span>`;
            btn.addEventListener('click', () => { menu.classList.remove('open'); onClick(); });
            menu.appendChild(btn);
        };
        const addDivider = () => { const d = document.createElement('div'); d.className = 'ltx-dropdown-divider'; menu.appendChild(d); };

        addMenuItem('JSON 다운로드', () => { exportCurrentJson(); flashStatus('JSON 완료', 1200); });
        addMenuItem('CSV 다운로드', () => { exportCurrentCsv(); flashStatus('CSV 완료', 1200); });
        addMenuItem('자동 스크롤', () => {
            if (isAutoScrolling) { toggleAutoScroll(); return; }
            if (location.hostname === 'ltxlib.dpdns.org' && location.pathname === '/' && !location.search) { toggleAutoScroll(); return; }
            sessionStorage.setItem(PENDING_AUTOSCROLL_KEY, '1');
            location.href = 'https://ltxlib.dpdns.org/';
        }, 'ltx-menu-autoscroll-label');
        addDivider();
        addMenuItem('JSON 파일 병합', handleMergeJsonFiles);
        addMenuItem('CSV 파일 병합', handleMergeCsvFiles);
        addDivider();
        addMenuItem(`외부 사이트 관리 (${LtxCard.getExtSites().length}/${LtxCard.MAX_EXT_SITES})`, LtxModal.openExtSitesManagerModal, 'ltx-ext-sites-count');
        addMenuItem('누락 데이터 정리', LtxModal.openIdbAuditModal);
        addDivider();
        addMenuItem(`배우 정보 관리 (${LtxActor.actorCache.size} / ${LtxActor.noDataCache.size})`, () => LtxModal.openActorManagerModal('cached'), 'ltx-actor-manage-label');
        addMenuItem(`미조회 배우 일괄 조회 (스킵 ${LtxActor.noDataCache.size}명)`, () => LtxActor.batchLookupUnfetched(flashStatus), 'ltx-actor-batch-label');
        addMenuItem(`캐시·설정 백업 (${LtxActor.actorCache.size}명 / ${LtxCard.getExtSites().length}개)`, () => LtxActor.openSelectiveBackupModal(flashStatus), 'ltx-actor-cache-count');
        addMenuItem('캐시·설정 복원 (JSON)', () => LtxActor.openSelectiveRestoreModal(flashStatus));
        addDivider();
        addMenuItem('로컬저장소 초기화', () => LtxActor.openSelectiveResetModal(flashStatus), '', '#f87171');

        mainBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            LtxActor.updateStatsUI();
            LtxCard.updateExtSitesCountUI();
            menu.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!container.contains(e.target)) menu.classList.remove('open');
            if (!e.target.closest('.ltx-ext-menu-wrap')) LtxCard.closeAllExtMenus();
        });

        container.appendChild(mainBtn);
        container.appendChild(queueBadge);
        container.appendChild(menu);

        const langDesk = header.querySelector('div.lang-desk');
        if (langDesk && langDesk.parentNode) langDesk.parentNode.insertBefore(container, langDesk);
        else header.appendChild(container);

        updateMainButtonCounter();
        LtxActor.updateQueueIndicator();
        LtxActor.updateStatsUI();
        LtxCard.updateExtSitesCountUI();
    }

    function runEnhancements() {
        if (LtxUI.isModalOpen) return;
        mountHeaderControls();
        enhanceSearchInputs();
        LtxCard.injectAliasActorCards(LtxModal.openListPickerModal, flashStatus);
        LtxCard.syncActorPanelUserActors();
        document.querySelectorAll('article.card').forEach(LtxCard.modifyCard);
        document.querySelectorAll(LtxActor.ACTOR_SPAN_SELECTOR).forEach(LtxActor.bindActorSpan);
        LtxActor.refreshAllTagNames();
        LtxCard.syncBarStatsAndActions(flashStatus);
        LtxCard.syncHeaderWantCounter();
        LtxCard.syncSaveWantDialogItems();
    }

    function init() {
        if (typeof GM_getResourceText === 'function' && typeof GM_addStyle === 'function') {
            GM_addStyle(GM_getResourceText('LTX_CSS'));
        }

        // 모달 모듈(04-ltx-modals.js)에 콜백 주입
        LtxModal.init({
            parseCsvFn: parseCsvToRows,
            notifyFn: flashStatus,
            updateMainBtnFn: updateMainButtonCounter
        });

        runEnhancements();

        if (sessionStorage.getItem(PENDING_AUTOSCROLL_KEY) === '1' && location.pathname === '/' && !location.search) {
            sessionStorage.removeItem(PENDING_AUTOSCROLL_KEY);
            let tries = 0;
            const timer = setInterval(() => {
                if ((document.querySelectorAll('article.card').length > 0 && !document.querySelector('.sk-replace')) || ++tries >= 30) {
                    clearInterval(timer);
                    if (!isAutoScrolling) toggleAutoScroll();
                }
            }, 300);
        }

        document.addEventListener('keydown', (e) => {
            if (LtxUI.isModalOpen && e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation();
                LtxUI.closeActiveModal();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault(); e.stopPropagation();
                LtxModal.openActorKoEnSearchModal();
            }
        }, true);

        const onRoute = () => requestAnimationFrame(runEnhancements);
        const origPush = history.pushState;
        history.pushState = function (...a) { const r = origPush.apply(this, a); onRoute(); return r; };
        const origReplace = history.replaceState;
        history.replaceState = function (...a) { const r = origReplace.apply(this, a); onRoute(); return r; };
        window.addEventListener('popstate', onRoute);
        window.addEventListener('hashchange', onRoute);

        let scheduled = false;
        // Scope observation to the card grid container (main.main) rather than the whole body,
        // so dynamic DOM changes outside .main/.grid don't re-trigger runEnhancements().
        const observerTarget = document.querySelector('main.main') || document.body;
        new MutationObserver(() => {
            if (LtxUI.isModalOpen || scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { runEnhancements(); scheduled = false; });
        }).observe(observerTarget, { childList: true, subtree: true });

        // 페이지 전역 window 디버깅 헬퍼 노출
        const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        targetWin.LtxDebug = {
            modules: { LtxUtil, LtxIDB, LtxActor, LtxCard, LtxUI, LtxModal },
            status() {
                const injectedCards = document.querySelectorAll('article.card[data-ltx-alias-injected="true"]').length;
                const totalCards = document.querySelectorAll('article.card').length;
                const summary = {
                    'LtxUtil (공용 유틸)': { 상태: typeof LtxUtil === 'object' ? '✅ 정상' : '❌ 누락', 상세: 'store / copyText / chosung 활성' },
                    'LtxIDB (IndexedDB)': { 상태: typeof LtxIDB === 'object' ? '✅ 정상' : '❌ 누락', 상세: `누적 작품 ${LtxIDB.items.size}편 (현재 총합 ${latestTotal}편)` },
                    'LtxActor (AVDBS 배우)': { 상태: typeof LtxActor === 'object' ? '✅ 정상' : '❌ 누락', 상세: `캐시 ${LtxActor.actorCache.size}명 / 스킵 ${LtxActor.noDataCache.size}명 / 무시 ${LtxActor.ignoredCache.size}명` },
                    'LtxCard (카드·찜·외부)': { 상태: typeof LtxCard === 'object' ? '✅ 정상' : '❌ 누락', 상세: `외부사이트 ${LtxCard.getExtSites().length}개 / 통합찜 ${LtxCard.getMergedWantSet().size}편 / 모드 [${LtxActor.getSearchInsertMode()}]` },
                    'LtxModal (관리 모달 5종)': { 상태: typeof LtxModal === 'object' ? '✅ 정상' : '❌ 누락', 상세: '배우 / 외부링크 / IDB점검 / 한·EN검색 / 리스트피커' },
                    'DOM & CSS 마운트': { 상태: document.querySelector('.ltx-custom-tools') ? '✅ 마운트됨' : '⚠️ 미마운트', 상세: `전체카드 ${totalCards}장 (다른명의주입 ${injectedCards}장)` }
                };
                console.table(summary);
                return summary;
            },
            findActor(keyword) {
                const q = String(keyword || '').trim().toLowerCase();
                return Array.from(LtxActor.actorCache.values()).filter(a =>
                    a.jName.toLowerCase().includes(q) ||
                    (a.kName && a.kName.toLowerCase().includes(q)) ||
                    (a.eName && a.eName.toLowerCase().includes(q)) ||
                    (a.repName && a.repName.toLowerCase().includes(q))
                );
            },
            findItem(code) {
                return LtxIDB.items.get(LtxUtil.normalizeCode(code)) || null;
            },
            refresh() {
                runEnhancements();
                console.log('[LtxDebug] UI 및 카드 강제 갱신 완료');
            }
        };
    }

    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init);
    else init();
})();
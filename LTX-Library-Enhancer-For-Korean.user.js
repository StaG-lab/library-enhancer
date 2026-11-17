// ==UserScript==
// @name         LTX Library Enhancer For Korean Users
// @namespace    http://tampermonkey.net/
// @version      1.0.0
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
// @require      https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/js/01-ltx-utils-storage.js
// @require      https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/js/02-ltx-actor-avdbs.js
// @require      https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/js/03-ltx-card-dom.js
// @resource     LTX_CSS https://raw.githubusercontent.com/StaG-lab/library-enhancer/refs/heads/main/css/ltx-enhancer.css
// @run-at       document-start
// ==/UserScript==
/* global DecompressionStream, GM_getResourceText, GM_addStyle, unsafeWindow, LtxUtil, LtxUI, LtxActor, LtxCard, LtxIDB */
(function() {
    'use strict';

    /* ==========================================================================
     * 1. API 복호화 후킹 및 데이터 누적 (document-start)
     * ========================================================================== */
    const PREFIX = 'ltx-api-response-v1';
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let baseMetadata = null;
    let latestTotal = 0;
    let activeSession = null;

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
            requestAnimationFrame(() => LtxCard.injectAliasActorCards(openListPickerModal, flashStatus));
        }
    }

    const origDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async function(algorithm, key, data) {
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
        } catch (e) {}
        return decryptedBuffer;
    };

    LtxIDB.loadAll(() => {
        updateMainButtonCounter();
        requestAnimationFrame(() => LtxCard.injectAliasActorCards(openListPickerModal, flashStatus));
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
        if (completed) {
            exportCurrentJson();
            setTimeout(exportCurrentCsv, 350);
        }
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

        if (target > 0 && (curC >= target || curA >= target) && !isBusy) { stopAutoScroll('완료! 파일 저장', true); return; }
        if (curH > lastH || curC > lastCards || curA > lastAcc || isBusy) {
            lastH = curH; lastCards = curC; lastAcc = curA; idleTicks = 0;
        } else if (++idleTicks >= (target > 0 && curA < target ? 45 : 20)) {
            stopAutoScroll('완료! 파일 저장', true);
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
     * 3. 관리 모달 4종 (배우 캐시 / 외부 사이트 / IDB 점검 / 한·EN 검색 / 리스트 피커)
     * ========================================================================== */
    function openActorManagerModal(defaultTab = 'cached') {
        const PAGE_SIZE = 50;
        let currentTab = defaultTab, rawQuery = '', filterRep = '', sortMode = 'name', page = 1, sliceLimit = PAGE_SIZE;
        const selected = new Set();

        const { backdrop, modal } = LtxUI.createModal({
            title: 'AVDBS 배우 캐시 및 스킵·무시 목록 관리',
            fixedHeight: true,
            innerHtml: `
                <div class="ltx-modal-tabs">
                    <button type="button" class="ltx-modal-tab active" data-tab="cached">저장된 배우 캐시 (${LtxActor.actorCache.size})</button>
                    <button type="button" class="ltx-modal-tab" data-tab="nodata">no-data 스킵 목록 (${LtxActor.noDataCache.size})</button>
                    <button type="button" class="ltx-modal-tab" data-tab="ignored">무시된 배우 (${LtxActor.ignoredCache.size})</button>
                </div>
                <div class="ltx-modal-toolbar">
                    <input type="text" class="ltx-modal-search" placeholder="일본어명, 한글명, 초성(ㅅㅋㅁㅊ), 영문명, 대표이름 검색…" />
                    <select class="ltx-ignored-sort-select" style="display:none;">
                        <option value="name">이름순 (가나다/A-Z)</option>
                        <option value="count-desc">작품 수 많은 순</option>
                        <option value="count-asc">작품 수 적은 순</option>
                    </select>
                    <button type="button" class="ltx-modal-action-btn ltx-modal-csv-import-btn">CSV 일괄 가져오기</button>
                    <button type="button" class="ltx-modal-action-btn primary ltx-modal-batch-btn" style="display:none;">스킵 전체 재조회</button>
                </div>
                <div class="ltx-modal-add-bar">
                    <input type="text" class="ltx-actor-input add-jname" placeholder="일본어명 (jName) *" />
                    <input type="text" class="ltx-actor-input add-kname" placeholder="한글명 (kName)" />
                    <input type="text" class="ltx-actor-input add-ename" placeholder="영문명 (eName)" />
                    <input type="text" class="ltx-actor-input add-repname" placeholder="대표 이름 (다중 명의 묶음)" />
                    <button type="button" class="ltx-modal-action-btn primary ltx-actor-add-btn">직접 등록</button>
                </div>
                <div class="ltx-batch-rep-bar">
                    <label class="ltx-select-all-wrap"><input type="checkbox" class="ltx-select-all-chk" /><span>검색결과 전체선택 (<strong class="ltx-selected-count">0</strong>명)</span></label>
                    <input type="text" class="ltx-actor-input batch-repname-input" placeholder="선택한 배우들에게 일괄 지정할 대표 이름 입력…" />
                    <button type="button" class="ltx-modal-action-btn primary ltx-batch-rep-apply-btn">대표 이름 일괄 지정</button>
                    <button type="button" class="ltx-modal-action-btn warning ltx-batch-ignore-apply-btn" style="display:none;">선택 항목 일괄 무시</button>
                    <button type="button" class="ltx-modal-action-btn primary ltx-batch-unignore-apply-btn" style="display:none;">선택 항목 일괄 무시 해제</button>
                    <button type="button" class="ltx-mini-btn ltx-batch-rep-clear-sel">선택 해제</button>
                </div>
                <div class="ltx-rep-filter-banner" style="display:none;">
                    <span>대표 이름 필터: <strong class="ltx-rep-filter-text"></strong></span>
                    <button type="button" class="ltx-mini-btn danger ltx-rep-filter-clear">필터 해제</button>
                </div>
                <div class="ltx-modal-body"></div>
                <div class="ltx-modal-footer-pagination"></div>
            `
        });

        const bodyEl = modal.querySelector('.ltx-modal-body');
        const footerEl = modal.querySelector('.ltx-modal-footer-pagination');
        const selectAllChk = modal.querySelector('.ltx-select-all-chk');
        const selCountEl = modal.querySelector('.ltx-selected-count');
        const batchRepInput = modal.querySelector('.batch-repname-input');
        const batchRepBtn = modal.querySelector('.ltx-batch-rep-apply-btn');
        const batchIgnBtn = modal.querySelector('.ltx-batch-ignore-apply-btn');
        const batchUnignBtn = modal.querySelector('.ltx-batch-unignore-apply-btn');
        const sortSelect = modal.querySelector('.ltx-ignored-sort-select');
        const batchLookupBtn = modal.querySelector('.ltx-modal-batch-btn');
        const repBanner = modal.querySelector('.ltx-rep-filter-banner');
        let filteredJNames = [];

        const resetPage = () => { page = 1; sliceLimit = PAGE_SIZE; bodyEl.scrollTop = 0; };
        const toggleRepFilter = (rep) => { filterRep = (filterRep === rep) ? '' : rep; resetPage(); renderList(); };
        const updateSelUI = () => {
            selCountEl.textContent = String(selected.size);
            const checked = filteredJNames.filter(n => selected.has(n)).length;
            selectAllChk.checked = filteredJNames.length > 0 && checked === filteredJNames.length;
            selectAllChk.indeterminate = checked > 0 && checked < filteredJNames.length;
        };

        selectAllChk.addEventListener('change', () => {
            filteredJNames.forEach(n => selectAllChk.checked ? selected.add(n) : selected.delete(n));
            bodyEl.querySelectorAll('.ltx-row-select-chk').forEach(c => { c.checked = selected.has(c.dataset.jname); });
            updateSelUI();
        });

        modal.querySelector('.ltx-batch-rep-clear-sel').addEventListener('click', () => {
            selected.clear();
            bodyEl.querySelectorAll('.ltx-row-select-chk').forEach(c => { c.checked = false; });
            updateSelUI();
        });

        batchRepBtn.addEventListener('click', () => {
            const rep = batchRepInput.value.trim();
            if (!selected.size || !rep) { alert('선택된 배우와 대표 이름을 확인해 주세요.'); return; }
            for (const j of selected) {
                const ex = LtxActor.actorCache.get(j);
                LtxActor.actorCache.set(j, { jName: j, kName: ex?.kName || j, eName: ex?.eName || '', repName: rep, updatedAt: Date.now() });
                LtxActor.noDataCache.delete(j); LtxActor.ignoredCache.delete(j);
            }
            LtxActor.saveActorCache(); LtxActor.saveNoDataCache(); LtxActor.saveIgnoredCache();
            LtxActor.refreshAllDomActorSpans();
            selected.clear(); batchRepInput.value = ''; renderList();
        });

        batchIgnBtn.addEventListener('click', () => {
            if (!selected.size) return;
            for (const j of selected) if (LtxActor.noDataCache.delete(j)) LtxActor.ignoredCache.add(j);
            LtxActor.saveNoDataCache(); LtxActor.saveIgnoredCache(); selected.clear(); renderList();
        });

        batchUnignBtn.addEventListener('click', () => {
            if (!selected.size) return;
            for (const j of selected) if (LtxActor.ignoredCache.delete(j)) LtxActor.noDataCache.add(j);
            LtxActor.saveIgnoredCache(); LtxActor.saveNoDataCache(); selected.clear(); renderList();
        });

        modal.querySelectorAll('.ltx-modal-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                currentTab = btn.dataset.tab;
                if (currentTab !== 'cached') filterRep = '';
                selected.clear(); resetPage();
                modal.querySelectorAll('.ltx-modal-tab').forEach(b => b.classList.toggle('active', b === btn));
                batchLookupBtn.style.display = currentTab === 'nodata' ? 'inline-flex' : 'none';
                sortSelect.style.display = currentTab === 'ignored' ? 'inline-block' : 'none';
                batchRepInput.style.display = currentTab === 'cached' ? '' : 'none';
                batchRepBtn.style.display = currentTab === 'cached' ? 'inline-flex' : 'none';
                batchIgnBtn.style.display = currentTab === 'nodata' ? 'inline-flex' : 'none';
                batchUnignBtn.style.display = currentTab === 'ignored' ? 'inline-flex' : 'none';
                renderList();
            });
        });

        modal.querySelector('.ltx-modal-search').addEventListener('input', (e) => { rawQuery = e.target.value.trim(); resetPage(); renderList(); });
        sortSelect.addEventListener('change', () => { sortMode = sortSelect.value; resetPage(); renderList(); });
        modal.querySelector('.ltx-rep-filter-clear').addEventListener('click', () => { filterRep = ''; resetPage(); renderList(); });
        modal.querySelector('.ltx-modal-csv-import-btn').addEventListener('click', () => LtxActor.importFromCsv(parseCsvToRows, flashStatus, () => { resetPage(); renderList(); }));
        batchLookupBtn.addEventListener('click', () => { LtxActor.batchLookupUnfetched(flashStatus); renderList(); });

        modal.querySelector('.ltx-actor-add-btn').addEventListener('click', () => {
            const jName = modal.querySelector('.add-jname').value.trim();
            const kName = modal.querySelector('.add-kname').value.trim();
            const eName = modal.querySelector('.add-ename').value.trim();
            const repName = modal.querySelector('.add-repname').value.trim();
            if (!jName || (!kName && !eName && !repName)) { alert('일본어명과 최소 한 개 이상의 이름을 입력하세요.'); return; }
            LtxActor.actorCache.set(jName, { jName, kName: kName || jName, eName, repName, updatedAt: Date.now() });
            LtxActor.noDataCache.delete(jName); LtxActor.ignoredCache.delete(jName);
            LtxActor.saveActorCache(); LtxActor.saveNoDataCache(); LtxActor.saveIgnoredCache();
            LtxActor.refreshAllDomActorSpans(jName);
            ['.add-jname', '.add-kname', '.add-ename', '.add-repname'].forEach(s => { modal.querySelector(s).value = ''; });
            resetPage(); renderList();
        });

        function renderPagination(total, start, end) {
            footerEl.innerHTML = '';
            if (total === 0) { footerEl.style.display = 'none'; return; }
            footerEl.style.display = 'flex';
            const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
            footerEl.innerHTML = `<span class="ltx-page-info">전체 ${total}명 중 ${start + 1}~${end}명 (${page}/${totalPages}p)</span><div class="ltx-page-controls"><button type="button" class="ltx-mini-btn pg-prev" ${page <= 1 ? 'disabled' : ''}>◀ 이전</button><button type="button" class="ltx-mini-btn save pg-more" ${total - end <= 0 ? 'disabled' : ''}>+${Math.min(PAGE_SIZE, total - end)}명 더 보기</button><button type="button" class="ltx-mini-btn pg-next" ${end >= total ? 'disabled' : ''}>다음 ▶</button></div>`;
            footerEl.querySelector('.pg-prev').addEventListener('click', () => { page--; sliceLimit = PAGE_SIZE; bodyEl.scrollTop = 0; renderList(); });
            footerEl.querySelector('.pg-more').addEventListener('click', () => { sliceLimit += PAGE_SIZE; renderList(); });
            footerEl.querySelector('.pg-next').addEventListener('click', () => { page++; sliceLimit = PAGE_SIZE; bodyEl.scrollTop = 0; renderList(); });
        }

        function renderList() {
            modal.querySelector('[data-tab="cached"]').textContent = `저장된 배우 캐시 (${LtxActor.actorCache.size})`;
            modal.querySelector('[data-tab="nodata"]').textContent = `no-data 스킵 목록 (${LtxActor.noDataCache.size})`;
            modal.querySelector('[data-tab="ignored"]').textContent = `무시된 배우 (${LtxActor.ignoredCache.size})`;
            repBanner.style.display = (filterRep && currentTab === 'cached') ? 'flex' : 'none';
            if (filterRep) modal.querySelector('.ltx-rep-filter-text').textContent = filterRep;

            const qL = rawQuery.toLowerCase(), qC = qL.replace(/\s+/g, ''), useCho = LtxUtil.isChosungQuery(rawQuery);
            bodyEl.innerHTML = '';

            if (currentTab === 'cached') {
                const all = Array.from(LtxActor.actorCache.values());
                let list = all.filter(it => {
                    if (filterRep && (it.repName || '').trim() !== filterRep) return false;
                    if (!rawQuery) return true;
                    return Math.max(LtxUtil.matchStringOrChosung(it.kName, qL, qC, useCho), LtxUtil.matchStringOrChosung(it.eName, qL, qC, false), LtxUtil.matchStringOrChosung(it.jName, qL, qC, false), LtxUtil.matchStringOrChosung(it.repName, qL, qC, useCho)) > 0;
                }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

                filteredJNames = list.map(it => it.jName);
                if (!list.length) { bodyEl.innerHTML = `<div class="ltx-modal-empty">일치하는 배우 캐시가 없습니다.</div>`; updateSelUI(); renderPagination(0, 0, 0); return; }

                const start = (page - 1) * PAGE_SIZE, end = Math.min(list.length, start + sliceLimit);
                const frag = document.createDocumentFragment();
                for (const item of list.slice(start, end)) {
                    const row = document.createElement('div');
                    row.className = 'ltx-actor-row';
                    const rep = (item.repName || '').trim();
                    row.innerHTML = `
                        <input type="checkbox" class="ltx-row-select-chk" data-jname="${LtxUtil.escapeHtml(item.jName)}" ${selected.has(item.jName) ? 'checked' : ''} />
                        <div class="ltx-actor-name-cell">
                            <div class="ltx-actor-jname ${rep ? 'has-rep' : ''} ${rep && item.jName === rep ? 'is-rep-self' : ''}" title="${LtxUtil.escapeHtml(item.jName)}">${LtxUtil.escapeHtml(item.jName)}</div>
                            ${rep ? `<button type="button" class="ltx-actor-rep-tag">↳ ${LtxUtil.escapeHtml(rep)}</button>` : ''}
                        </div>
                        <input type="text" class="ltx-actor-input kname" value="${LtxUtil.escapeHtml(item.kName || '')}" placeholder="한글명" />
                        <input type="text" class="ltx-actor-input ename" value="${LtxUtil.escapeHtml(item.eName || '')}" placeholder="영문명" />
                        <input type="text" class="ltx-actor-input repname" value="${LtxUtil.escapeHtml(item.repName || '')}" placeholder="대표 이름" />
                        <div class="ltx-row-actions">
                            <button type="button" class="ltx-mini-btn save">저장</button>
                            <button type="button" class="ltx-mini-btn refetch">재조회</button>
                            <button type="button" class="ltx-mini-btn danger">삭제</button>
                        </div>
                    `;
                    row.querySelector('.ltx-row-select-chk').addEventListener('change', (e) => { e.target.checked ? selected.add(item.jName) : selected.delete(item.jName); updateSelUI(); });
                    const repBtn = row.querySelector('.ltx-actor-rep-tag');
                    if (repBtn) { const tRep = rep; repBtn.addEventListener('click', () => toggleRepFilter(tRep)); }
                    row.querySelector('.save').addEventListener('click', () => {
                        const k = row.querySelector('.kname').value.trim(), en = row.querySelector('.ename').value.trim(), r = row.querySelector('.repname').value.trim();
                        LtxActor.actorCache.set(item.jName, { jName: item.jName, kName: k || item.jName, eName: en, repName: r, updatedAt: Date.now() });
                        LtxActor.saveActorCache(); LtxActor.refreshAllDomActorSpans(item.jName); renderList();
                    });
                    row.querySelector('.refetch').addEventListener('click', () => { LtxActor.actorCache.delete(item.jName); LtxActor.saveActorCache(); LtxActor.enqueueLookup(item.jName, true); renderList(); });
                    row.querySelector('.danger').addEventListener('click', () => { LtxActor.actorCache.delete(item.jName); LtxActor.saveActorCache(); renderList(); });
                    frag.appendChild(row);
                }
                bodyEl.appendChild(frag); updateSelUI(); renderPagination(list.length, start, end);
            } else if (currentTab === 'nodata') {
                const list = Array.from(LtxActor.noDataCache).filter(n => !rawQuery || LtxUtil.matchStringOrChosung(n, qL, qC, useCho) > 0).sort();
                filteredJNames = list;
                if (!list.length) { bodyEl.innerHTML = `<div class="ltx-modal-empty">no-data 스킵 목록이 비어 있습니다.</div>`; updateSelUI(); renderPagination(0, 0, 0); return; }
                const start = (page - 1) * PAGE_SIZE, end = Math.min(list.length, start + sliceLimit);
                const frag = document.createDocumentFragment();
                for (const jName of list.slice(start, end)) {
                    const row = document.createElement('div');
                    row.className = 'ltx-actor-row';
                    row.innerHTML = `
                        <input type="checkbox" class="ltx-row-select-chk" data-jname="${LtxUtil.escapeHtml(jName)}" ${selected.has(jName) ? 'checked' : ''} />
                        <div class="ltx-actor-name-cell"><div class="ltx-actor-jname-line"><div class="ltx-actor-jname" title="${LtxUtil.escapeHtml(jName)}">${LtxUtil.escapeHtml(jName)}</div><button type="button" class="ltx-jname-copy-btn" title="복사">⧉</button></div></div>
                        <input type="text" class="ltx-actor-input kname" placeholder="한글명" />
                        <input type="text" class="ltx-actor-input ename" placeholder="영문명" />
                        <input type="text" class="ltx-actor-input repname" placeholder="대표 이름" />
                        <div class="ltx-row-actions"><button type="button" class="ltx-mini-btn save">저장</button><button type="button" class="ltx-mini-btn refetch">재조회</button><button type="button" class="ltx-mini-btn ignore">무시</button><button type="button" class="ltx-mini-btn danger">해제</button></div>
                    `;
                    row.querySelector('.ltx-row-select-chk').addEventListener('change', (e) => { e.target.checked ? selected.add(jName) : selected.delete(jName); updateSelUI(); });
                    row.querySelector('.ltx-jname-copy-btn').addEventListener('click', () => LtxUtil.copyText(jName));
                    row.querySelector('.save').addEventListener('click', () => {
                        const k = row.querySelector('.kname').value.trim(), en = row.querySelector('.ename').value.trim(), r = row.querySelector('.repname').value.trim();
                        if (!k && !en && !r) return;
                        LtxActor.actorCache.set(jName, { jName, kName: k || jName, eName: en, repName: r, updatedAt: Date.now() });
                        LtxActor.noDataCache.delete(jName); LtxActor.saveActorCache(); LtxActor.saveNoDataCache(); LtxActor.refreshAllDomActorSpans(jName); renderList();
                    });
                    row.querySelector('.refetch').addEventListener('click', () => { LtxActor.noDataCache.delete(jName); LtxActor.saveNoDataCache(); LtxActor.enqueueLookup(jName, true); renderList(); });
                    row.querySelector('.ignore').addEventListener('click', () => { LtxActor.noDataCache.delete(jName); LtxActor.ignoredCache.add(jName); LtxActor.saveNoDataCache(); LtxActor.saveIgnoredCache(); renderList(); });
                    row.querySelector('.danger').addEventListener('click', () => { LtxActor.noDataCache.delete(jName); LtxActor.saveNoDataCache(); renderList(); });
                    frag.appendChild(row);
                }
                bodyEl.appendChild(frag); updateSelUI(); renderPagination(list.length, start, end);
            } else {
                const list = Array.from(LtxActor.ignoredCache).filter(n => !rawQuery || LtxUtil.matchStringOrChosung(n, qL, qC, useCho) > 0).sort((a, b) => {
                    if (sortMode === 'count-desc') return (LtxActor.actorCountsMap.get(b) || 0) - (LtxActor.actorCountsMap.get(a) || 0) || a.localeCompare(b);
                    if (sortMode === 'count-asc') return (LtxActor.actorCountsMap.get(a) || 0) - (LtxActor.actorCountsMap.get(b) || 0) || a.localeCompare(b);
                    return a.localeCompare(b);
                });
                filteredJNames = list;
                if (!list.length) { bodyEl.innerHTML = `<div class="ltx-modal-empty">무시된 배우 목록이 비어 있습니다.</div>`; updateSelUI(); renderPagination(0, 0, 0); return; }
                const start = (page - 1) * PAGE_SIZE, end = Math.min(list.length, start + sliceLimit);
                const frag = document.createDocumentFragment();
                for (const jName of list.slice(start, end)) {
                    const row = document.createElement('div');
                    row.className = 'ltx-ignored-row';
                    row.innerHTML = `
                        <div class="ltx-ignored-left">
                            <input type="checkbox" class="ltx-row-select-chk" data-jname="${LtxUtil.escapeHtml(jName)}" ${selected.has(jName) ? 'checked' : ''} />
                            <div class="ltx-actor-jname ignored">${LtxUtil.escapeHtml(jName)}</div>
                            <span class="ltx-koen-card-count">${LtxActor.actorCountsMap.get(jName) ?? 0}건</span>
                        </div>
                        <div class="ltx-row-actions"><button type="button" class="ltx-mini-btn refetch">재조회</button><button type="button" class="ltx-mini-btn save">무시 해제</button></div>
                    `;
                    row.querySelector('.ltx-row-select-chk').addEventListener('change', (e) => { e.target.checked ? selected.add(jName) : selected.delete(jName); updateSelUI(); });
                    row.querySelector('.refetch').addEventListener('click', () => { LtxActor.ignoredCache.delete(jName); LtxActor.saveIgnoredCache(); LtxActor.enqueueLookup(jName, true); renderList(); });
                    row.querySelector('.save').addEventListener('click', () => { LtxActor.ignoredCache.delete(jName); LtxActor.noDataCache.add(jName); LtxActor.saveIgnoredCache(); LtxActor.saveNoDataCache(); renderList(); });
                    frag.appendChild(row);
                }
                bodyEl.appendChild(frag); updateSelUI(); renderPagination(list.length, start, end);
            }
        }

        LtxUI.refreshActorModal = () => { if (document.body.contains(backdrop)) renderList(); };
        renderList();
    }

    function openExtSitesManagerModal() {
        let editingId = null;
        const { modal } = LtxUI.createModal({
            title: '외부 검색 사이트 관리 (extLink)',
            badgeHtml: `<span class="ltx-ext-limit-badge">(${LtxCard.getExtSites().length}/${LtxCard.MAX_EXT_SITES})</span>`,
            innerHtml: `
                <div class="ltx-ext-form">
                    <div class="ltx-ext-form-row">
                        <input type="text" class="ltx-ext-name-input" placeholder="사이트 이름 (16자 초과 시 ... 표기)" />
                        <input type="text" class="ltx-ext-url-input" placeholder="코드검색주소 (예: https://example.com/search?q={code})" />
                        <button type="button" class="ltx-modal-action-btn primary ltx-ext-submit-btn">추가</button>
                        <button type="button" class="ltx-modal-action-btn ltx-ext-cancel-btn" style="display:none;">취소</button>
                    </div>
                    <div class="ltx-ext-form-help">※ 최대 <strong>18개</strong>까지 등록 가능. URI에 검색 키워드가 들어갈 곳에 {code} 삽입.</div>
                </div>
                <div class="ltx-modal-body"></div>
            `
        });

        const nameInput = modal.querySelector('.ltx-ext-name-input');
        const urlInput = modal.querySelector('.ltx-ext-url-input');
        const submitBtn = modal.querySelector('.ltx-ext-submit-btn');
        const cancelBtn = modal.querySelector('.ltx-ext-cancel-btn');
        const bodyEl = modal.querySelector('.ltx-modal-body');

        const resetForm = () => { editingId = null; nameInput.value = ''; urlInput.value = ''; submitBtn.textContent = '추가'; cancelBtn.style.display = 'none'; };
        cancelBtn.addEventListener('click', resetForm);

        submitBtn.addEventListener('click', () => {
            const name = nameInput.value.trim(), urlTemplate = urlInput.value.trim();
            if (!name || !/^https?:\/\//i.test(urlTemplate)) { alert('사이트 이름과 올바른 URL을 입력해 주세요.'); return; }
            const sites = LtxCard.getExtSites();
            if (editingId) {
                const idx = sites.findIndex(s => s.id === editingId);
                if (idx !== -1) sites[idx] = { ...sites[idx], name, urlTemplate };
            } else {
                if (sites.length >= LtxCard.MAX_EXT_SITES) { alert(`최대 ${LtxCard.MAX_EXT_SITES}개까지만 등록할 수 있습니다.`); return; }
                sites.push({ id: `ext_${Date.now()}`, name, urlTemplate });
            }
            LtxCard.setExtSites(sites);
            resetForm(); renderSites();
        });

        function renderSites() {
            const sites = LtxCard.getExtSites();
            modal.querySelector('.ltx-ext-limit-badge').textContent = `(${sites.length}/${LtxCard.MAX_EXT_SITES})`;
            bodyEl.innerHTML = sites.length ? '' : `<div class="ltx-modal-empty">등록된 외부 검색 사이트가 없습니다.</div>`;
            sites.forEach((site, idx) => {
                const row = document.createElement('div');
                row.className = 'ltx-ext-site-row';
                row.innerHTML = `
                    <div class="ltx-ext-site-info"><div class="ltx-ext-site-title">${idx + 1}. ${LtxUtil.escapeHtml(site.name)}</div><div class="ltx-ext-site-url">${LtxUtil.escapeHtml(site.urlTemplate)}</div></div>
                    <div class="ltx-row-actions">
                        <button type="button" class="ltx-mini-btn up" ${idx === 0 ? 'disabled' : ''}>▲</button>
                        <button type="button" class="ltx-mini-btn down" ${idx === sites.length - 1 ? 'disabled' : ''}>▼</button>
                        <button type="button" class="ltx-mini-btn edit">수정</button>
                        <button type="button" class="ltx-mini-btn danger">삭제</button>
                    </div>
                `;
                row.querySelector('.up').addEventListener('click', () => { [sites[idx - 1], sites[idx]] = [sites[idx], sites[idx - 1]]; LtxCard.setExtSites(sites); renderSites(); });
                row.querySelector('.down').addEventListener('click', () => { [sites[idx + 1], sites[idx]] = [sites[idx], sites[idx + 1]]; LtxCard.setExtSites(sites); renderSites(); });
                row.querySelector('.edit').addEventListener('click', () => { editingId = site.id; nameInput.value = site.name; urlInput.value = site.urlTemplate; submitBtn.textContent = '수정 저장'; cancelBtn.style.display = 'inline-flex'; });
                row.querySelector('.danger').addEventListener('click', () => { LtxCard.setExtSites(sites.filter(s => s.id !== site.id)); if (editingId === site.id) resetForm(); renderSites(); });
                bodyEl.appendChild(row);
            });
        }
        renderSites();
    }

    function openIdbAuditModal() {
        let filterType = 'all_missing', query = '';
        const selectedCodes = new Set();

        const { modal } = LtxUI.createModal({
            title: 'IndexedDB 작품 데이터 점검 및 정리',
            badgeHtml: `<span class="ltx-ext-limit-badge" id="idb-total-badge">(총 ${LtxIDB.items.size}편)</span>`,
            fixedHeight: true,
            innerHtml: `
                <div class="ltx-modal-tabs" id="idb-audit-tabs">
                    <button type="button" class="ltx-modal-tab active" data-filter="all_missing">전체 누락</button>
                    <button type="button" class="ltx-modal-tab" data-filter="no_link">link 누락</button>
                    <button type="button" class="ltx-modal-tab" data-filter="no_actors">actors 누락</button>
                    <button type="button" class="ltx-modal-tab" data-filter="no_cover">cover 누락</button>
                </div>
                <div class="ltx-modal-toolbar">
                    <input type="text" class="ltx-modal-search" id="idb-audit-search" placeholder="품번(code) 또는 제목 검색…" />
                    <button type="button" class="ltx-modal-action-btn warning" id="idb-del-sel">선택 삭제 (<span id="idb-sel-cnt">0</span>)</button>
                    <button type="button" class="ltx-modal-action-btn danger" id="idb-del-all" style="color:#f87171;">현재 필터 전체 삭제</button>
                </div>
                <div class="ltx-modal-body" id="idb-audit-body"></div>
            `
        });

        const bodyEl = modal.querySelector('#idb-audit-body');
        const selCntEl = modal.querySelector('#idb-sel-cnt');
        let currentFiltered = [];

        function renderAudit() {
            const stats = { no_link: [], no_actors: [], no_cover: [], all_missing: [] };
            for (const item of LtxIDB.items.values()) {
                if (!item?.code) continue;
                const ml = !item.link || !String(item.link).trim();
                const ma = !Array.isArray(item.actors) || item.actors.length === 0;
                const mc = !item.cover || !String(item.cover).trim();
                if (ml) stats.no_link.push(item);
                if (ma) stats.no_actors.push(item);
                if (mc) stats.no_cover.push(item);
                if (ml || ma || mc) stats.all_missing.push({ item, ml, ma, mc });
            }

            modal.querySelector('#idb-total-badge').textContent = `(총 ${LtxIDB.items.size}편)`;
            modal.querySelectorAll('.ltx-modal-tab').forEach(t => {
                const f = t.dataset.filter;
                t.textContent = `${f === 'all_missing' ? '전체 누락' : f === 'no_link' ? 'link 누락' : f === 'no_actors' ? 'actors 누락' : 'cover 누락'} (${stats[f].length})`;
            });

            let pool = stats.all_missing;
            if (filterType === 'no_link') pool = pool.filter(x => x.ml);
            if (filterType === 'no_actors') pool = pool.filter(x => x.ma);
            if (filterType === 'no_cover') pool = pool.filter(x => x.mc);
            if (query) {
                const q = query.toLowerCase();
                pool = pool.filter(x => String(x.item.code).toLowerCase().includes(q) || String(x.item.title || '').toLowerCase().includes(q));
            }
            currentFiltered = pool;
            selCntEl.textContent = String(selectedCodes.size);
            bodyEl.innerHTML = pool.length ? '' : `<div class="ltx-modal-empty">누락된 작품 데이터가 없습니다.</div>`;

            const frag = document.createDocumentFragment();
            for (const { item, ml, ma, mc } of pool.slice(0, 100)) {
                const tags = [ml && 'link 없음', ma && 'actors 없음', mc && 'cover 없음'].filter(Boolean);
                const row = document.createElement('div');
                row.className = 'ltx-ext-site-row';
                row.innerHTML = `
                    <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
                        <input type="checkbox" class="ltx-row-select-chk" ${selectedCodes.has(item.code) ? 'checked' : ''} />
                        <div class="ltx-ext-site-info"><div class="ltx-ext-site-title">${LtxUtil.escapeHtml(item.code)} <span style="color:#fbbf24;font-size:0.75rem;">[${tags.join(' · ')}]</span></div><div class="ltx-ext-site-url">${LtxUtil.escapeHtml(item.title || '(제목 없음)')}</div></div>
                    </div>
                    <button type="button" class="ltx-mini-btn danger">DB 삭제</button>
                `;
                row.querySelector('.ltx-row-select-chk').addEventListener('change', (e) => { e.target.checked ? selectedCodes.add(item.code) : selectedCodes.delete(item.code); selCntEl.textContent = String(selectedCodes.size); });
                row.querySelector('.danger').addEventListener('click', async () => { await LtxIDB.deleteCodes([item.code]); selectedCodes.delete(item.code); updateMainButtonCounter(); renderAudit(); });
                frag.appendChild(row);
            }
            bodyEl.appendChild(frag);
        }

        modal.querySelectorAll('.ltx-modal-tab').forEach(t => t.addEventListener('click', () => {
            filterType = t.dataset.filter; selectedCodes.clear();
            modal.querySelectorAll('.ltx-modal-tab').forEach(b => b.classList.toggle('active', b === t));
            renderAudit();
        }));
        modal.querySelector('#idb-audit-search').addEventListener('input', (e) => { query = e.target.value.trim(); renderAudit(); });
        modal.querySelector('#idb-del-sel').addEventListener('click', async () => {
            if (!selectedCodes.size || !confirm(`선택한 ${selectedCodes.size}건을 삭제하시겠습니까?`)) return;
            await LtxIDB.deleteCodes(Array.from(selectedCodes)); selectedCodes.clear(); updateMainButtonCounter(); renderAudit();
        });
        modal.querySelector('#idb-del-all').addEventListener('click', async () => {
            if (!currentFiltered.length || !confirm(`현재 필터의 ${currentFiltered.length}건 전체를 삭제하시겠습니까?`)) return;
            await LtxIDB.deleteCodes(currentFiltered.map(x => x.item.code)); selectedCodes.clear(); updateMainButtonCounter(); renderAudit();
        });
        renderAudit();
    }

    function openActorKoEnSearchModal(targetInput) {
        const resolvedInput = targetInput || document.querySelector('.side .head input[type="search"], .search-wrap input[type="search"]');
        let selectedIndex = 0, currentMatches = [], insertMode = LtxActor.getSearchInsertMode();

        const { modal } = LtxUI.createModal({
            title: '한글 / 영문 / 초성 배우 검색',
            badgeHtml: '<span class="ltx-shortcut-hint">(Ctrl+K)</span>',
            narrow: true,
            innerHtml: `
                <div class="ltx-koen-mode-bar">
                    <span class="ltx-koen-mode-label">대표 이름 보유 배우 선택 시 입력 방식:</span>
                    <div class="ltx-koen-mode-group">
                        <button type="button" class="ltx-koen-mode-btn ${insertMode === 'rep' ? 'active' : ''}" data-mode="rep">대표 이름 입력</button>
                        <button type="button" class="ltx-koen-mode-btn ${insertMode === 'individual' ? 'active' : ''}" data-mode="individual">개별 이름 입력</button>
                    </div>
                </div>
                <div class="ltx-modal-toolbar">
                    <input type="text" class="ltx-modal-search ltx-koen-search-input" placeholder="한글, 초성(ㅅㅋㅁㅊ), 영문, 일본어, 대표이름 검색… (${LtxActor.actorCache.size}명)" />
                </div>
                <div class="ltx-modal-body ltx-koen-results"></div>
            `
        });

        const searchInput = modal.querySelector('.ltx-koen-search-input');
        const resultsEl = modal.querySelector('.ltx-koen-results');

        modal.querySelectorAll('.ltx-koen-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                insertMode = btn.dataset.mode;
                LtxActor.setSearchInsertMode(insertMode);
                LtxCard.injectAliasActorCards(openListPickerModal, flashStatus);
                modal.querySelectorAll('.ltx-koen-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === insertMode));
                renderAutocomplete(); searchInput.focus();
            });
        });

        function selectActorAndClose(item) {
            if (!item) return;
            const rep = (item.repName || '').trim();
            const val = (insertMode === 'rep' && rep) ? rep : item.jName;
            LtxUI.closeActiveModal();
            if (!resolvedInput) return;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            setter ? setter.call(resolvedInput, val) : (resolvedInput.value = val);
            resolvedInput.dispatchEvent(new Event('input', { bubbles: true }));
            resolvedInput.dispatchEvent(new Event('change', { bubbles: true }));
            requestAnimationFrame(() => resolvedInput.focus());
        }

        function renderAutocomplete() {
            const raw = searchInput.value.trim(), qL = raw.toLowerCase(), qC = qL.replace(/\s+/g, ''), useCho = LtxUtil.isChosungQuery(raw);
            resultsEl.innerHTML = '';
            const all = Array.from(LtxActor.actorCache.values());
            if (!all.length) { resultsEl.innerHTML = `<div class="ltx-modal-empty">저장된 배우 캐시가 없습니다.</div>`; currentMatches = []; return; }

            if (!raw) {
                currentMatches = all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 30);
            } else {
                const scoreMap = new Map(), matchedReps = new Set();
                for (const it of all) {
                    const score = Math.max(LtxUtil.matchStringOrChosung(it.kName, qL, qC, useCho), LtxUtil.matchStringOrChosung(it.eName, qL, qC, false), LtxUtil.matchStringOrChosung(it.jName, qL, qC, false), LtxUtil.matchStringOrChosung(it.repName, qL, qC, useCho));
                    if (score > 0) {
                        scoreMap.set(it.jName, { item: it, score });
                        if (it.repName?.trim()) matchedReps.add(it.repName.trim());
                    }
                }
                if (matchedReps.size > 0) {
                    for (const it of all) {
                        const r = (it.repName || '').trim();
                        if (r && matchedReps.has(r) && !scoreMap.has(it.jName)) scoreMap.set(it.jName, { item: it, score: 35 });
                    }
                }
                currentMatches = Array.from(scoreMap.values()).sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0)).slice(0, 60).map(s => s.item);
            }

            if (!currentMatches.length) { resultsEl.innerHTML = `<div class="ltx-modal-empty">일치하는 배우가 없습니다.</div>`; return; }
            if (selectedIndex >= currentMatches.length) selectedIndex = 0;

            const frag = document.createDocumentFragment();
            currentMatches.forEach((item, idx) => {
                const rep = (item.repName || '').trim();
                const repBadge = rep ? LtxActor.formatRepBadgeLabel(rep) : '';
                const cnt = LtxActor.actorCountsMap.get(item.jName) ?? 0;
                const row = document.createElement('button');
                row.type = 'button';
                row.className = `ltx-koen-item ${idx === selectedIndex ? 'selected' : ''}`;
                row.innerHTML = `
                    <div class="ltx-koen-main">
                        <span class="ltx-koen-kname">${LtxUtil.escapeHtml(item.kName || item.jName)}</span>
                        ${item.eName ? `<span class="ltx-koen-ename">(${LtxUtil.escapeHtml(item.eName)})</span>` : ''}
                        ${repBadge ? `<span class="ltx-koen-rep-badge ${insertMode === 'rep' ? 'active-target' : ''}">${LtxUtil.escapeHtml(repBadge)}</span>` : ''}
                    </div>
                    <div class="ltx-koen-right">
                        <span class="ltx-koen-jname ${rep && item.jName === rep ? 'is-rep-self' : ''} ${insertMode === 'individual' || !rep ? 'active-target' : ''}">${LtxUtil.escapeHtml(item.jName)}</span>
                        <span class="ltx-koen-card-count">${cnt}건</span>
                    </div>
                `;
                row.addEventListener('mouseenter', () => { selectedIndex = idx; resultsEl.querySelectorAll('.ltx-koen-item').forEach((el, i) => el.classList.toggle('selected', i === selectedIndex)); });
                row.addEventListener('click', () => selectActorAndClose(item));
                frag.appendChild(row);
            });
            resultsEl.appendChild(frag);
        }

        searchInput.addEventListener('input', () => { selectedIndex = 0; renderAutocomplete(); });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && currentMatches.length) { e.preventDefault(); selectedIndex = (selectedIndex + 1) % currentMatches.length; renderAutocomplete(); }
            else if (e.key === 'ArrowUp' && currentMatches.length) { e.preventDefault(); selectedIndex = (selectedIndex - 1 + currentMatches.length) % currentMatches.length; renderAutocomplete(); }
            else if (e.key === 'Enter' && currentMatches[selectedIndex]) { e.preventDefault(); selectActorAndClose(currentMatches[selectedIndex]); }
        });
        renderAutocomplete();
        requestAnimationFrame(() => searchInput.focus());
    }

    async function openListPickerModal(code) {
        const clientId = localStorage.getItem('ltx.client') || '';
        const editKeys = LtxUtil.store.get('ltx.lists.keys', {});
        const ownedIndex = LtxUtil.store.get('ltx.lists.ownedIndex', {});

        const { modal } = LtxUI.createModal({
            title: '리스트에 추가',
            badgeHtml: `<span class="ltx-shortcut-hint">${LtxUtil.escapeHtml(code)}</span>`,
            narrow: true,
            innerHtml: `<div class="ltx-modal-body"><div class="ltx-modal-empty">내 리스트 불러오는 중…</div></div>`
        });
        const bodyEl = modal.querySelector('.ltx-modal-body');

        try {
            const qp = new URLSearchParams({ scope: 'mine', limit: '50', code, client: clientId });
            const headers = { Accept: 'application/json' };
            const keys = Object.entries(editKeys).slice(0, 60);
            if (keys.length) headers['X-LTX-Edit-Keys'] = JSON.stringify(Object.fromEntries(keys));

            const res = await fetch(`/api/lists?${qp.toString()}`, { headers, credentials: 'include' });
            const lists = (await res.json())?.items || [];
            bodyEl.innerHTML = lists.length ? '' : `<div class="ltx-modal-empty">생성된 내 리스트가 없습니다.</div>`;

            for (const list of lists) {
                let contains = list.probe?.code === code ? Boolean(list.probe.contains) : Array.isArray(ownedIndex[list.id]) && ownedIndex[list.id].includes(code);
                const row = document.createElement('button');
                row.type = 'button';
                row.className = `ltx-koen-item ${contains ? 'selected' : ''}`;
                row.innerHTML = `<div class="ltx-koen-main"><span class="ltx-koen-kname">${contains ? '✓ ' : ''}${LtxUtil.escapeHtml(list.title)}</span></div><span class="ltx-koen-card-count">${list.itemCount || 0}편</span>`;
                row.addEventListener('click', async () => {
                    row.disabled = true;
                    try {
                        const r = await fetch('/api/lists/items', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ id: list.id, code, action: contains ? 'remove' : 'add', client: clientId, editKey: editKeys[list.id] })
                        });
                        if (r.ok) {
                            contains = !contains;
                            list.itemCount = Math.max(0, (list.itemCount || 0) + (contains ? 1 : -1));
                            row.classList.toggle('selected', contains);
                            row.querySelector('.ltx-koen-kname').textContent = `${contains ? '✓ ' : ''}${list.title}`;
                            row.querySelector('.ltx-koen-card-count').textContent = `${list.itemCount}편`;
                            const set = new Set(Array.isArray(ownedIndex[list.id]) ? ownedIndex[list.id] : []);
                            contains ? set.add(code) : set.delete(code);
                            ownedIndex[list.id] = Array.from(set);
                            LtxUtil.store.set('ltx.lists.ownedIndex', ownedIndex);
                        }
                    } finally { row.disabled = false; }
                });
                bodyEl.appendChild(row);
            }
        } catch (e) {
            bodyEl.innerHTML = `<div class="ltx-modal-empty">리스트 목록을 불러오지 못했습니다.</div>`;
        }
    }

    /* ==========================================================================
     * 4. 헤더 컨트롤 마운트, 검색창 "한/EN" 버튼 및 DOM 감시자
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
            btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openActorKoEnSearchModal(input); });
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
        addMenuItem('자동 스크롤 (완료 시 자동 저장)', () => {
            if (isAutoScrolling) { toggleAutoScroll(); return; }
            if (location.hostname === 'ltxlib.dpdns.org' && location.pathname === '/' && !location.search) { toggleAutoScroll(); return; }
            sessionStorage.setItem(PENDING_AUTOSCROLL_KEY, '1');
            location.href = 'https://ltxlib.dpdns.org/';
        }, 'ltx-menu-autoscroll-label');
        addDivider();
        addMenuItem('JSON 파일 병합', handleMergeJsonFiles);
        addMenuItem('CSV 파일 병합', handleMergeCsvFiles);
        addDivider();
        addMenuItem(`외부 사이트 관리 (${LtxCard.getExtSites().length}/${LtxCard.MAX_EXT_SITES})`, openExtSitesManagerModal, 'ltx-ext-sites-count');
        addMenuItem('IndexedDB 누락 데이터 점검/정리', openIdbAuditModal);
        addDivider();
        addMenuItem(`배우 캐시 / 스킵 관리 (${LtxActor.actorCache.size} / ${LtxActor.noDataCache.size})`, () => openActorManagerModal('cached'), 'ltx-actor-manage-label');
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
        LtxCard.injectAliasActorCards(openListPickerModal, flashStatus);
        document.querySelectorAll('article.card:not([data-processed="true"])').forEach(LtxCard.modifyCard);
        document.querySelectorAll(LtxActor.ACTOR_SPAN_SELECTOR).forEach(LtxActor.bindActorSpan);
        LtxActor.refreshAllTagNames();
        LtxCard.syncBarStatsAndActions(flashStatus);
        LtxCard.syncHeaderWantCounter();
    }

    function init() {
        if (typeof GM_getResourceText === 'function' && typeof GM_addStyle === 'function') {
            GM_addStyle(GM_getResourceText('LTX_CSS'));
        }
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
                openActorKoEnSearchModal();
            }
        }, true);

        const onRoute = () => requestAnimationFrame(runEnhancements);
        const origPush = history.pushState;
        history.pushState = function(...a) { const r = origPush.apply(this, a); onRoute(); return r; };
        const origReplace = history.replaceState;
        history.replaceState = function(...a) { const r = origReplace.apply(this, a); onRoute(); return r; };
        window.addEventListener('popstate', onRoute);
        window.addEventListener('hashchange', onRoute);

        let scheduled = false;
        new MutationObserver(() => {
            if (LtxUI.isModalOpen || scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => { runEnhancements(); scheduled = false; });
        }).observe(document.body, { childList: true, subtree: true });
		
		// 페이지 전역 window에 디버깅 헬퍼 노출 (콘솔 컨텍스트 전환 불필요)
        const targetWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        targetWin.LtxDebug = {
            modules: { LtxUtil, LtxIDB, LtxActor, LtxCard, LtxUI },
            status() {
                const injectedCards = document.querySelectorAll('article.card[data-ltx-alias-injected="true"]').length;
                const totalCards = document.querySelectorAll('article.card').length;
                const summary = {
                    'LtxUtil (공용 유틸)': { 상태: typeof LtxUtil === 'object' ? '✅ 정상' : '❌ 누락', 상세: 'store / copyText / chosung 활성' },
                    'LtxIDB (IndexedDB)': { 상태: typeof LtxIDB === 'object' ? '✅ 정상' : '❌ 누락', 상세: `누적 작품 ${LtxIDB.items.size}편 (현재 총합 ${latestTotal}편)` },
                    'LtxActor (AVDBS 배우)': { 상태: typeof LtxActor === 'object' ? '✅ 정상' : '❌ 누락', 상세: `캐시 ${LtxActor.actorCache.size}명 / 스킵 ${LtxActor.noDataCache.size}명 / 무시 ${LtxActor.ignoredCache.size}명` },
                    'LtxCard (카드·찜·외부)': { 상태: typeof LtxCard === 'object' ? '✅ 정상' : '❌ 누락', 상세: `외부사이트 ${LtxCard.getExtSites().length}개 / 통합찜 ${LtxCard.getMergedWantSet().size}편 / 모드 [${LtxActor.getSearchInsertMode()}]` },
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
                const key = LtxUtil.normalizeCode(code);
                return LtxIDB.items.get(key) || null;
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

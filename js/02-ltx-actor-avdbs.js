/* ==========================================================================
 * MODULE 2: AVDBS 배우 캐시/조회 큐, 선택 백업·복원·초기화 및 점검 모달 (LtxActor)
 * ========================================================================== */
const LtxActor = (() => {
    const ACTOR_CACHE_KEY = 'ltx_avdbs_actor_cache_v1';
    const NODATA_CACHE_KEY = 'ltx_avdbs_nodata_cache_v1';
    const IGNORED_CACHE_KEY = 'ltx_avdbs_ignored_cache_v1';
    const ACTOR_NAV_COUNT_CACHE_KEY = 'ltx_actor_nav_count_cache_v1';
    const SEARCH_INSERT_MODE_KEY = 'ltx_koen_insert_mode_v1';
    const REQUEST_INTERVAL_MS = 850;
    const ACTOR_SPAN_SELECTOR = 'span.name[lang="ja"], div.actor-tools span[lang]';

    const actorCache = new Map();
    const noDataCache = new Set();
    const ignoredCache = new Set();
    const actorCountsMap = new Map();

    const pendingQueue = [];
    const queuedSet = new Set();
    let isQueueRunning = false;
    let activeLookupName = null;

    // 초기 캐시 마이그레이션 및 로드
    (() => {
        const rawIgnored = LtxUtil.store.get(IGNORED_CACHE_KEY, []);
        if (Array.isArray(rawIgnored)) {
            rawIgnored.forEach(n => { if (typeof n === 'string' && n.trim()) ignoredCache.add(n.trim()); });
        }

        const rawNoData = LtxUtil.store.get(NODATA_CACHE_KEY, []);
        if (Array.isArray(rawNoData)) {
            rawNoData.forEach(n => {
                const clean = String(n || '').trim();
                if (clean && !ignoredCache.has(clean)) noDataCache.add(clean);
            });
        } else if (rawNoData && typeof rawNoData === 'object') {
            Object.keys(rawNoData).forEach(k => {
                const clean = k.trim();
                if (clean && !ignoredCache.has(clean)) noDataCache.add(clean);
            });
            saveNoDataCache();
        }

        const rawActor = LtxUtil.store.get(ACTOR_CACHE_KEY, null);
        if (rawActor && typeof rawActor === 'object') {
            const entries = (rawActor.actors && typeof rawActor.actors === 'object')
                ? Object.entries(rawActor.actors)
                : Object.entries(rawActor);
            for (const [key, val] of entries) {
                if (!val || typeof val !== 'object') continue;
                const jName = String(val.jName || key || '').trim();
                if (!jName) continue;
                const kName = String(val.kName || '').trim();
                const eName = String(val.eName || '').trim();
                const repName = String(val.repName || '').trim();
                if (val.notFound || ((!kName || kName === jName) && !eName && !repName)) {
                    if (!ignoredCache.has(jName)) noDataCache.add(jName);
                    continue;
                }
                actorCache.set(jName, {
                    jName,
                    kName: kName || jName,
                    eName,
                    repName,
                    updatedAt: typeof val.updatedAt === 'number' ? val.updatedAt : Date.now()
                });
                noDataCache.delete(jName);
                ignoredCache.delete(jName);
            }
        }

        const rawCounts = LtxUtil.store.get(ACTOR_NAV_COUNT_CACHE_KEY, {});
        if (rawCounts && typeof rawCounts === 'object') {
            for (const [jName, cnt] of Object.entries(rawCounts)) {
                const clean = jName.trim();
                const num = Number(cnt);
                if (clean && Number.isFinite(num) && num >= 0) actorCountsMap.set(clean, num);
            }
        }
    })();

    function getSearchInsertMode() {
        const saved = localStorage.getItem(SEARCH_INSERT_MODE_KEY);
        return (saved === 'individual' || saved === 'rep') ? saved : 'rep';
    }

    function setSearchInsertMode(mode) {
        try { localStorage.setItem(SEARCH_INSERT_MODE_KEY, mode); } catch (e) {}
    }

    function formatRepBadgeLabel(repName) {
        const cleanRep = String(repName || '').trim();
        if (!cleanRep) return '';
        const repEntry = actorCache.get(cleanRep);
        return (repEntry && repEntry.kName && repEntry.kName !== cleanRep)
            ? `대표: ${cleanRep}(${repEntry.kName})`
            : `대표: ${cleanRep}`;
    }

    function saveActorCache() {
        const obj = {};
        for (const [k, v] of actorCache.entries()) {
            if (v && !v.notFound) obj[k] = { ...v, updatedAt: v.updatedAt || Date.now() };
        }
        LtxUtil.store.set(ACTOR_CACHE_KEY, obj);
        updateStatsUI();
        refreshAllTagNames();
    }

    function saveNoDataCache() {
        LtxUtil.store.set(NODATA_CACHE_KEY, Array.from(noDataCache));
        updateStatsUI();
    }

    function saveIgnoredCache() {
        LtxUtil.store.set(IGNORED_CACHE_KEY, Array.from(ignoredCache));
        updateStatsUI();
    }

    function saveActorCountsMap() {
        LtxUtil.store.set(ACTOR_NAV_COUNT_CACHE_KEY, Object.fromEntries(actorCountsMap.entries()));
    }

    function syncActorCountsFromApi(actorCounts) {
        if (!Array.isArray(actorCounts) || actorCounts.length === 0) return;
        let changed = false;
        for (const entry of actorCounts) {
            if (!Array.isArray(entry) || entry.length < 2) continue;
            const jName = String(entry[0] || '').trim();
            const count = Number(entry[1]);
            if (jName && Number.isFinite(count) && count >= 0 && actorCountsMap.get(jName) !== count) {
                actorCountsMap.set(jName, count);
                changed = true;
            }
        }
        if (changed) {
            saveActorCountsMap();
            if (typeof LtxUI.refreshActorModal === 'function') LtxUI.refreshActorModal();
        }
    }

    function updateStatsUI() {
        const manageLabel = document.querySelector('.ltx-actor-manage-label');
        if (manageLabel) manageLabel.textContent = `배우 캐시 / 스킵 관리 (${actorCache.size} / ${noDataCache.size})`;

        const cacheCountLabel = document.querySelector('.ltx-actor-cache-count');
        if (cacheCountLabel && typeof LtxCard !== 'undefined') {
            cacheCountLabel.textContent = `캐시·설정 백업 (${actorCache.size}명 / ${LtxCard.getExtSites().length}개)`;
        }

        const skipCountLabel = document.querySelector('.ltx-actor-batch-label');
        if (skipCountLabel) skipCountLabel.textContent = `미조회 배우 일괄 조회 (스킵 ${noDataCache.size}명)`;
    }

    function updateQueueIndicator() {
        const badge = document.querySelector('.ltx-avdbs-queue-badge');
        if (!badge) return;
        const remaining = pendingQueue.length + (activeLookupName ? 1 : 0);
        if (remaining > 0) {
            badge.textContent = `AVDBS 대기 ${remaining}건`;
            badge.title = activeLookupName ? `조회 중: ${activeLookupName} (남은 대기: ${remaining}건)` : `AVDBS 대기: ${remaining}건`;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
            badge.textContent = '';
        }
    }

    function fetchAvdbsHtml(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    headers: { 'Accept': 'text/html,*/*;q=0.8', 'Referer': 'https://www.avdbs.com/' },
                    timeout: 12000,
                    onload: (res) => (res.status >= 200 && res.status < 300) ? resolve(res.responseText) : reject(new Error(`HTTP ${res.status}`)),
                    onerror: () => reject(new Error('네트워크 오류')),
                    ontimeout: () => reject(new Error('시간 초과'))
                });
            } else {
                fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); }).then(resolve).catch(reject);
            }
        });
    }

    function parseAvdbsActorHtml(html, jName) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        if (doc.querySelector('div.no-data')) return null;

        const kNodes = Array.from(doc.querySelectorAll('p.k_name'));
        const eNodes = Array.from(doc.querySelectorAll('p.e_name'));
        if (kNodes.length === 0 && eNodes.length === 0) return null;

        let targetIdx = 0;
        for (let i = 0; i < eNodes.length; i++) {
            const redSpan = eNodes[i].querySelector('span.red');
            if (redSpan && redSpan.textContent.trim() === jName) { targetIdx = i; break; }
        }

        const kEl = kNodes[targetIdx] || kNodes[0];
        const eEl = eNodes[targetIdx] || eNodes[0];
        if (!kEl && !eEl) return null;

        let kName = kEl ? (kEl.querySelector('a')?.textContent || kEl.textContent).trim() : '';
        let eName = '';
        if (eEl) {
            const fullText = (eEl.querySelector('a')?.textContent || eEl.textContent).trim();
            const parenIdx = fullText.indexOf('(');
            eName = (parenIdx !== -1 ? fullText.slice(0, parenIdx) : fullText).trim();
        }
        if (!kName && !eName) return null;

        const existing = actorCache.get(jName);
        return { jName, kName: kName || jName, eName, repName: existing?.repName || '', updatedAt: Date.now() };
    }

    async function queryActorFromAvdbs(jName, retryCount = 0) {
        const url = `https://www.avdbs.com/w2017/page/search/search_actor.php?kwd=${encodeURIComponent(jName)}&seq=118414928`;
        try {
            const html = await fetchAvdbsHtml(url);
            const info = parseAvdbsActorHtml(html, jName);
            if (info) {
                actorCache.set(jName, info);
                saveActorCache();
                if (noDataCache.delete(jName)) saveNoDataCache();
                if (ignoredCache.delete(jName)) saveIgnoredCache();
                return info;
            }
            if (!ignoredCache.has(jName)) {
                noDataCache.add(jName);
                saveNoDataCache();
            }
            return null;
        } catch (err) {
            if (retryCount < 2) {
                await new Promise(r => setTimeout(r, 1500 * (retryCount + 1)));
                return queryActorFromAvdbs(jName, retryCount + 1);
            }
            return null;
        }
    }

    function extractOriginalJNameFromSpan(span) {
        if (!span) return '';
        if (span.closest('div.actor-tools')) {
            const urlActor = new URLSearchParams(location.search).get('actor');
            if (urlActor && urlActor.trim()) return urlActor.trim();
            const cleaned = (span.textContent || '').trim().replace(/\s*\((?:재)?조회\s*중…\)$/, '').trim();
            if (cleaned) return cleaned;
        }
        if (span.dataset.ltxJname) return span.dataset.ltxJname.trim();
        return (span.getAttribute('title') || span.textContent || '').trim();
    }

    function applyActorInfoToSpan(span, info) {
        if (!span || !info) return;
        span.dataset.ltxJname = info.jName;
        span.setAttribute('lang', 'ja');
        span.textContent = info.kName || info.jName;
        span.setAttribute('title', info.eName ? `${info.jName}(${info.eName})` : info.jName);
        span.dataset.ltxActorApplied = 'true';
    }

    function restoreOriginalActorSpans(targetJName) {
        if (!targetJName) return;
        document.querySelectorAll(ACTOR_SPAN_SELECTOR).forEach(span => {
            const cur = extractOriginalJNameFromSpan(span);
            const bound = (span.dataset.ltxJname || '').trim();
            if ((cur === targetJName || bound === targetJName) && !actorCache.has(targetJName)) {
                span.dataset.ltxJname = targetJName;
                span.textContent = targetJName;
                if (span.closest('div.actor-tools')) span.removeAttribute('title');
                else span.setAttribute('title', targetJName);
                delete span.dataset.ltxActorApplied;
            }
        });
    }

    function refreshAllDomActorSpans(targetJName = null) {
        document.querySelectorAll(ACTOR_SPAN_SELECTOR).forEach(span => {
            const jName = extractOriginalJNameFromSpan(span);
            if (!jName || (targetJName && jName !== targetJName)) return;
            const cached = actorCache.get(jName);
            if (cached) applyActorInfoToSpan(span, cached);
            else restoreOriginalActorSpans(jName);
        });
    }

    function refreshAllTagNames() {
        const tagEls = document.querySelectorAll('button.tag-name, .tag-name');
        if (tagEls.length === 0) return;

        const repGroupMap = new Map();
        for (const item of actorCache.values()) {
            const rep = (item.repName || '').trim();
            if (!rep) continue;
            if (!repGroupMap.has(rep)) repGroupMap.set(rep, []);
            repGroupMap.get(rep).push(item);
        }

        tagEls.forEach(el => {
            if (!el.dataset.ltxJname) {
                const init = (el.textContent || '').trim();
                if (!init) return;
                el.dataset.ltxJname = init;
            }
            const origJName = el.dataset.ltxJname.trim();
            if (!origJName) return;

            let matched = actorCache.get(origJName) || null;
            if (!matched && repGroupMap.has(origJName)) {
                const members = repGroupMap.get(origJName);
                matched = members.find(m => m.jName === origJName) || members[0] || null;
            }

            if (matched) {
                const displayK = (matched.kName || matched.jName).trim();
                if (el.textContent !== displayK) el.textContent = displayK;
                const rep = (matched.repName || '').trim();
                if (rep && repGroupMap.has(rep)) {
                    el.classList.add('ltx-rep-tag-highlight');
                    el.setAttribute('title', repGroupMap.get(rep).map(m => m.jName.trim()).filter(Boolean).join(' / ') || matched.jName);
                } else {
                    el.classList.remove('ltx-rep-tag-highlight');
                    el.setAttribute('title', matched.jName);
                }
            } else {
                if (el.textContent !== origJName) el.textContent = origJName;
                el.classList.remove('ltx-rep-tag-highlight');
                el.setAttribute('title', origJName);
            }
        });
    }

    function enqueueLookup(jName, forceRefresh = false) {
        const clean = String(jName || '').trim();
        if (!clean) return;
        if (!forceRefresh) {
            if (actorCache.has(clean)) { refreshAllDomActorSpans(clean); return; }
            if (noDataCache.has(clean) || ignoredCache.has(clean)) { restoreOriginalActorSpans(clean); return; }
        }
        if (queuedSet.has(clean) || activeLookupName === clean) return;
        queuedSet.add(clean);
        pendingQueue.push({ jName: clean, forceRefresh });
        updateQueueIndicator();
        processQueue();
    }

    async function processQueue() {
        if (isQueueRunning) return;
        isQueueRunning = true;
        while (pendingQueue.length > 0) {
            const { jName } = pendingQueue.shift();
            queuedSet.delete(jName);
            activeLookupName = jName;
            updateQueueIndicator();

            const info = await queryActorFromAvdbs(jName);
            activeLookupName = null;
            if (info) refreshAllDomActorSpans(jName);
            else restoreOriginalActorSpans(jName);

            updateQueueIndicator();
            if (typeof LtxUI.refreshActorModal === 'function') LtxUI.refreshActorModal();
            if (pendingQueue.length > 0) await new Promise(r => setTimeout(r, REQUEST_INTERVAL_MS));
        }
        isQueueRunning = false;
        updateQueueIndicator();
    }

    function bindActorSpan(span) {
        const jName = extractOriginalJNameFromSpan(span);
        if (!jName) return;

        if (span.dataset.ltxActorBound === 'true' && span.dataset.ltxJname === jName) {
            if (actorCache.has(jName)) {
                const cached = actorCache.get(jName);
                if (span.textContent.trim() !== cached.kName) applyActorInfoToSpan(span, cached);
            } else if ((noDataCache.has(jName) || ignoredCache.has(jName)) && span.textContent.trim() !== jName) {
                restoreOriginalActorSpans(jName);
            }
            return;
        }

        span.dataset.ltxJname = jName;
        delete span.dataset.ltxActorApplied;

        if (span.dataset.ltxActorBound !== 'true') {
            span.dataset.ltxActorBound = 'true';
            span.addEventListener('click', (e) => {
                if (e.altKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    const target = extractOriginalJNameFromSpan(span);
                    if (!target) return;
                    noDataCache.delete(target);
                    ignoredCache.delete(target);
                    saveNoDataCache();
                    saveIgnoredCache();
                    span.textContent = `${target} (조회중…)`;
                    enqueueLookup(target, true);
                }
            });
        }

        if (actorCache.has(jName)) applyActorInfoToSpan(span, actorCache.get(jName));
        else if (noDataCache.has(jName) || ignoredCache.has(jName)) restoreOriginalActorSpans(jName);
        else enqueueLookup(jName, false);
    }

    function batchLookupUnfetched(notifyFn) {
        const candidates = new Set();
        for (const item of LtxIDB.items.values()) {
            if (Array.isArray(item.actors)) item.actors.forEach(a => { if (a) candidates.add(a.trim()); });
        }
        document.querySelectorAll(ACTOR_SPAN_SELECTOR).forEach(s => {
            const j = extractOriginalJNameFromSpan(s);
            if (j) candidates.add(j);
        });
        for (const n of noDataCache) if (n) candidates.add(n);

        let added = 0;
        let cleared = false;
        for (const jName of candidates) {
            if (ignoredCache.has(jName)) continue;
            if (!actorCache.has(jName)) {
                if (noDataCache.delete(jName)) cleared = true;
                enqueueLookup(jName, true);
                added++;
            }
        }
        if (cleared) saveNoDataCache();
        if (notifyFn) notifyFn(added > 0 ? `AVDBS ${added}명 큐 등록` : '미조회 배우 없음');
    }

    function parseActorToken(token) {
        const m = token.match(/^\[([^,\[\]]+),([^,\[\]]+)(?:,\s*([^\[\]]+))?\]$/)
            || token.match(/^(.+?)\(([^,()]+)(?:,\s*(.+))?\)$/);
        if (!m) return null;
        return { kName: m[1].trim(), jName: m[2].trim(), eName: (m[3] || '').trim() };
    }

    function formatActorForCsv(jName, extraMap = {}) {
        const clean = String(jName || '').trim();
        if (!clean) return '';
        const info = actorCache.get(clean) || extraMap[clean];
        if (!info) return clean;
        const kName = info.kName || clean;
        const eName = info.eName || '';
        return eName ? `[${kName},${clean},${eName}]` : `[${kName},${clean}]`;
    }

    function importFromCsv(parseCsvFn, notifyFn, onDone) {
        LtxUtil.selectLocalFiles('.csv,text/csv', async (files) => {
            try {
                let count = 0;
                for (const file of files) {
                    const rows = parseCsvFn(await file.text());
                    if (rows.length < 2) continue;
                    const lower = rows[0].map(h => h.trim().toLowerCase());
                    const jIdx = lower.findIndex(h => ['jname', 'actor', 'name'].includes(h));
                    const kIdx = lower.findIndex(h => ['kname', 'korean'].includes(h));
                    const eIdx = lower.findIndex(h => ['ename', 'english'].includes(h));
                    const rIdx = lower.findIndex(h => ['repname', 'representative', 'alias'].includes(h));
                    const aIdx = lower.indexOf('actors');

                    for (let i = 1; i < rows.length; i++) {
                        const cols = rows[i];
                        if (jIdx !== -1 && (kIdx !== -1 || eIdx !== -1 || rIdx !== -1)) {
                            const jName = (cols[jIdx] || '').trim();
                            const kName = kIdx !== -1 ? (cols[kIdx] || '').trim() : '';
                            const eName = eIdx !== -1 ? (cols[eIdx] || '').trim() : '';
                            const repName = rIdx !== -1 ? (cols[rIdx] || '').trim() : '';
                            if (jName && ((kName && kName !== jName) || eName || repName)) {
                                const prev = actorCache.get(jName);
                                actorCache.set(jName, { jName, kName: kName || prev?.kName || jName, eName: eName || prev?.eName || '', repName: repName || prev?.repName || '', updatedAt: Date.now() });
                                noDataCache.delete(jName);
                                ignoredCache.delete(jName);
                                count++;
                            }
                        }
                        if (aIdx !== -1 && cols[aIdx]) {
                            for (const tok of cols[aIdx].split(/\s*\/\s*/).filter(Boolean)) {
                                const parsed = parseActorToken(tok);
                                if (parsed && parsed.jName && ((parsed.kName && parsed.kName !== parsed.jName) || parsed.eName)) {
                                    const prev = actorCache.get(parsed.jName);
                                    actorCache.set(parsed.jName, { jName: parsed.jName, kName: parsed.kName || prev?.kName || parsed.jName, eName: parsed.eName || prev?.eName || '', repName: prev?.repName || '', updatedAt: Date.now() });
                                    noDataCache.delete(parsed.jName);
                                    ignoredCache.delete(parsed.jName);
                                    count++;
                                }
                            }
                        }
                    }
                }
                if (count === 0) { alert('유효한 배우 이름 매핑을 찾지 못했습니다.'); return; }
                saveActorCache();
                saveNoDataCache();
                saveIgnoredCache();
                refreshAllDomActorSpans();
                if (notifyFn) notifyFn(`CSV 배우 ${count}건 반영`);
                if (onDone) onDone(count);
            } catch (err) {
                alert(`CSV 가져오기 오류: ${err.message}`);
            }
        });
    }

    function openSelectiveBackupModal(notifyFn) {
        const extSites = LtxCard.getExtSites();
        LtxUI.openChecklistModal({
            title: '캐시 및 설정 선택 백업',
            description: '백업 파일(JSON)에 포함할 항목을 선택하세요.',
            confirmLabel: '선택 항목 백업 다운로드',
            items: [
                { id: 'actors', label: '저장된 배우 캐시', countText: `${actorCache.size}명`, checked: true },
                { id: 'nodata', label: 'no-data 스킵 목록', countText: `${noDataCache.size}명`, checked: true },
                { id: 'ignored', label: '무시된 배우 목록', countText: `${ignoredCache.size}명`, checked: true },
                { id: 'extsites', label: '외부 검색 사이트(extLink)', countText: `${extSites.length}개`, checked: true },
                { id: 'counts', label: '배우별 작품 수 캐시', countText: `${actorCountsMap.size}명`, checked: true },
                { id: 'want', label: '보고 싶음 목록 (찜)', countText: `${LtxCard.getMergedWantSet().size}편`, checked: true },
                { id: 'items', label: 'IndexedDB 누적 작품 카탈로그', sub: '(용량 큼)', countText: `${LtxIDB.items.size}편`, checked: false }
            ],
            onConfirm(sel) {
                if (sel.size === 0) { alert('백업할 항목을 하나 이상 선택해 주세요.'); return; }
                const payload = { exportedAt: new Date().toISOString(), searchInsertMode: getSearchInsertMode() };
                if (sel.has('actors')) {
                    const obj = {};
                    for (const [k, v] of actorCache.entries()) if (v && v.jName && !v.notFound) obj[k] = { ...v };
                    payload.actorCount = Object.keys(obj).length;
                    payload.actors = obj;
                }
                if (sel.has('nodata')) payload.noDataActors = Array.from(noDataCache);
                if (sel.has('ignored')) payload.ignoredActors = Array.from(ignoredCache);
                if (sel.has('extsites')) payload.extSites = extSites.slice(0, 18);
                if (sel.has('counts')) payload.actorCounts = Object.fromEntries(actorCountsMap.entries());
                if (sel.has('want')) payload.wantCodes = Array.from(LtxCard.getMergedWantSet());
                if (sel.has('items')) payload.items = Array.from(LtxIDB.items.values());

                const dateStr = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                LtxUtil.downloadJson(payload, `ltx-selective-backup-${dateStr}.json`);
                LtxUI.closeActiveModal();
                if (notifyFn) notifyFn('선택 백업 완료');
            }
        });
    }

    function openSelectiveRestoreModal(notifyFn) {
        LtxUtil.selectLocalFiles('.json,application/json', async (files) => {
            try {
                const merged = { actors: {}, noData: new Set(), ignored: new Set(), sites: [], counts: {}, want: new Set(), items: new Map() };
                for (const file of files) {
                    const parsed = JSON.parse(await file.text());
                    if (!parsed || typeof parsed !== 'object') continue;
                    const src = (parsed.actors && typeof parsed.actors === 'object') ? parsed.actors
                        : (parsed.actorName && typeof parsed.actorName === 'object') ? parsed.actorName
                        : (!parsed.items && !parsed.extSites && !parsed.noDataActors ? parsed : {});
                    for (const [k, v] of Object.entries(src)) {
                        if (!v || typeof v !== 'object') continue;
                        const jName = String(v.jName || k || '').trim();
                        if (!jName) continue;
                        if (v.notFound) { merged.noData.add(jName); continue; }
                        const kName = String(v.kName || '').trim();
                        const eName = String(v.eName || '').trim();
                        const repName = String(v.repName || '').trim();
                        if ((!kName || kName === jName) && !eName && !repName) continue;
                        merged.actors[jName] = { jName, kName: kName || jName, eName, repName, updatedAt: v.updatedAt || Date.now() };
                    }
                    if (Array.isArray(parsed.noDataActors)) parsed.noDataActors.forEach(n => { if (n) merged.noData.add(String(n).trim()); });
                    if (Array.isArray(parsed.ignoredActors)) parsed.ignoredActors.forEach(n => { if (n) merged.ignored.add(String(n).trim()); });
                    if (Array.isArray(parsed.extSites)) merged.sites.push(...parsed.extSites);
                    if (parsed.actorCounts && typeof parsed.actorCounts === 'object') Object.assign(merged.counts, parsed.actorCounts);
                    if (Array.isArray(parsed.wantCodes)) parsed.wantCodes.forEach(c => { if (c) merged.want.add(LtxUtil.normalizeCode(c)); });
                    if (Array.isArray(parsed.items)) parsed.items.forEach(it => { if (it && it.code) merged.items.set(LtxUtil.normalizeCode(it.code), it); });
                }

                const actorLen = Object.keys(merged.actors).length;
                const countLen = Object.keys(merged.counts).length;

                LtxUI.openChecklistModal({
                    title: '캐시 및 설정 선택 복원',
                    description: '백업 파일에서 감지된 항목 중 복원할 항목을 선택하세요.',
                    confirmLabel: '선택 항목 복원 실행',
                    items: [
                        { id: 'actors', label: '배우 캐시', countText: `${actorLen}명`, checked: actorLen > 0, disabled: actorLen === 0 },
                        { id: 'nodata', label: 'no-data 스킵 목록', countText: `${merged.noData.size}명`, checked: merged.noData.size > 0, disabled: merged.noData.size === 0 },
                        { id: 'ignored', label: '무시된 배우 목록', countText: `${merged.ignored.size}명`, checked: merged.ignored.size > 0, disabled: merged.ignored.size === 0 },
                        { id: 'extsites', label: '외부 검색 사이트(extLink)', countText: `${merged.sites.length}개`, checked: merged.sites.length > 0, disabled: merged.sites.length === 0 },
                        { id: 'counts', label: '배우별 작품 수 캐시', countText: `${countLen}명`, checked: countLen > 0, disabled: countLen === 0 },
                        { id: 'want', label: '보고 싶음 목록 (찜)', countText: `${merged.want.size}편`, checked: merged.want.size > 0, disabled: merged.want.size === 0 },
                        { id: 'items', label: 'IndexedDB 누적 작품 카탈로그', countText: `${merged.items.size}편`, checked: merged.items.size > 0, disabled: merged.items.size === 0 }
                    ],
                    onConfirm(sel) {
                        if (sel.has('actors')) {
                            for (const [j, v] of Object.entries(merged.actors)) {
                                actorCache.set(j, { ...actorCache.get(j), ...v, updatedAt: Date.now() });
                                noDataCache.delete(j);
                                ignoredCache.delete(j);
                            }
                            saveActorCache(); saveNoDataCache(); saveIgnoredCache();
                        }
                        if (sel.has('nodata')) {
                            for (const n of merged.noData) if (!actorCache.has(n) && !ignoredCache.has(n)) noDataCache.add(n);
                            saveNoDataCache();
                        }
                        if (sel.has('ignored')) {
                            for (const n of merged.ignored) if (!actorCache.has(n)) { ignoredCache.add(n); noDataCache.delete(n); }
                            saveIgnoredCache(); saveNoDataCache();
                        }
                        if (sel.has('extsites')) LtxCard.mergeExtSites(merged.sites);
                        if (sel.has('counts')) {
                            for (const [k, v] of Object.entries(merged.counts)) if (k && Number.isFinite(Number(v))) actorCountsMap.set(k, Number(v));
                            saveActorCountsMap();
                        }
                        if (sel.has('want')) LtxCard.mergeWantCodes(merged.want);
                        if (sel.has('items')) {
                            for (const [code, item] of merged.items.entries()) {
                                const m = { ...(LtxIDB.items.get(code) || {}), ...item, code };
                                LtxIDB.items.set(code, m);
                                LtxIDB.queueUpsert(m);
                            }
                        }
                        refreshAllDomActorSpans();
                        refreshAllTagNames();
                        LtxUI.closeActiveModal();
                        if (notifyFn) notifyFn('선택 복원 완료');
                    }
                });
            } catch (err) {
                alert(`백업 파일 분석 오류: ${err.message}`);
            }
        });
    }

    function openSelectiveResetModal(notifyFn) {
        const executeReset = async (targets) => {
            if (targets.has('actors')) {
                LtxUtil.store.remove(ACTOR_CACHE_KEY);
                actorCache.clear();
                document.querySelectorAll(ACTOR_SPAN_SELECTOR).forEach(s => {
                    const orig = extractOriginalJNameFromSpan(s);
                    if (orig) restoreOriginalActorSpans(orig);
                });
            }
            if (targets.has('nodata')) { LtxUtil.store.remove(NODATA_CACHE_KEY); noDataCache.clear(); }
            if (targets.has('ignored')) { LtxUtil.store.remove(IGNORED_CACHE_KEY); ignoredCache.clear(); }
            if (targets.has('counts')) { LtxUtil.store.remove(ACTOR_NAV_COUNT_CACHE_KEY); actorCountsMap.clear(); }
            if (targets.has('extsites')) LtxCard.resetExtSites();
            if (targets.has('want')) LtxCard.resetExtraWant();
            if (targets.has('idb')) await LtxIDB.clearAll().catch(() => {});
            if (targets.size === 7) {
                LtxUtil.store.remove(SEARCH_INSERT_MODE_KEY);
                pendingQueue.length = 0;
                queuedSet.clear();
                updateQueueIndicator();
            }
            refreshAllTagNames();
            updateStatsUI();
            LtxUI.closeActiveModal();
            if (notifyFn) notifyFn('초기화 완료');
        };

        LtxUI.openChecklistModal({
            title: '저장소 데이터 초기화',
            description: '초기화할 항목을 선택하거나 하단의 <strong>전체 초기화</strong>를 실행하세요.',
            confirmLabel: '선택 항목만 초기화',
            confirmVariant: 'warning',
            leftAction: {
                label: '전체 초기화',
                async onClick() {
                    if (confirm('저장된 모든 로컬저장소 및 IndexedDB 데이터를 완전히 초기화하시겠습니까?')) {
                        await executeReset(new Set(['actors', 'nodata', 'ignored', 'counts', 'extsites', 'want', 'idb']));
                    }
                }
            },
            items: [
                { id: 'actors', label: '저장된 배우 캐시', countText: `${actorCache.size}명`, checked: false },
                { id: 'nodata', label: 'no-data 스킵 목록', countText: `${noDataCache.size}명`, checked: false },
                { id: 'ignored', label: '무시된 배우 목록', countText: `${ignoredCache.size}명`, checked: false },
                { id: 'counts', label: '배우별 작품 수 캐시', countText: `${actorCountsMap.size}명`, checked: false },
                { id: 'extsites', label: '외부 검색 사이트 설정 (기본값 복원)', countText: `${LtxCard.getExtSites().length}개`, checked: false },
                { id: 'want', label: '확장 보고 싶음(찜) 보조 목록', countText: `${LtxCard.getExtraWantSet().size}편`, checked: false },
                { id: 'idb', label: 'IndexedDB 누적 작품 데이터 전체', countText: `${LtxIDB.items.size}편`, checked: false }
            ],
            async onConfirm(sel) {
                if (sel.size === 0) { alert('초기화할 항목을 하나 이상 체크해 주세요.'); return; }
                if (confirm(`선택한 ${sel.size}개 항목을 정말 초기화하시겠습니까?`)) await executeReset(sel);
            }
        });
    }

    return {
        actorCache,
        noDataCache,
        ignoredCache,
        actorCountsMap,
        ACTOR_SPAN_SELECTOR,
        getSearchInsertMode,
        setSearchInsertMode,
        formatRepBadgeLabel,
        saveActorCache,
        saveNoDataCache,
        saveIgnoredCache,
        syncActorCountsFromApi,
        updateStatsUI,
        updateQueueIndicator,
        refreshAllDomActorSpans,
        refreshAllTagNames,
        enqueueLookup,
        bindActorSpan,
        batchLookupUnfetched,
        parseActorToken,
        formatActorForCsv,
        importFromCsv,
        openSelectiveBackupModal,
        openSelectiveRestoreModal,
        openSelectiveResetModal
    };
})();
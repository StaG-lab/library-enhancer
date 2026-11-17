/* ==========================================================================
 * MODULE 4: 통합 관리 모달 5종 UI (LtxModal)
 *   - openActorManagerModal (저장된 배우 / no-data 스킵[AVBASE·번역·복사] / 무시된 배우)
 *   - openExtSitesManagerModal (외부 검색 사이트 관리)
 *   - openIdbAuditModal (IndexedDB 누락 데이터 점검/정리)
 *   - openActorKoEnSearchModal (한글/초성/영문 자동완성 검색)
 *   - openListPickerModal (내 리스트에 추가)
 * ========================================================================== */
const LtxModal = (() => {
    let deps = {
        parseCsvFn: null,
        notifyFn: null,
        updateMainBtnFn: null
    };

    function init(options = {}) {
        deps = { ...deps, ...options };
    }

    // 1. AVDBS 배우 캐시 / 스킵 / 무시 3탭 통합 관리 모달
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
                LtxActor.noDataCache.delete(j);
                LtxActor.ignoredCache.delete(j);
            }
            LtxActor.saveActorCache();
            LtxActor.saveNoDataCache();
            LtxActor.saveIgnoredCache();
            LtxActor.refreshAllDomActorSpans();
            selected.clear();
            batchRepInput.value = '';
            renderList();
        });

        batchIgnBtn.addEventListener('click', () => {
            if (!selected.size) return;
            for (const j of selected) if (LtxActor.noDataCache.delete(j)) LtxActor.ignoredCache.add(j);
            LtxActor.saveNoDataCache();
            LtxActor.saveIgnoredCache();
            selected.clear();
            renderList();
        });

        batchUnignBtn.addEventListener('click', () => {
            if (!selected.size) return;
            for (const j of selected) if (LtxActor.ignoredCache.delete(j)) LtxActor.noDataCache.add(j);
            LtxActor.saveIgnoredCache();
            LtxActor.saveNoDataCache();
            selected.clear();
            renderList();
        });

        modal.querySelectorAll('.ltx-modal-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                currentTab = btn.dataset.tab;
                if (currentTab !== 'cached') filterRep = '';
                selected.clear();
                resetPage();
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
        modal.querySelector('.ltx-modal-csv-import-btn').addEventListener('click', () => {
            if (deps.parseCsvFn) {
                LtxActor.importFromCsv(deps.parseCsvFn, deps.notifyFn, () => { resetPage(); renderList(); });
            }
        });
        batchLookupBtn.addEventListener('click', () => { LtxActor.batchLookupUnfetched(deps.notifyFn); renderList(); });

        modal.querySelector('.ltx-actor-add-btn').addEventListener('click', () => {
            const jName = modal.querySelector('.add-jname').value.trim();
            const kName = modal.querySelector('.add-kname').value.trim();
            const eName = modal.querySelector('.add-ename').value.trim();
            const repName = modal.querySelector('.add-repname').value.trim();
            if (!jName || (!kName && !eName && !repName)) { alert('일본어명과 최소 한 개 이상의 이름을 입력하세요.'); return; }
            LtxActor.actorCache.set(jName, { jName, kName: kName || jName, eName, repName, updatedAt: Date.now() });
            LtxActor.noDataCache.delete(jName);
            LtxActor.ignoredCache.delete(jName);
            LtxActor.saveActorCache();
            LtxActor.saveNoDataCache();
            LtxActor.saveIgnoredCache();
            LtxActor.refreshAllDomActorSpans(jName);
            ['.add-jname', '.add-kname', '.add-ename', '.add-repname'].forEach(s => { modal.querySelector(s).value = ''; });
            resetPage();
            renderList();
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
                const list = all.filter(it => {
                    if (filterRep && (it.repName || '').trim() !== filterRep) return false;
                    if (!rawQuery) return true;
                    return Math.max(
                        LtxUtil.matchStringOrChosung(it.kName, qL, qC, useCho),
                        LtxUtil.matchStringOrChosung(it.eName, qL, qC, false),
                        LtxUtil.matchStringOrChosung(it.jName, qL, qC, false),
                        LtxUtil.matchStringOrChosung(it.repName, qL, qC, useCho)
                    ) > 0;
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
                        LtxActor.saveActorCache();
                        LtxActor.refreshAllDomActorSpans(item.jName);
                        renderList();
                    });
                    row.querySelector('.refetch').addEventListener('click', () => { LtxActor.actorCache.delete(item.jName); LtxActor.saveActorCache(); LtxActor.enqueueLookup(item.jName, true); renderList(); });
                    row.querySelector('.danger').addEventListener('click', () => { LtxActor.actorCache.delete(item.jName); LtxActor.saveActorCache(); renderList(); });
                    frag.appendChild(row);
                }
                bodyEl.appendChild(frag);
                updateSelUI();
                renderPagination(list.length, start, end);
            } else if (currentTab === 'nodata') {
                const list = Array.from(LtxActor.noDataCache).filter(n => !rawQuery || LtxUtil.matchStringOrChosung(n, qL, qC, useCho) > 0).sort();
                filteredJNames = list;
                if (!list.length) {
                    bodyEl.innerHTML = `<div class="ltx-modal-empty">no-data 스킵 목록이 비어 있습니다.</div>`;
                    updateSelUI();
                    renderPagination(0, 0, 0);
                    return;
                }
                const start = (page - 1) * PAGE_SIZE, end = Math.min(list.length, start + sliceLimit);
                const frag = document.createDocumentFragment();
                for (const jName of list.slice(start, end)) {
                    const row = document.createElement('div');
                    row.className = 'ltx-actor-row';
                    const avbaseUrl = `https://www.avbase.net/talents/${encodeURIComponent(jName)}`;

                    row.innerHTML = `
                        <input type="checkbox" class="ltx-row-select-chk" data-jname="${LtxUtil.escapeHtml(jName)}" ${selected.has(jName) ? 'checked' : ''} />
                        <div class="ltx-actor-name-cell">
                            <div class="ltx-actor-jname-line">
                                <div class="ltx-actor-jname" title="${LtxUtil.escapeHtml(jName)}">${LtxUtil.escapeHtml(jName)}</div>
                                <button type="button" class="ltx-avbase-link-btn" title="좌클릭: AVBASE('${LtxUtil.escapeHtml(jName)}') 팝업 | 휠클릭: Google 번역 새 탭">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                        <polyline points="15 3 21 3 21 9"></polyline>
                                        <line x1="10" y1="14" x2="21" y2="3"></line>
                                    </svg>
                                </button>
                                <button type="button" class="ltx-jname-copy-btn" title="일본어 이름('${LtxUtil.escapeHtml(jName)}') 클립보드 복사">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <input type="text" class="ltx-actor-input kname" placeholder="한글 이름 (kName)" />
                        <input type="text" class="ltx-actor-input ename" placeholder="영문 이름 (eName)" />
                        <input type="text" class="ltx-actor-input repname" placeholder="대표 이름" />
                        <div class="ltx-row-actions">
                            <button type="button" class="ltx-mini-btn save">저장</button>
                            <button type="button" class="ltx-mini-btn refetch">재조회</button>
                            <button type="button" class="ltx-mini-btn ignore">무시</button>
                            <button type="button" class="ltx-mini-btn danger">해제</button>
                        </div>
                    `;

                    // AVBASE 팝업 (좌클릭) & Google 번역 새 탭 (휠클릭)
                    const avbaseBtn = row.querySelector('.ltx-avbase-link-btn');
                    if (avbaseBtn) {
                        avbaseBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.ctrlKey || e.metaKey || e.shiftKey) {
                                window.open(avbaseUrl, '_blank', 'noopener,noreferrer');
                                return;
                            }
                            const w = 960, h = 760;
                            const left = Math.max(0, Math.round((window.screen.width - w) / 2));
                            const top = Math.max(0, Math.round((window.screen.height - h) / 2));
                            const pop = window.open(avbaseUrl, 'ltx_avbase_preview', `popup=yes,width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
                            pop ? pop.focus() : window.open(avbaseUrl, '_blank', 'noopener,noreferrer');
                        });

                        avbaseBtn.addEventListener('mousedown', (e) => {
                            if (e.button === 1) {
                                e.preventDefault();
                                e.stopPropagation();
                                window.open('https://translate.google.co.kr/?sl=ja&tl=ko&op=translate', '_blank', 'noopener,noreferrer');
                            }
                        });
                        avbaseBtn.addEventListener('auxclick', (e) => {
                            if (e.button === 1) { e.preventDefault(); e.stopPropagation(); }
                        });
                    }

                    // 일본어 이름 클립보드 복사 버튼
                    const copyBtn = row.querySelector('.ltx-jname-copy-btn');
                    if (copyBtn) {
                        const defaultSvg = copyBtn.innerHTML;
                        copyBtn.addEventListener('click', async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (await LtxUtil.copyText(jName)) {
                                copyBtn.classList.add('copied');
                                copyBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                                setTimeout(() => {
                                    if (document.body.contains(copyBtn)) {
                                        copyBtn.classList.remove('copied');
                                        copyBtn.innerHTML = defaultSvg;
                                    }
                                }, 1200);
                            }
                        });
                    }

                    row.querySelector('.ltx-row-select-chk').addEventListener('change', (e) => { e.target.checked ? selected.add(jName) : selected.delete(jName); updateSelUI(); });
                    row.querySelector('.save').addEventListener('click', () => {
                        const k = row.querySelector('.kname').value.trim(), en = row.querySelector('.ename').value.trim(), r = row.querySelector('.repname').value.trim();
                        if (!k && !en && !r) return;
                        LtxActor.actorCache.set(jName, { jName, kName: k || jName, eName: en, repName: r, updatedAt: Date.now() });
                        LtxActor.noDataCache.delete(jName);
                        LtxActor.saveActorCache();
                        LtxActor.saveNoDataCache();
                        LtxActor.refreshAllDomActorSpans(jName);
                        renderList();
                    });
                    row.querySelector('.refetch').addEventListener('click', () => { LtxActor.noDataCache.delete(jName); LtxActor.saveNoDataCache(); LtxActor.enqueueLookup(jName, true); renderList(); });
                    row.querySelector('.ignore').addEventListener('click', () => { LtxActor.noDataCache.delete(jName); LtxActor.ignoredCache.add(jName); LtxActor.saveNoDataCache(); LtxActor.saveIgnoredCache(); renderList(); });
                    row.querySelector('.danger').addEventListener('click', () => { LtxActor.noDataCache.delete(jName); LtxActor.saveNoDataCache(); renderList(); });
                    frag.appendChild(row);
                }
                bodyEl.appendChild(frag);
                updateSelUI();
                renderPagination(list.length, start, end);
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
                bodyEl.appendChild(frag);
                updateSelUI();
                renderPagination(list.length, start, end);
            }
        }

        LtxUI.refreshActorModal = () => { if (document.body.contains(backdrop)) renderList(); };
        renderList();
    }

    // 2. 외부 검색 사이트(extLink) 관리 모달
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
            resetForm();
            renderSites();
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

    // 3. IndexedDB 작품 데이터 누락 점검 및 정리 모달
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
                row.querySelector('.danger').addEventListener('click', async () => {
                    await LtxIDB.deleteCodes([item.code]);
                    selectedCodes.delete(item.code);
                    if (deps.updateMainBtnFn) deps.updateMainBtnFn();
                    renderAudit();
                });
                frag.appendChild(row);
            }
            bodyEl.appendChild(frag);
        }

        modal.querySelectorAll('.ltx-modal-tab').forEach(t => t.addEventListener('click', () => {
            filterType = t.dataset.filter;
            selectedCodes.clear();
            modal.querySelectorAll('.ltx-modal-tab').forEach(b => b.classList.toggle('active', b === t));
            renderAudit();
        }));
        modal.querySelector('#idb-audit-search').addEventListener('input', (e) => { query = e.target.value.trim(); renderAudit(); });
        modal.querySelector('#idb-del-sel').addEventListener('click', async () => {
            if (!selectedCodes.size || !confirm(`선택한 ${selectedCodes.size}건을 삭제하시겠습니까?`)) return;
            await LtxIDB.deleteCodes(Array.from(selectedCodes));
            selectedCodes.clear();
            if (deps.updateMainBtnFn) deps.updateMainBtnFn();
            renderAudit();
        });
        modal.querySelector('#idb-del-all').addEventListener('click', async () => {
            if (!currentFiltered.length || !confirm(`현재 필터의 ${currentFiltered.length}건 전체를 삭제하시겠습니까?`)) return;
            await LtxIDB.deleteCodes(currentFiltered.map(x => x.item.code));
            selectedCodes.clear();
            if (deps.updateMainBtnFn) deps.updateMainBtnFn();
            renderAudit();
        });
        renderAudit();
    }

    // 4. 한글 / 영문 / 초성 배우 자동완성 검색 모달 (Ctrl+K)
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
                LtxCard.injectAliasActorCards(openListPickerModal, deps.notifyFn);
                modal.querySelectorAll('.ltx-koen-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === insertMode));
                renderAutocomplete();
                searchInput.focus();
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
                    const score = Math.max(
                        LtxUtil.matchStringOrChosung(it.kName, qL, qC, useCho),
                        LtxUtil.matchStringOrChosung(it.eName, qL, qC, false),
                        LtxUtil.matchStringOrChosung(it.jName, qL, qC, false),
                        LtxUtil.matchStringOrChosung(it.repName, qL, qC, useCho)
                    );
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
                currentMatches = Array.from(scoreMap.values())
                    .sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0))
                    .slice(0, 60)
                    .map(s => s.item);
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
                row.addEventListener('mouseenter', () => {
                    selectedIndex = idx;
                    resultsEl.querySelectorAll('.ltx-koen-item').forEach((el, i) => el.classList.toggle('selected', i === selectedIndex));
                });
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

    // 5. 주입 카드용 내 리스트에 추가 모달
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

    return {
        init,
        openActorManagerModal,
        openExtSitesManagerModal,
        openIdbAuditModal,
        openActorKoEnSearchModal,
        openListPickerModal
    };
})();
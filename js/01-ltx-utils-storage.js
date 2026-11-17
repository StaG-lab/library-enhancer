/* ==========================================================================
 * MODULE 1: 공용 유틸리티(LtxUtil), 선언형 모달 빌더(LtxUI), IndexedDB 및 CSV/JSON
 * ========================================================================== */
const LtxUtil = (() => {
    const CHOSUNG_LIST = [
        'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
        'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
    ];
    const CHOSUNG_SET = new Set(CHOSUNG_LIST);

    function extractChosung(str) {
        if (!str) return '';
        let result = '';
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            if (code >= 0xAC00 && code <= 0xD7A3) {
                const idx = Math.floor((code - 0xAC00) / 588);
                result += CHOSUNG_LIST[idx] || '';
            } else {
                result += str[i];
            }
        }
        return result;
    }

    function isChosungQuery(query) {
        const compact = String(query || '').replace(/\s+/g, '');
        if (!compact) return false;
        let hasChosung = false;
        for (let i = 0; i < compact.length; i++) {
            const ch = compact[i];
            if (CHOSUNG_SET.has(ch)) {
                hasChosung = true;
            } else if (!/[0-9a-zA-Z]/.test(ch)) {
                return false;
            }
        }
        return hasChosung;
    }

    function matchStringOrChosung(targetText, queryLower, queryCompact, useChosung) {
        if (!targetText) return 0;
        const tLower = targetText.toLowerCase();
        const tCompact = tLower.replace(/\s+/g, '');

        if (tLower === queryLower || tCompact === queryCompact) return 100;
        if (tLower.startsWith(queryLower) || tCompact.startsWith(queryCompact)) return 75;
        if (tLower.includes(queryLower) || tCompact.includes(queryCompact)) return 50;

        if (useChosung) {
            const cho = extractChosung(targetText).toLowerCase();
            const choCompact = cho.replace(/\s+/g, '');
            if (choCompact === queryCompact) return 90;
            if (choCompact.startsWith(queryCompact)) return 65;
            if (choCompact.includes(queryCompact)) return 45;
        }
        return 0;
    }

    function escapeHtml(str) {
        return String(str ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function normalizeCode(raw) {
        return String(raw || '').trim().toUpperCase();
    }

    const store = {
        get(key, fallback = null) {
            try {
                const raw = localStorage.getItem(key);
                return raw !== null ? JSON.parse(raw) : fallback;
            } catch (e) {
                return fallback;
            }
        },
        set(key, val) {
            try {
                localStorage.setItem(key, JSON.stringify(val));
            } catch (e) {
                console.warn(`[LTX-Store] ${key} 저장 실패:`, e);
            }
        },
        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch (e) {}
        }
    };

    async function copyText(text) {
        const str = String(text ?? '');
        if (!str) return false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(str);
                return true;
            }
        } catch (e) {}

        const ta = document.createElement('textarea');
        ta.value = str;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {}
        ta.remove();
        return ok;
    }

    function triggerBlobDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function downloadJson(data, filename) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        triggerBlobDownload(blob, filename);
    }

    function selectLocalFiles(acceptExt, onFilesSelected) {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = acceptExt;
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', async () => {
            const files = Array.from(input.files || []);
            input.remove();
            if (files.length === 0) return;
            await onFilesSelected(files);
        });

        input.click();
    }

    return {
        extractChosung,
        isChosungQuery,
        matchStringOrChosung,
        escapeHtml,
        normalizeCode,
        store,
        copyText,
        triggerBlobDownload,
        downloadJson,
        selectLocalFiles
    };
})();

/* ==========================================================================
 * 공용 모달 매니저 & 선언형 체크리스트 빌더 (LtxUI)
 * ========================================================================== */
const LtxUI = (() => {
    let isModalOpen = false;
    let refreshActorModalIfOpen = null;

    function closeActiveModal() {
        refreshActorModalIfOpen = null;
        isModalOpen = false;
        const existing = document.getElementById('ltx-modal-backdrop');
        if (existing) {
            existing.style.display = 'none';
            existing.innerHTML = '';
            existing.remove();
        }
    }

    function createModal({ title, badgeHtml = '', narrow = false, fixedHeight = false, innerHtml = '' }) {
        closeActiveModal();
        isModalOpen = true;

        const backdrop = document.createElement('div');
        backdrop.id = 'ltx-modal-backdrop';
        backdrop.className = 'ltx-modal-backdrop';

        const modal = document.createElement('div');
        modal.className = `ltx-modal-box${narrow ? ' ltx-koen-modal' : ''}${fixedHeight ? ' ltx-modal-fixed-height' : ''}`;
        modal.innerHTML = `
            <div class="ltx-modal-header">
                <h3>${LtxUtil.escapeHtml(title)} ${badgeHtml}</h3>
                <button type="button" class="ltx-modal-close" title="닫기">&times;</button>
            </div>
            ${innerHtml}
        `;

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        modal.querySelector('.ltx-modal-close').addEventListener('click', closeActiveModal);

        return { backdrop, modal };
    }

    function openChecklistModal({
        title,
        description,
        items,
        confirmLabel,
        confirmVariant = 'primary',
        leftAction = null,
        onConfirm
    }) {
        const rowsHtml = items.map(it => `
            <label class="ltx-koen-item" style="cursor:${it.disabled ? 'default' : 'pointer'};">
                <span class="ltx-koen-main">
                    <input type="checkbox" class="ltx-chk-item" value="${LtxUtil.escapeHtml(it.id)}" ${it.checked && !it.disabled ? 'checked' : ''} ${it.disabled ? 'disabled' : ''} />
                    <strong>${LtxUtil.escapeHtml(it.label)}</strong>${it.sub ? ` <span style="color:#94a3b8;font-size:0.78rem;">${LtxUtil.escapeHtml(it.sub)}</span>` : ''}
                </span>
                <span class="ltx-koen-card-count">${LtxUtil.escapeHtml(it.countText)}</span>
            </label>
        `).join('');

        const leftBtnHtml = leftAction
            ? `<button type="button" class="ltx-mini-btn danger" id="ltx-chk-left-btn" style="padding:7px 12px;">${LtxUtil.escapeHtml(leftAction.label)}</button>`
            : '';

        const { modal } = createModal({
            title,
            narrow: true,
            innerHtml: `
                <div class="ltx-modal-body">
                    <div class="ltx-checklist-desc-row">
                        <p class="ltx-checklist-desc">${description}</p>
                        <button type="button" class="ltx-mini-btn" id="ltx-chk-toggle-all">전체 선택</button>
                    </div>
                    ${rowsHtml}
                    <div class="ltx-checklist-footer ${leftAction ? '' : 'right-only'}">
                        ${leftBtnHtml}
                        <div style="display:flex;gap:8px;">
                            <button type="button" class="ltx-modal-action-btn" id="ltx-chk-cancel">취소</button>
                            <button type="button" class="ltx-modal-action-btn ${confirmVariant}" id="ltx-chk-exec">${LtxUtil.escapeHtml(confirmLabel)}</button>
                        </div>
                    </div>
                </div>
            `
        });

        modal.querySelector('#ltx-chk-cancel').addEventListener('click', closeActiveModal);

        const activeCheckboxes = Array.from(modal.querySelectorAll('.ltx-chk-item:not(:disabled)'));
        const toggleAllBtn = modal.querySelector('#ltx-chk-toggle-all');

        const syncToggleLabel = () => {
            if (activeCheckboxes.length === 0) {
                toggleAllBtn.disabled = true;
                toggleAllBtn.textContent = '선택 불가';
                return;
            }
            const allChecked = activeCheckboxes.every(cb => cb.checked);
            toggleAllBtn.textContent = allChecked ? '전체 해제' : '전체 선택';
        };

        activeCheckboxes.forEach(cb => cb.addEventListener('change', syncToggleLabel));
        toggleAllBtn.addEventListener('click', () => {
            if (activeCheckboxes.length === 0) return;
            const shouldCheck = !activeCheckboxes.every(cb => cb.checked);
            activeCheckboxes.forEach(cb => { cb.checked = shouldCheck; });
            syncToggleLabel();
        });
        syncToggleLabel();

        if (leftAction) {
            modal.querySelector('#ltx-chk-left-btn').addEventListener('click', () => leftAction.onClick());
        }

        modal.querySelector('#ltx-chk-exec').addEventListener('click', () => {
            const selectedIds = activeCheckboxes.filter(cb => cb.checked).map(cb => cb.value);
            onConfirm(new Set(selectedIds));
        });
    }

    return {
        get isModalOpen() { return isModalOpen; },
        set refreshActorModal(fn) { refreshActorModalIfOpen = fn; },
        get refreshActorModal() { return refreshActorModalIfOpen; },
        closeActiveModal,
        createModal,
        openChecklistModal
    };
})();

/* ==========================================================================
 * IndexedDB 작품 카탈로그 저장소 (LtxIDB)
 * ========================================================================== */
const LtxIDB = (() => {
    const DB_NAME = 'ltx_enhancer_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'items';

    const accumulatedItems = new Map();
    const pendingUpserts = new Map();
    let dbPromise = null;
    let flushTimer = null;

    function openDB() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB 미지원 브라우저'));
                return;
            }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'code' });
                }
            };
            req.onsuccess = (e) => {
                const db = e.target.result;
                db.onversionchange = () => { db.close(); dbPromise = null; };
                resolve(db);
            };
            req.onerror = () => { dbPromise = null; reject(req.error); };
        });
        return dbPromise;
    }

    async function loadAll(onLoaded) {
        LtxUtil.store.remove('ltx_items_cache_v1');
        try {
            const db = await openDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).getAll();
                req.onsuccess = () => {
                    if (Array.isArray(req.result)) {
                        for (const item of req.result) {
                            if (item && item.code) {
                                const code = String(item.code).trim();
                                if (!accumulatedItems.has(code)) accumulatedItems.set(code, item);
                            }
                        }
                    }
                    resolve();
                };
                req.onerror = () => reject(req.error);
            });
            if (typeof onLoaded === 'function') onLoaded();
        } catch (err) {
            console.warn('[LTX-IDB] 로드 실패:', err);
        }
    }

    function queueUpsert(itemObj) {
        if (!itemObj || !itemObj.code) return;
        pendingUpserts.set(itemObj.code, itemObj);
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = setTimeout(flushUpserts, 300);
    }

    async function flushUpserts() {
        flushTimer = null;
        if (pendingUpserts.size === 0) return;
        const batch = Array.from(pendingUpserts.values());
        pendingUpserts.clear();
        try {
            const db = await openDB();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                for (const item of batch) store.put(item);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (err) {
            for (const item of batch) {
                if (!pendingUpserts.has(item.code)) pendingUpserts.set(item.code, item);
            }
        }
    }

    async function clearAll() {
        pendingUpserts.clear();
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        accumulatedItems.clear();
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    async function deleteCodes(codesArray) {
        if (!Array.isArray(codesArray) || codesArray.length === 0) return;
        for (const c of codesArray) {
            accumulatedItems.delete(c);
            pendingUpserts.delete(c);
        }
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const c of codesArray) store.delete(c);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    window.addEventListener('pagehide', () => {
        if (pendingUpserts.size > 0) flushUpserts();
    });

    return {
        items: accumulatedItems,
        loadAll,
        queueUpsert,
        flushUpserts,
        clearAll,
        deleteCodes
    };
})();
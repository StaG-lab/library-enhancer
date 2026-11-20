/* ==========================================================================
 * MODULE 3: 외부 사이트(extLink), 대표 이름 카드 병합 및 하트(#want) 동기화 (LtxCard)
 * ========================================================================== */
const LtxCard = (() => {
    const EXT_SITES_CACHE_KEY = 'ltx_custom_ext_sites_v1';
    const ALIAS_WANT_EXTRA_KEY = 'ltx_alias_want_extra_v1';
    const MAX_EXT_SITES = 18;
    const MAX_EXT_LABEL_LEN = 16;

    const DEFAULT_SITES = [
        { id: 'preset_01', name: 'SubtitleCat', urlTemplate: 'https://www.subtitlecat.com/index.php?search={code}' }
    ];

    function loadExtSites() {
        const parsed = LtxUtil.store.get(EXT_SITES_CACHE_KEY, null);
        if (Array.isArray(parsed)) {
            return parsed.filter(s => s && typeof s.name === 'string' && typeof s.urlTemplate === 'string').slice(0, MAX_EXT_SITES);
        }
        return [...DEFAULT_SITES];
    }

    let extSites = loadExtSites();

    function saveExtSites() {
        if (extSites.length > MAX_EXT_SITES) extSites = extSites.slice(0, MAX_EXT_SITES);
        LtxUtil.store.set(EXT_SITES_CACHE_KEY, extSites);
        updateExtSitesCountUI();
        rebuildAllCardExtMenus();
    }

    function updateExtSitesCountUI() {
        const label = document.querySelector('.ltx-ext-sites-count');
        if (label) label.textContent = `외부 사이트 관리 (${extSites.length}/${MAX_EXT_SITES})`;
    }

    function mergeExtSites(sitesArray) {
        for (const site of sitesArray) {
            if (!site || !site.name || !site.urlTemplate) continue;
            const exists = extSites.some(s => s.name === site.name && s.urlTemplate === site.urlTemplate);
            if (!exists && extSites.length < MAX_EXT_SITES) {
                extSites.push({
                    id: site.id || `ext_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name: String(site.name).trim(),
                    urlTemplate: String(site.urlTemplate).trim()
                });
            }
        }
        saveExtSites();
    }

    function resetExtSites() {
        LtxUtil.store.remove(EXT_SITES_CACHE_KEY);
        extSites = loadExtSites();
        saveExtSites();
    }

    function buildSearchUrl(tpl, code) {
        const enc = encodeURIComponent(code);
        return /\{code\}/i.test(tpl) ? tpl.replace(/\{code\}/gi, enc) : `${tpl}${enc}`;
    }

    function formatExtSiteLabel(name) {
        const chars = Array.from(String(name || '').trim());
        return chars.length > MAX_EXT_LABEL_LEN ? chars.slice(0, MAX_EXT_LABEL_LEN).join('') + '...' : chars.join('');
    }

    function populateExtSubLinks(subMenu, dataCode) {
        subMenu.innerHTML = '';
        const visible = extSites.slice(0, MAX_EXT_SITES);
        if (visible.length === 0) {
            const hint = document.createElement('span');
            hint.className = 'ltx-ext-empty';
            hint.textContent = '등록된 사이트 없음';
            subMenu.appendChild(hint);
            return;
        }
        for (const site of visible) {
            const link = document.createElement('a');
            link.className = 'ltx-ext-item';
            link.href = buildSearchUrl(site.urlTemplate, dataCode);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.title = `${site.name}에서 ${dataCode} 검색`;
            link.textContent = formatExtSiteLabel(site.name);
            link.addEventListener('click', (e) => e.stopPropagation());
            subMenu.appendChild(link);
        }
    }

    function rebuildAllCardExtMenus() {
        document.querySelectorAll('article.card').forEach(card => {
            const code = (card.dataset.code || '').trim();
            const subMenu = card.querySelector('.ltx-ext-sub-links');
            if (code && subMenu) populateExtSubLinks(subMenu, code);
        });
    }

    function closeAllExtMenus(exceptWrap = null) {
        document.querySelectorAll('.ltx-ext-menu-wrap.open').forEach(w => {
            if (w !== exceptWrap) w.classList.remove('open');
        });
    }

    function copyScopeAttributes(src, dst) {
        if (!src || !dst) return;
        for (const attr of src.attributes) {
            if (attr.name.startsWith('data-v-')) dst.setAttribute(attr.name, attr.value);
        }
    }

    function getUserEditedEntry(code) {
        if (typeof LtxIDB === 'undefined' || typeof LtxIDB.getUserEditedMap !== 'function') return null;
        const map = LtxIDB.getUserEditedMap();
        const norm = LtxUtil.normalizeCode(code);
        if (!norm) return null;
        if (map[norm]) return map[norm];
        const rawTrim = String(code || '').trim();
        if (map[rawTrim]) return map[rawTrim];
        for (const [k, v] of Object.entries(map)) {
            if (LtxUtil.normalizeCode(k) === norm) return v;
        }
        return null;
    }

    function applyUserDataToCard(card) {
        if (!card || !card.dataset.code) return;
        const rawCode = card.dataset.code.trim();
        const normCode = LtxUtil.normalizeCode(rawCode);
        const entry = getUserEditedEntry(rawCode);
        if (!entry) return;

        // 1) cover 누락 보완
        if (typeof entry.cover === 'string' && entry.cover.trim()) {
            const coverEl = card.querySelector('.cover');
            const existingImg = coverEl?.querySelector('.cover-btn img');
            const hasValidImg = existingImg && existingImg.getAttribute('src');
            if (coverEl && (!hasValidImg || existingImg.closest('[data-ltx-user-patched="cover"]'))) {
                coverEl.querySelector('.empty')?.remove();
                coverEl.querySelector('.cover-btn[data-ltx-user-patched="cover"]')?.remove();

                const coverBtn = document.createElement('button');
                coverBtn.className = 'cover-btn';
                coverBtn.type = 'button';
                coverBtn.dataset.ltxUserPatched = 'cover';
                copyScopeAttributes(coverEl, coverBtn);

                const imgEl = document.createElement('img');
                imgEl.loading = 'lazy';
                imgEl.decoding = 'async';
                imgEl.src = entry.cover.trim();
                imgEl.alt = '';
                imgEl.setAttribute('referrerpolicy', 'no-referrer');
                copyScopeAttributes(coverEl, imgEl);

                imgEl.addEventListener('load', () => { imgEl.classList.add('in'); coverEl.classList.remove('loading'); });
                imgEl.addEventListener('error', () => { coverEl.classList.remove('loading'); coverBtn.remove(); });

                coverEl.classList.add('loading');
                coverBtn.appendChild(imgEl);
                const codeBtn = coverEl.querySelector('button.code');
                if (codeBtn) coverEl.insertBefore(coverBtn, codeBtn);
                else coverEl.appendChild(coverBtn);
            }
        }

        const bodyEl = card.querySelector('.body');
        if (!bodyEl) return;

        // 2) title 누락 보완
        if (typeof entry.title === 'string' && entry.title.trim()) {
            const titleH3 = bodyEl.querySelector('h3.title');
            const titleBtn = titleH3?.querySelector('button.title-btn');
            const currentTitle = (titleBtn ? titleBtn.textContent : titleH3?.textContent || '').trim();
            const isMissingTitle = !currentTitle || LtxUtil.normalizeCode(currentTitle) === normCode || currentTitle === '(제목 없음)';
            if (titleH3 && (isMissingTitle || titleH3.dataset.ltxUserPatched === 'title')) {
                const nextTitle = entry.title.trim();
                titleH3.setAttribute('title', nextTitle);
                titleH3.dataset.ltxUserPatched = 'title';
                if (titleBtn) titleBtn.textContent = nextTitle;
                else titleH3.textContent = nextTitle;
            }
        }

        // 3) actors 누락 보완
        if (Array.isArray(entry.actors) && entry.actors.length > 0) {
            let whoEl = bodyEl.querySelector('.who');
            if (!whoEl) {
                whoEl = document.createElement('div');
                whoEl.className = 'who';
                copyScopeAttributes(bodyEl, whoEl);
                const titleEl = bodyEl.querySelector('h3.title');
                if (titleEl) titleEl.insertAdjacentElement('afterend', whoEl);
                else bodyEl.prepend(whoEl);
            }
            const existingNativeTags = whoEl.querySelectorAll('.tags:not([data-ltx-user-patched="actors"]) .tag');
            if (existingNativeTags.length === 0) {
                whoEl.querySelector('.tags[data-ltx-user-patched="actors"]')?.remove();
                const tagsDiv = document.createElement('div');
                tagsDiv.className = 'tags';
                tagsDiv.dataset.ltxUserPatched = 'actors';
                copyScopeAttributes(whoEl, tagsDiv);

                for (const actor of entry.actors) {
                    const cleanActor = String(actor || '').trim();
                    if (!cleanActor) continue;
                    const tagSpan = document.createElement('span');
                    tagSpan.className = 'tag';
                    copyScopeAttributes(whoEl, tagSpan);

                    const tagBtn = document.createElement('button');
                    tagBtn.className = 'tag-name';
                    tagBtn.setAttribute('lang', 'ja');
                    tagBtn.type = 'button';
                    tagBtn.setAttribute('title', cleanActor);
                    tagBtn.textContent = cleanActor;
                    copyScopeAttributes(whoEl, tagBtn);

                    tagBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const targetJ = (tagBtn.dataset.ltxJname || tagBtn.getAttribute('title') || tagBtn.textContent || '').trim();
                        if (targetJ) {
                            const url = new URL(location.href);
                            url.pathname = '/';
                            url.search = `?actor=${encodeURIComponent(targetJ)}`;
                            url.hash = '';
                            history.pushState(null, '', url.toString());
                            window.dispatchEvent(new PopStateEvent('popstate'));
                        }
                    });

                    tagSpan.appendChild(tagBtn);
                    tagsDiv.appendChild(tagSpan);
                }
                if (tagsDiv.children.length > 0) {
                    whoEl.prepend(tagsDiv);
                    if (typeof LtxActor !== 'undefined') {
                        tagsDiv.querySelectorAll(LtxActor.ACTOR_SPAN_SELECTOR).forEach(LtxActor.bindActorSpan);
                    }
                }
            }
        }

        // 4) link 누락 보완
        if (typeof entry.link === 'string' && entry.link.trim()) {
            const existingCopy = bodyEl.querySelector('.copy-btn:not([data-ltx-user-patched="link"])');
            if (!existingCopy) {
                bodyEl.querySelector('.copy-btn[data-ltx-user-patched="link"]')?.remove();
                let actionsEl = bodyEl.querySelector('.actions');
                if (!actionsEl) {
                    actionsEl = document.createElement('div');
                    actionsEl.className = 'actions';
                    copyScopeAttributes(bodyEl, actionsEl);
                    bodyEl.appendChild(actionsEl);
                }
                const linkStr = entry.link.trim();
                const sizeLabel = linkStr.startsWith('ed2k://')
                    ? `ed2k · ${((Number(linkStr.split('|', 4)[3]) || 0) / (1024 ** 3)).toFixed(1)}G`
                    : '마그넷';
                const copyBtn = document.createElement('button');
                copyBtn.className = 'btn copy-btn';
                copyBtn.type = 'button';
                copyBtn.title = linkStr;
                copyBtn.textContent = `복사: ${sizeLabel}`;
                copyBtn.dataset.ltxUserPatched = 'link';
                copyScopeAttributes(actionsEl, copyBtn);

                copyBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (await LtxUtil.copyText(linkStr)) {
                        copyBtn.classList.add('done');
                        setTimeout(() => copyBtn.classList.remove('done'), 1200);
                    }
                });
                actionsEl.prepend(copyBtn);
            }
        }
    }

    function refreshUserPatchedCards() {
        document.querySelectorAll('article.card').forEach(applyUserDataToCard);
    }

    function modifyCard(card) {
        if (!card.dataset.code) return;
        applyUserDataToCard(card);
        if (card.dataset.processed) return;
        const dataCode = card.dataset.code.trim();
        const codeBtn = card.querySelector('button.code');

        if (codeBtn && codeBtn.parentNode && !card.querySelector('.ltx-ext-menu-wrap')) {
            const parentEl = codeBtn.parentNode;
            if (getComputedStyle(parentEl).position === 'static') parentEl.style.position = 'relative';

            const wrap = document.createElement('div');
            wrap.className = 'ltx-ext-menu-wrap';
            copyScopeAttributes(codeBtn, wrap);

            const offsetLeft = codeBtn.offsetLeft || 0;
            const offsetTop = (codeBtn.offsetTop || 0) + (codeBtn.offsetHeight || 0) + 4;
            if (offsetTop > 4) {
                wrap.style.left = `${offsetLeft}px`;
                wrap.style.top = `${offsetTop}px`;
                wrap.style.maxWidth = `calc(100% - ${offsetLeft + 6}px)`;
            }

            const triggerBtn = document.createElement('button');
            triggerBtn.type = 'button';
            triggerBtn.className = 'ltx-ext-trigger';
            triggerBtn.title = `${dataCode} 외부 검색 (클릭하여 열기/닫기)`;
            triggerBtn.setAttribute('aria-label', `${dataCode} extLink`);
            copyScopeAttributes(codeBtn, triggerBtn);
            triggerBtn.innerHTML = `
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6"></path><path d="M10 14L21 3"></path>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                </svg><span>extLink</span>
            `;

            triggerBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const willOpen = !wrap.classList.contains('open');
                closeAllExtMenus(wrap);
                wrap.classList.toggle('open', willOpen);
            });

            card.addEventListener('mouseenter', () => closeAllExtMenus(wrap));

            const subMenu = document.createElement('div');
            subMenu.className = 'ltx-ext-sub-links';
            populateExtSubLinks(subMenu, dataCode);

            wrap.appendChild(triggerBtn);
            wrap.appendChild(subMenu);
            codeBtn.insertAdjacentElement('afterend', wrap);
        }
        card.dataset.processed = 'true';
    }

    // 보고 싶음(하트) 통합 관리
    function getExtraWantSet() {
        const raw = LtxUtil.store.get(ALIAS_WANT_EXTRA_KEY, []);
        return new Set(Array.isArray(raw) ? raw.map(LtxUtil.normalizeCode).filter(Boolean) : []);
    }

    function saveExtraWantSet(set) {
        LtxUtil.store.set(ALIAS_WANT_EXTRA_KEY, Array.from(set));
    }

    function getMergedWantSet() {
        const merged = new Set();
        const nativeRaw = LtxUtil.store.get('ltx.want', []);
        if (Array.isArray(nativeRaw)) {
            nativeRaw.forEach(c => { const n = LtxUtil.normalizeCode(c); if (n) merged.add(n); });
        }
        for (const c of getExtraWantSet()) merged.add(c);
        return merged;
    }

    function mergeWantCodes(codesIterable) {
        const extra = getExtraWantSet();
        for (const c of codesIterable) extra.add(c);
        saveExtraWantSet(extra);
        syncHeaderWantCounter();
    }

    function resetExtraWant() {
        LtxUtil.store.remove(ALIAS_WANT_EXTRA_KEY);
        syncHeaderWantCounter();
    }

    // Vue의 localStorage['ltx.want'] 덮어쓰기 후킹
    (() => {
        const origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            origSetItem.apply(this, arguments);
            if (this === localStorage && key === 'ltx.want') {
                try {
                    const nativeArr = JSON.parse(value || '[]');
                    if (Array.isArray(nativeArr)) {
                        const nativeSet = new Set(nativeArr.map(LtxUtil.normalizeCode).filter(Boolean));
                        const extraSet = getExtraWantSet();
                        let changed = false;
                        for (const c of Array.from(extraSet)) {
                            if (nativeSet.has(c)) { extraSet.delete(c); changed = true; }
                        }
                        if (changed) saveExtraWantSet(extraSet);
                        requestAnimationFrame(syncHeaderWantCounter);
                    }
                } catch (e) { }
            }
        };
    })();

    // main > div.bar > button.tool.save-want 클릭 시 서버로 전송되는 리스트 생성 요청에 통합 찜 목록(getMergedWantSet) 병합
    (() => {
        const origFetch = window.fetch;
        window.fetch = async function (resource, init) {
            try {
                const urlStr = typeof resource === 'string'
                    ? resource
                    : (resource instanceof Request ? resource.url : '');
                const method = (init?.method || (resource instanceof Request ? resource.method : 'GET')).toUpperCase();

                // 리스트 생성 엔드포인트(/api/lists, POST) 감지
                if (method === 'POST' && /\/api\/lists(?:\/)?(?:\?|$)/.test(urlStr) && typeof init?.body === 'string') {
                    const bodyObj = JSON.parse(init.body);
                    const targetField = Array.isArray(bodyObj.codes)
                        ? 'codes'
                        : (Array.isArray(bodyObj.items) ? 'items' : null);

                    if (targetField) {
                        const combinedSet = new Set(bodyObj[targetField].map(LtxUtil.normalizeCode).filter(Boolean));
                        const dialogContainer = document.querySelector('form > div.editor-body > div:nth-child(4) > div');

                        if (dialogContainer && dialogContainer.dataset.ltxWantInjected === 'true') {
                            // 다이얼로그에 최종 남아있는 모든 품번(사용자가 ×로 지운 건 제외)을 반영
                            for (const el of dialogContainer.children) {
                                const m = (el.textContent || '').match(/([A-Za-z0-9]+-\d+|[A-Za-z]{2,}\d{3,})/);
                                if (m) combinedSet.add(LtxUtil.normalizeCode(m[1]));
                            }
                        } else {
                            for (const code of getMergedWantSet()) {
                                combinedSet.add(code);
                            }
                        }

                        bodyObj[targetField] = Array.from(combinedSet);
                        init = { ...init, body: JSON.stringify(bodyObj) };
                    }
                }
            } catch (e) {
                console.warn('[LTX-Card] save-want 리스트 병합 후킹 중 예외:', e);
            }
            return origFetch.apply(this, [resource, init]);
        };
    })();

    document.addEventListener('click', (e) => {
        const saveWantBtn = e.target.closest('main.main div.bar button.tool.save-want');
        if (!saveWantBtn) return;

        const merged = Array.from(getMergedWantSet());
        if (merged.length > 0) {
            LtxUtil.store.set('ltx.want', merged);
        }
    }, true);

    function syncHeaderWantCounter() {
        const count = getMergedWantSet().size;
        const btn = document.querySelector('header.header button.want');
        if (!btn) return;

        let badgeEl = btn.querySelector('b');
        if (count > 0) {
            if (!badgeEl) {
                badgeEl = document.createElement('b');
                const labelSpan = btn.querySelector('span.label');
                if (labelSpan) copyScopeAttributes(labelSpan, badgeEl);
                btn.appendChild(badgeEl);
            }
            if (badgeEl.textContent !== String(count)) badgeEl.textContent = String(count);
            const nextAria = `보고 싶음 (${count}편)`;
            if (btn.getAttribute('aria-label') !== nextAria) btn.setAttribute('aria-label', nextAria);
        } else {
            if (badgeEl) badgeEl.remove();
            if (btn.getAttribute('aria-label') !== '보고 싶음') btn.setAttribute('aria-label', '보고 싶음');
        }
    }

    // 대표 이름 기반 다중 명의 카드 주입
    function getAliasActorsByQuery(queryName) {
        const cleanQuery = String(queryName || '').trim();
        if (!cleanQuery) return [];
        const direct = LtxActor.actorCache.get(cleanQuery);
        const targetRep = (direct && direct.repName) ? direct.repName.trim() : cleanQuery;

        const aliases = new Set([cleanQuery]);
        for (const entry of LtxActor.actorCache.values()) {
            if ((entry.repName || '').trim() === targetRep) aliases.add(entry.jName);
        }
        return Array.from(aliases);
    }

    function extractCardCode(cardEl) {
        if (!cardEl) return '';
        const fromData = LtxUtil.normalizeCode(cardEl.dataset.code);
        if (fromData) return fromData;
        const codeBtn = cardEl.querySelector('button.code');
        if (codeBtn) {
            const aria = codeBtn.getAttribute('aria-label') || '';
            const m = aria.match(/([A-Za-z0-9]+-\d+|[A-Za-z]{2,}\d{3,})/);
            if (m) return LtxUtil.normalizeCode(m[1]);
            const spanTxt = LtxUtil.normalizeCode(codeBtn.querySelector('span')?.textContent);
            if (spanTxt && !['복사됨', 'COPIED', '已复制'].includes(spanTxt)) return spanTxt;
        }
        return '';
    }

    function createInjectedCardElement(item, templateCard, onOpenListPicker) {
        let scopeAttr = 'data-v-8e3d37a3';
        if (templateCard) {
            for (const attr of templateCard.attributes) {
                if (attr.name.startsWith('data-v-')) { scopeAttr = attr.name; break; }
            }
        }

        const code = LtxUtil.normalizeCode(item.code);
        const card = document.createElement('article');
        card.className = 'card clickable';
        card.dataset.code = code;
        card.dataset.ltxAliasInjected = 'true';

        const codeMatch = code.match(/^(.*?)-?(\d+)$/);
        const prefix = codeMatch ? codeMatch[1] : code;
        const num = codeMatch ? codeMatch[2] : '';
        const title = (item.title || item.title_zh || code).trim();
        const cover = item.cover || '';
        const detailUrl = item.url || '';
        const detailSite = detailUrl.includes('javbus.com') ? 'javbus' : 'javdb';
        const linkStr = item.link || '';
        const sizeLabel = linkStr.startsWith('ed2k://')
            ? `ed2k · ${((Number(linkStr.split('|', 4)[3]) || 0) / (1024 ** 3)).toFixed(1)}G`
            : '마그넷';

        const actors = Array.isArray(item.actors) ? item.actors : [];
        const actorsHtml = actors.length
            ? `<div class="tags">${actors.map(a => `<span class="tag"><button class="tag-name" lang="ja" type="button" title="${LtxUtil.escapeHtml(a)}">${LtxUtil.escapeHtml(a)}</button></span>`).join('')}</div>`
            : '';

        const numScore = Number(item.score);
        const hasScore = item.score !== null && item.score !== undefined && item.score !== '' && Number.isFinite(numScore);
        const votes = Number(item.votes) || 0;
        const scoreHtml = hasScore
            ? `<span class="score" title="javdb ${Number(item.rawScore || 0).toFixed(2)} (${votes}건)"><svg class="icon" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-star"></use></svg>${numScore.toFixed(2)}<small>${votes >= 1000 ? (votes / 1000).toFixed(1) + 'k' : votes}</small></span>`
            : '';

        const isWanted = getMergedWantSet().has(code);
        const toolsHtml = `
            <div class="tools">
                <button class="tool want ${isWanted ? 'on' : ''}" type="button" aria-pressed="${isWanted}" title="${isWanted ? '보고 싶음에서 제거' : '보고 싶음에 추가'}">
                    <svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="${isWanted ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-heart"></use></svg>
                </button>
                ${item.shot ? `<button class="tool eye" type="button" title="스크린샷"><svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-eye"></use></svg></button>` : ''}
                <button class="tool list-pick" type="button" title="리스트에 추가"><svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-listPlus"></use></svg></button>
            </div>
        `;

        card.innerHTML = `
            <div class="cover ${cover ? 'loading' : ''}">
                <div class="ph" aria-hidden="true"><span>${LtxUtil.escapeHtml(prefix)}</span><b>${LtxUtil.escapeHtml(num)}</b></div>
                ${cover ? `<button class="cover-btn" type="button"><img loading="lazy" decoding="async" src="${LtxUtil.escapeHtml(cover)}" alt="" referrerpolicy="no-referrer" /></button>` : `<div class="empty">표지 없음</div>`}
                <button class="code" type="button" title="품번 복사" aria-label="${LtxUtil.escapeHtml(code)} 복사"><span>${LtxUtil.escapeHtml(code)}</span><svg class="icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-copy"></use></svg></button>
                ${toolsHtml}
                ${item.pending ? `<div class="corner"><span class="badge">미확인</span></div>` : ''}
                ${scoreHtml}
            </div>
            <div class="body">
                <h3 class="title" lang="ja" title="${LtxUtil.escapeHtml(title)}"><button class="title-btn" type="button">${LtxUtil.escapeHtml(title)}</button></h3>
                <div class="who">${actorsHtml}${detailUrl ? `<a class="detail" href="${LtxUtil.escapeHtml(detailUrl)}" target="_blank" rel="noopener noreferrer" title="${detailSite}에서 열기"><svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><use href="#i-external"></use></svg></a>` : ''}</div>
                <div class="sub">
                    <span class="meta-wrap"><span class="meta"><span class="date">${LtxUtil.escapeHtml(item.date || '')}</span>${item.maker ? `${item.date ? '<span class="sep">·</span>' : ''}<button class="maker" lang="ja" type="button">${LtxUtil.escapeHtml(item.maker)}</button>` : ''}</span></span>
                    ${item.subtitle ? `<a class="subtitle" href="${LtxUtil.escapeHtml(item.subtitle)}" target="_blank" rel="noopener noreferrer" download="">자</a>` : ''}
                </div>
                ${linkStr ? `<div class="actions"><button class="btn copy-btn" type="button" title="${LtxUtil.escapeHtml(linkStr)}">복사: ${LtxUtil.escapeHtml(sizeLabel)}</button><a class="btn add-btn" href="${LtxUtil.escapeHtml(detailUrl || '#')}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;display:inline-flex;align-items:center;justify-content:center;"><span class="add-long">상세 페이지</span><span class="add-short">상세</span></a></div>` : ''}
            </div>
        `;

        card.setAttribute(scopeAttr, '');
        card.querySelectorAll('*').forEach(el => { if (!el.closest('.ltx-ext-menu-wrap')) el.setAttribute(scopeAttr, ''); });

        const coverEl = card.querySelector('.cover');
        const imgEl = card.querySelector('.cover-btn img');
        if (imgEl && coverEl) {
            imgEl.addEventListener('load', () => { imgEl.classList.add('in'); coverEl.classList.remove('loading'); });
            imgEl.addEventListener('error', () => { coverEl.classList.remove('loading'); imgEl.closest('.cover-btn')?.remove(); });
        }

        card.querySelector('button.tool.want')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const extra = getExtraWantSet();
            const nativeArr = LtxUtil.store.get('ltx.want', []);
            const nativeSet = new Set(Array.isArray(nativeArr) ? nativeArr.map(LtxUtil.normalizeCode) : []);

            const isCurrentlyWanted = extra.has(code) || nativeSet.has(code);
            const nextState = !isCurrentlyWanted;

            if (nextState) {
                extra.add(code);
            } else {
                extra.delete(code);
                // 만약 Vue 원본 목록에도 포함되어 있었다면 제거
                if (nativeSet.has(code)) {
                    const filteredNative = (Array.isArray(nativeArr) ? nativeArr : [])
                        .filter(item => LtxUtil.normalizeCode(item) !== code);
                    LtxUtil.store.set('ltx.want', filteredNative);
                }
            }
            saveExtraWantSet(extra);

            const btn = e.currentTarget;
            btn.classList.toggle('on', nextState);
            btn.setAttribute('aria-pressed', String(nextState));
            btn.setAttribute('title', nextState ? '보고 싶음에서 제거' : '보고 싶음에 추가');
            btn.querySelector('svg')?.setAttribute('fill', nextState ? 'currentColor' : 'none');

            syncHeaderWantCounter();
            if (location.hash === '#want' && !nextState) {
                card.remove();
                injectAliasActorCards(onOpenListPicker);
            }
        });

        if (item.shot) {
            card.querySelector('button.tool.eye')?.addEventListener('click', (e) => {
                e.stopPropagation();
                window.open(item.shot, '_blank', 'noopener,noreferrer');
            });
        }

        card.querySelector('button.tool.list-pick')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onOpenListPicker) onOpenListPicker(code);
        });

        card.querySelector('button.code')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (await LtxUtil.copyText(code)) {
                const btn = e.currentTarget;
                btn.classList.add('done');
                const span = btn.querySelector('span');
                if (span) span.textContent = '복사됨';
                setTimeout(() => { btn.classList.remove('done'); if (span) span.textContent = code; }, 1200);
            }
        });

        card.querySelector('.copy-btn')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (linkStr && await LtxUtil.copyText(linkStr)) {
                const btn = e.currentTarget;
                btn.classList.add('done');
                setTimeout(() => btn.classList.remove('done'), 1200);
            }
        });

        card.querySelectorAll('button.tag-name').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetJ = (btn.dataset.ltxJname || btn.getAttribute('title') || btn.textContent || '').trim();
                if (targetJ) {
                    const url = new URL(location.href);
                    url.pathname = '/';
                    url.search = `?actor=${encodeURIComponent(targetJ)}`;
                    url.hash = '';
                    history.pushState(null, '', url.toString());
                    window.dispatchEvent(new PopStateEvent('popstate'));
                }
            });
        });

        card.querySelectorAll(LtxActor.ACTOR_SPAN_SELECTOR).forEach(LtxActor.bindActorSpan);
        return card;
    }

    let lastInjectedSignature = '';

    function mountInsertedCards(gridEl, frag, insertedCards) {
        gridEl.appendChild(frag);
        for (const cardEl of insertedCards) {
            delete cardEl.dataset.processed;
            modifyCard(cardEl);
            const extWrap = cardEl.querySelector('.ltx-ext-menu-wrap');
            if (extWrap && extWrap.dataset.ltxHoverBound !== 'true') {
                extWrap.dataset.ltxHoverBound = 'true';
                extWrap.addEventListener('mouseenter', () => { closeAllExtMenus(extWrap); extWrap.classList.add('open'); });
                extWrap.addEventListener('mouseleave', () => extWrap.classList.remove('open'));
            }
        }
    }

    function injectAliasActorCards(onOpenListPicker, notifyFn) {
        const mainEl = document.querySelector('main.main');
        if (!mainEl) return;

        const isWantView = location.hash === '#want';
        const params = new URLSearchParams(location.search);
        const actorParam = (params.get('actor') || '').trim();
        const qParam = (params.get('q') || '').trim();
        const searchKeyword = actorParam || qParam;
        const insertMode = LtxActor.getSearchInsertMode();

        let gridEl = mainEl.querySelector('.grid');
        const emptyStage = mainEl.querySelector('.empty-stage');

        const createFallbackGridStage = (attrName) => {
            const gridStage = document.createElement('div');
            gridStage.className = 'grid-stage';
            gridStage.dataset[attrName] = 'true';
            const newGrid = document.createElement('div');
            newGrid.className = 'grid';
            copyScopeAttributes(mainEl, gridStage);
            copyScopeAttributes(mainEl, newGrid);
            newGrid.style.display = 'grid';
            newGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(230px, 1fr))';
            newGrid.style.gap = '16px';
            gridStage.appendChild(newGrid);
            if (emptyStage) { emptyStage.style.display = 'none'; emptyStage.insertAdjacentElement('afterend', gridStage); }
            else mainEl.appendChild(gridStage);
            return newGrid;
        };

        if (isWantView) {
            mainEl.querySelectorAll('.grid-stage[data-ltx-search-stage="true"]').forEach(el => el.remove());
            const hasWantItems = getMergedWantSet().size > 0;
            if (!gridEl && hasWantItems) {
                gridEl = createFallbackGridStage('ltxWantStage');
            } else if (!hasWantItems) {
                mainEl.querySelectorAll('.grid-stage[data-ltx-want-stage="true"]').forEach(el => el.remove());
                if (emptyStage) emptyStage.style.display = '';
            }
        } else {
            mainEl.querySelectorAll('.grid-stage[data-ltx-want-stage="true"]').forEach(el => el.remove());
            gridEl = mainEl.querySelector('.grid');
        }

        if (gridEl && (gridEl.classList.contains('stale') || gridEl.getAttribute('aria-busy') === 'true')) return;

        const cleanupInjected = () => {
            mainEl.querySelectorAll('.grid-stage[data-ltx-search-stage="true"]').forEach(el => el.remove());
            if (emptyStage && !isWantView) emptyStage.style.display = '';
            const curGrid = mainEl.querySelector('.grid');
            if (curGrid) curGrid.querySelectorAll('article.card[data-ltx-alias-injected="true"]').forEach(el => el.remove());
            lastInjectedSignature = '';
            syncBarStatsAndActions(notifyFn);
        };

        if (isWantView) {
            if (!gridEl) return;
            const wantSet = getMergedWantSet();
            const sig = `want::${Array.from(wantSet).join(',')}`;
            if (lastInjectedSignature !== sig) {
                gridEl.querySelectorAll('article.card[data-ltx-alias-injected="true"]').forEach(el => {
                    if (!wantSet.has(extractCardCode(el))) el.remove();
                });
                lastInjectedSignature = sig;
            }
            if (wantSet.size === 0) { cleanupInjected(); return; }

            const existingCodes = new Set();
            const allCards = Array.from(gridEl.querySelectorAll('article.card'));
            for (const c of allCards) {
                const code = extractCardCode(c);
                if (!code) continue;
                if (existingCodes.has(code) && c.dataset.ltxAliasInjected === 'true') { c.remove(); continue; }
                existingCodes.add(code);
            }
            const tpl = allCards.find(c => !c.dataset.ltxAliasInjected) || allCards[0] || null;
            const matched = [];
            const queued = new Set();
            for (const item of LtxIDB.items.values()) {
                const code = LtxUtil.normalizeCode(item?.code);
                if (code && wantSet.has(code) && !existingCodes.has(code) && !queued.has(code)) {
                    queued.add(code);
                    matched.push({ ...item, code });
                }
            }
            if (matched.length > 0) {
                matched.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
                const inserted = [];
                const frag = document.createDocumentFragment();
                for (const it of matched) {
                    existingCodes.add(it.code);
                    const el = createInjectedCardElement(it, tpl, onOpenListPicker);
                    inserted.push(el);
                    frag.appendChild(el);
                }
                mountInsertedCards(gridEl, frag, inserted);
            }
            syncBarStatsAndActions(notifyFn);
            return;
        }

        if (!searchKeyword) { cleanupInjected(); return; }

        const sig = `${insertMode}::${actorParam ? 'actor:' + actorParam : 'q:' + qParam}`;
        if (lastInjectedSignature !== sig) {
            mainEl.querySelectorAll('.grid-stage[data-ltx-search-stage="true"]').forEach(el => el.remove());
            if (emptyStage) emptyStage.style.display = '';
            gridEl = mainEl.querySelector('.grid');
            if (gridEl) gridEl.querySelectorAll('article.card[data-ltx-alias-injected="true"]').forEach(el => el.remove());
            lastInjectedSignature = sig;
        }

        const existingCodes = new Set();
        const allCards = gridEl ? Array.from(gridEl.querySelectorAll('article.card')) : [];
        for (const c of allCards) {
            const code = extractCardCode(c);
            if (!code) continue;
            if (existingCodes.has(code) && c.dataset.ltxAliasInjected === 'true') { c.remove(); continue; }
            existingCodes.add(code);
        }

        const aliasNames = actorParam
            ? (insertMode === 'rep' ? getAliasActorsByQuery(actorParam) : [actorParam])
            : (insertMode === 'rep' ? getAliasActorsByQuery(qParam) : []);
        const aliasSet = new Set(aliasNames);
        const userEditedMap = typeof LtxIDB.getUserEditedMap === 'function' ? LtxIDB.getUserEditedMap() : {};
        const qLower = qParam.toLowerCase();

        const tpl = allCards.find(c => !c.dataset.ltxAliasInjected) || allCards[0] || null;
        const matched = [];
        const queued = new Set();

        for (const item of LtxIDB.items.values()) {
            const code = LtxUtil.normalizeCode(item?.code);
            if (!code || existingCodes.has(code) || queued.has(code)) continue;

            let isMatch = false;
            if (actorParam) {
                isMatch = Array.isArray(item.actors) && item.actors.some(a => aliasSet.has(String(a).trim()));
            } else if (qParam) {
                if (insertMode === 'rep' && aliasNames.length > 1 && Array.isArray(item.actors) && item.actors.some(a => aliasSet.has(String(a).trim()))) {
                    isMatch = true;
                } else if (userEditedMap[code] || userEditedMap[String(item.code || '').trim()]) {
                    if (code.toLowerCase().includes(qLower) || String(item.title || '').toLowerCase().includes(qLower)) {
                        isMatch = true;
                    } else if (Array.isArray(item.actors)) {
                        isMatch = item.actors.some(a => {
                            const clean = String(a || '').trim();
                            if (!clean) return false;
                            if (clean.toLowerCase().includes(qLower) || aliasSet.has(clean)) return true;
                            const c = LtxActor.actorCache.get(clean);
                            return Boolean(c && (
                                (c.kName && c.kName.toLowerCase().includes(qLower)) ||
                                (c.eName && c.eName.toLowerCase().includes(qLower)) ||
                                (c.repName && c.repName.toLowerCase().includes(qLower))
                            ));
                        });
                    }
                }
            }

            if (isMatch) {
                queued.add(code);
                matched.push({ ...item, code });
            }
        }

        if (matched.length > 0) {
            if (!gridEl) gridEl = createFallbackGridStage('ltxSearchStage');
            matched.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
            const inserted = [];
            const frag = document.createDocumentFragment();
            for (const it of matched) {
                existingCodes.add(it.code);
                const el = createInjectedCardElement(it, tpl, onOpenListPicker);
                inserted.push(el);
                frag.appendChild(el);
            }
            mountInsertedCards(gridEl, frag, inserted);
        } else if (!gridEl) {
            if (emptyStage) emptyStage.style.display = '';
        }
        syncBarStatsAndActions(notifyFn);
    }

    function syncBarStatsAndActions(notifyFn) {
        const mainEl = document.querySelector('main.main');
        if (!mainEl) return;

        const params = new URLSearchParams(location.search);
        const searchKeyword = (params.get('actor') || params.get('q') || '').trim();
        const gridEl = mainEl.querySelector('.grid');
        const allCards = gridEl ? Array.from(gridEl.querySelectorAll('article.card')) : [];
        const injectedCards = gridEl ? Array.from(gridEl.querySelectorAll('article.card[data-ltx-alias-injected="true"]')) : [];
        const active = Boolean((location.hash === '#want' || searchKeyword) && injectedCards.length > 0);

        const allEl = mainEl.querySelector('div.status > button.seg.all > i');
        const okEl = mainEl.querySelector('div.status > button.seg.ok > i');
        const penEl = mainEl.querySelector('div.status > button.seg.pending > i');
        const batchBtn = mainEl.querySelector('div.bar-end > button');
        const batchCntEl = batchBtn?.querySelector('b');
        const resultSpan = mainEl.querySelector('div.bar-end > span.result');

        // 4) #want 뷰에서 main > div.bar > button.tool.save-want 숫자 동기화
        const saveWantBtn = mainEl.querySelector('div.bar > button.tool.save-want');
        if (saveWantBtn) {
            const wantCount = getMergedWantSet().size;
            const badge = saveWantBtn.querySelector('b, span.count, i');
            if (badge) {
                if (badge.dataset.ltxOrigText === undefined) badge.dataset.ltxOrigText = badge.textContent;
                if (badge.textContent !== String(wantCount)) badge.textContent = String(wantCount);
            } else {
                // 숫자만 텍스트 노드로 들어있는 경우 치환
                for (const node of saveWantBtn.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE && /\d+/.test(node.textContent)) {
                        const nextText = node.textContent.replace(/\d+/, String(wantCount));
                        if (node.textContent !== nextText) node.textContent = nextText;
                        break;
                    }
                }
            }
        }

        if (!active) {
            [allEl, okEl, penEl, batchCntEl].forEach(el => {
                if (el && el.dataset.ltxOrigText !== undefined) { el.textContent = el.dataset.ltxOrigText; delete el.dataset.ltxOrigText; }
            });
            if (batchBtn) {
                if (batchBtn.dataset.ltxOrigTitle !== undefined) { batchBtn.setAttribute('title', batchBtn.dataset.ltxOrigTitle); delete batchBtn.dataset.ltxOrigTitle; }
                delete batchBtn.dataset.ltxAliasCopyActive;
            }
            if (resultSpan && resultSpan.dataset.ltxOrigHtml !== undefined) {
                resultSpan.innerHTML = resultSpan.dataset.ltxOrigHtml; delete resultSpan.dataset.ltxOrigHtml;
            }
            return;
        }

        let total = 0, ok = 0, pending = 0;
        const links = [];
        const seen = new Set();

        for (const card of allCards) {
            const code = extractCardCode(card);
            if (!code || seen.has(code)) continue;
            seen.add(code);
            total++;

            let item = LtxIDB.items.get(code);
            if (!item) {
                for (const [k, v] of LtxIDB.items.entries()) {
                    if (LtxUtil.normalizeCode(k) === code) { item = v; break; }
                }
            }
            const isPen = item ? Boolean(item.pending) : Boolean(card.querySelector('.corner .badge'));
            isPen ? pending++ : ok++;
            if (item && typeof item.link === 'string' && item.link.trim()) links.push(item.link.trim());
        }

        const setTxt = (el, val) => {
            if (!el) return;
            if (el.dataset.ltxOrigText === undefined) el.dataset.ltxOrigText = el.textContent;
            if (el.textContent !== String(val)) el.textContent = String(val);
        };

        setTxt(allEl, total);
        setTxt(okEl, ok);
        setTxt(penEl, pending);

        if (batchBtn) {
            if (batchBtn.dataset.ltxOrigTitle === undefined) batchBtn.dataset.ltxOrigTitle = batchBtn.getAttribute('title') || '';
            const nextTitle = `${total}편 복사 또는 다운로드`;
            if (batchBtn.getAttribute('title') !== nextTitle) batchBtn.setAttribute('title', nextTitle);
            setTxt(batchCntEl, total);

            batchBtn._ltxMergedLinks = links;
            batchBtn.dataset.ltxAliasCopyActive = 'true';

            if (batchBtn.dataset.ltxAliasClickBound !== 'true') {
                batchBtn.dataset.ltxAliasClickBound = 'true';
                batchBtn.addEventListener('click', async (e) => {
                    if (batchBtn.dataset.ltxAliasCopyActive !== 'true') return;
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    const list = Array.isArray(batchBtn._ltxMergedLinks) ? batchBtn._ltxMergedLinks : [];
                    if (list.length === 0) { alert('복사할 다운로드 링크가 없습니다.'); return; }
                    if (await LtxUtil.copyText(list.join('\n')) && notifyFn) {
                        notifyFn(`${list.length}개 링크 복사됨`);
                    }
                }, true);
            }
        }

        if (resultSpan) {
            if (resultSpan.dataset.ltxOrigHtml === undefined) resultSpan.dataset.ltxOrigHtml = resultSpan.innerHTML;
            const b = resultSpan.querySelector('b');
            if (b) { if (b.textContent !== String(total)) b.textContent = String(total); }
            else { const h = `<b>${total}</b>건`; if (resultSpan.innerHTML !== h) resultSpan.innerHTML = h; }
        }
    }

    function syncSaveWantDialogItems() {
        const container = document.querySelector('form > div.editor-body > div:nth-child(4) > div');
        if (!container || container.dataset.ltxWantInjected === 'true') return;

        // 현재 다이얼로그가 '보고 싶음(want)'에서 열린 리스트 생성 창인지 확인
        const mergedWant = getMergedWantSet();
        if (mergedWant.size === 0) return;

        // 컨테이너 내부에 이미 렌더링된 품번 목록 추출
        const existingItems = Array.from(container.children);
        if (existingItems.length === 0) return;

        const existingCodes = new Set();
        for (const el of existingItems) {
            const m = (el.textContent || '').match(/([A-Za-z0-9]+-\d+|[A-Za-z]{2,}\d{3,})/);
            if (m) existingCodes.add(LtxUtil.normalizeCode(m[1]));
        }

        // 다이얼로그에 표시된 항목 중 하나라도 want 목록과 겹치면 save-want 다이얼로그로 판정
        const isWantDialog = Array.from(existingCodes).some(c => mergedWant.has(c));
        if (!isWantDialog) return;

        const missingCodes = Array.from(mergedWant).filter(c => !existingCodes.has(c));
        if (missingCodes.length === 0) {
            container.dataset.ltxWantInjected = 'true';
            return;
        }

        // 기존 항목 DOM(칩/행)의 스타일과 Vue scope 속성을 그대로 복제하여 누락된 품번 추가
        const templateEl = existingItems[0];
        for (const code of missingCodes) {
            const clone = templateEl.cloneNode(true);
            clone.dataset.ltxInjectedDialogCode = code;

            // 텍스트 노드 중 원본 품번 부분을 새 품번으로 교체
            const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null);
            let replaced = false;
            let txtNode;
            while ((txtNode = walker.nextNode())) {
                if (/([A-Za-z0-9]+-\d+|[A-Za-z]{2,}\d{3,})/.test(txtNode.nodeValue)) {
                    txtNode.nodeValue = txtNode.nodeValue.replace(/([A-Za-z0-9]+-\d+|[A-Za-z]{2,}\d{3,})/, code);
                    replaced = true;
                    break;
                }
            }
            if (!replaced) clone.textContent = code;

            // 복제된 항목 내 삭제(×) 버튼 클릭 시 DOM에서 제거 및 getMergedWantSet 동기화
            const removeBtn = clone.querySelector('button');
            if (removeBtn) {
                removeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clone.remove();
                    updateDialogCountLabels(container);
                });
            }

            container.appendChild(clone);
        }

        container.dataset.ltxWantInjected = 'true';
        updateDialogCountLabels(container);
    }

    function updateDialogCountLabels(container) {
        const form = container.closest('form');
        if (!form) return;
        const currentCount = container.children.length;
        // 다이얼로그 라벨(예: "작품 (12편)" 또는 "12개")의 숫자 갱신
        const labelEl = form.querySelector('div.editor-body > div:nth-child(4) label, div.editor-body > div:nth-child(4) > span');
        if (labelEl && /\d+/.test(labelEl.textContent)) {
            labelEl.textContent = labelEl.textContent.replace(/\d+/, String(currentCount));
        }
    }

    function syncActorPanelUserActors() {
        const panel = document.querySelector('#actor-panel');
        if (!panel || typeof LtxIDB === 'undefined' || typeof LtxIDB.getUserEditedMap !== 'function') return;

        const panelInput = panel.querySelector('div.head input');
        if (panelInput && panelInput.dataset.ltxPanelSyncBound !== 'true') {
            panelInput.dataset.ltxPanelSyncBound = 'true';
            panelInput.addEventListener('input', () => requestAnimationFrame(syncActorPanelUserActors));
        }

        const userEditedMap = LtxIDB.getUserEditedMap();
        const userActors = new Set();
        for (const entry of Object.values(userEditedMap)) {
            if (Array.isArray(entry?.actors)) {
                for (const a of entry.actors) {
                    const clean = String(a || '').trim();
                    if (clean) userActors.add(clean);
                }
            }
        }
        if (userActors.size === 0) {
            panel.querySelectorAll('[data-ltx-user-actor="true"]').forEach(el => el.remove());
            return;
        }

        const actorWorkCounts = new Map();
        for (const item of LtxIDB.items.values()) {
            if (!Array.isArray(item?.actors)) continue;
            for (const a of item.actors) {
                const clean = String(a || '').trim();
                if (userActors.has(clean)) actorWorkCounts.set(clean, (actorWorkCounts.get(clean) || 0) + 1);
            }
        }

        panel.querySelectorAll('[data-ltx-user-actor="true"]').forEach(el => el.remove());

        const nativeSpans = Array.from(panel.querySelectorAll('span.name[lang="ja"]'));
        const existingJNames = new Set();
        let templateRow = null;
        let listContainer = null;

        for (const sp of nativeSpans) {
            const jName = (sp.dataset.ltxJname || sp.textContent || '').trim();
            if (jName) existingJNames.add(jName);
            if (!templateRow) {
                const row = sp.closest('button, a, li') || sp.parentElement;
                if (row && row.parentElement && !row.closest('.head')) {
                    templateRow = row;
                    listContainer = row.parentElement;
                }
            }
        }

        if (!listContainer) {
            listContainer = panel.querySelector('.list, ul, .body, .actors') || panel.querySelector('div.head')?.nextElementSibling;
        }
        if (!listContainer) return;

        const panelQuery = (panelInput?.value || '').trim();
        const qL = panelQuery.toLowerCase();
        const qC = qL.replace(/\s+/g, '');
        const useCho = panelQuery ? LtxUtil.isChosungQuery(panelQuery) : false;

        const toInject = [];
        for (const jName of userActors) {
            if (existingJNames.has(jName)) continue;
            if (panelQuery) {
                const cached = typeof LtxActor !== 'undefined' ? LtxActor.actorCache.get(jName) : null;
                const score = Math.max(
                    LtxUtil.matchStringOrChosung(jName, qL, qC, false),
                    cached ? LtxUtil.matchStringOrChosung(cached.kName, qL, qC, useCho) : 0,
                    cached ? LtxUtil.matchStringOrChosung(cached.eName, qL, qC, false) : 0,
                    cached ? LtxUtil.matchStringOrChosung(cached.repName, qL, qC, useCho) : 0
                );
                if (score <= 0) continue;
            }
            toInject.push(jName);
        }

        if (toInject.length === 0) return;

        const frag = document.createDocumentFragment();
        for (const jName of toInject) {
            const cnt = actorWorkCounts.get(jName) || 1;
            let row;
            if (templateRow) {
                row = templateRow.cloneNode(true);
                row.classList.remove('active', 'selected', 'on');
                const nameSpan = row.querySelector('span.name[lang="ja"]');
                if (nameSpan) {
                    delete nameSpan.dataset.ltxJname;
                    delete nameSpan.dataset.ltxBound;
                    nameSpan.textContent = jName;
                }
                const cntEl = row.querySelector('b, small, i, .count, span:not(.name)');
                if (cntEl && /\d+/.test(cntEl.textContent)) {
                    cntEl.textContent = cntEl.textContent.replace(/\d+/, String(cnt));
                }
            } else {
                row = document.createElement('button');
                row.type = 'button';
                row.className = 'actor-item';
                copyScopeAttributes(panel, row);
                row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;width:100%;padding:6px 10px;background:transparent;border:none;color:inherit;cursor:pointer;text-align:left;';
                row.innerHTML = `<span class="name" lang="ja">${LtxUtil.escapeHtml(jName)}</span><small>${cnt}</small>`;
            }
            row.dataset.ltxUserActor = 'true';
            row.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const url = new URL(location.href);
                url.pathname = '/';
                url.search = `?actor=${encodeURIComponent(jName)}`;
                url.hash = '';
                history.pushState(null, '', url.toString());
                window.dispatchEvent(new PopStateEvent('popstate'));
            });
            if (typeof LtxActor !== 'undefined') {
                row.querySelectorAll(LtxActor.ACTOR_SPAN_SELECTOR).forEach(LtxActor.bindActorSpan);
            }
            frag.appendChild(row);
        }
        listContainer.appendChild(frag);
    }

    return {
        MAX_EXT_SITES,
        getExtSites: () => extSites,
        setExtSites: (next) => { extSites = next; saveExtSites(); },
        saveExtSites,
        updateExtSitesCountUI,
        mergeExtSites,
        resetExtSites,
        closeAllExtMenus,
        modifyCard,
        refreshUserPatchedCards,
        getExtraWantSet,
        getMergedWantSet,
        mergeWantCodes,
        resetExtraWant,
        syncHeaderWantCounter,
        injectAliasActorCards,
        syncActorPanelUserActors,
        syncBarStatsAndActions,
        syncSaveWantDialogItems
    };
})();
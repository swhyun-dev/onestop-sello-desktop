// app/renderer/renderer.js
const STORAGE_KEY = "onestop_sello_desktop_ui_settings_v1";

const aliState = {
    currentItemNo: null,
    selectedMap: new Map(),
    currentPage: 1
};

const els = {
    rangeInput: document.getElementById("rangeInput"),
    headlessInput: document.getElementById("headlessInput"),

    onestopUserIdInput: document.getElementById("onestopUserIdInput"),
    onestopPasswordInput: document.getElementById("onestopPasswordInput"),
    selloCookieInput: document.getElementById("selloCookieInput"),

    aliOpenPrepareBtn: document.getElementById("aliOpenPrepareBtn"),
    aliConfirmReadyBtn: document.getElementById("aliConfirmReadyBtn"),

    aliClearSelectionBtn: document.getElementById("aliClearSelectionBtn"),
    aliPrevPageBtn: document.getElementById("aliPrevPageBtn"),
    aliNextPageBtn: document.getElementById("aliNextPageBtn"),
    aliLoadMoreBtn: document.getElementById("aliLoadMoreBtn"),
    aliPageInfo: document.getElementById("aliPageInfo"),
    manualAliSearchBtn: document.getElementById("manualAliSearchBtn"),

    aliCandidatesContainer: document.getElementById("aliCandidatesContainer"),
    aliSelectionInfo: document.getElementById("aliSelectionInfo"),
    aliEmptyState: document.getElementById("aliEmptyState"),

    aliChoiceSection: document.getElementById("aliChoiceSection"),
    aliChoiceContainer: document.getElementById("aliChoiceContainer"),

    aliSelectionDockInfo: document.getElementById("aliSelectionDockInfo"),
    aliSelectionDockList: document.getElementById("aliSelectionDockList"),
    aliSelectionDockEmpty: document.getElementById("aliSelectionDockEmpty"),
    aliDockClearBtn: document.getElementById("aliDockClearBtn"),

    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    retryBtn: document.getElementById("retryBtn"),
    smartYesBtn: document.getElementById("smartYesBtn"),
    smartNoBtn: document.getElementById("smartNoBtn"),
    coupangYesBtn: document.getElementById("coupangYesBtn"),
    passBtn: document.getElementById("passBtn"),
    refreshUiBtn: document.getElementById("refreshUiBtn"),
    clearSavedBtn: document.getElementById("clearSavedBtn"),
    editCurrentBtn: document.getElementById("editCurrentBtn"),
    editByNoBtn: document.getElementById("editByNoBtn"),
    keywordInput: document.getElementById("keywordInput"),
    passReasonEtcInput: document.getElementById("passReasonEtcInput"),

    statusText: document.getElementById("statusText"),
    workflowText: document.getElementById("workflowText"),
    progressText: document.getElementById("progressText"),
    currentNoText: document.getElementById("currentNoText"),
    searchKeywordText: document.getElementById("searchKeywordText"),
    countText: document.getElementById("countText"),

    aliLoadingCard: document.getElementById("aliLoadingCard"),
    aliLoadingText: document.getElementById("aliLoadingText"),
    reviewLoadingCard: document.getElementById("reviewLoadingCard"),
    reviewLoadingText: document.getElementById("reviewLoadingText"),

    noticeCard: document.getElementById("noticeCard"),
    noticeText: document.getElementById("noticeText"),

    onestopImage: document.getElementById("onestopImage"),
    onestopTitle: document.getElementById("onestopTitle"),
    onestopPrice: document.getElementById("onestopPrice"),
    onestopUrl: document.getElementById("onestopUrl"),
    onestopOptions: document.getElementById("onestopOptions"),

    smartImage: document.getElementById("smartImage"),
    smartTitle: document.getElementById("smartTitle"),
    smartMeta: document.getElementById("smartMeta"),
    smartUrl: document.getElementById("smartUrl"),

    coupangImage: document.getElementById("coupangImage"),
    coupangTitle: document.getElementById("coupangTitle"),
    coupangMeta: document.getElementById("coupangMeta"),
    coupangUrl: document.getElementById("coupangUrl"),

    logBox: document.getElementById("logBox")
};

function hasApi() {
    return !!(window.crawlerApi && typeof window.crawlerApi.startJob === "function");
}

function setImg(el, src) {
    el.src = src || "";
    el.style.visibility = src ? "visible" : "hidden";
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getAliItemKey(item) {
    if (!item) return "";
    return String(item.image || item.url || item.id || "").trim();
}

function hasSelectedAliItem(item) {
    const key = getAliItemKey(item);
    if (!key) return false;
    return aliState.selectedMap.has(key);
}

function addSelectedAliItem(item) {
    const key = getAliItemKey(item);
    if (!key) return;
    if (aliState.selectedMap.has(key)) return;
    aliState.selectedMap.set(key, {
        image: item.image || "",
        url: item.url || "",
        id: item.id || "",
        title: item.title || ""
    });
}

function removeSelectedAliItem(itemOrKey) {
    const key = typeof itemOrKey === "string" ? itemOrKey : getAliItemKey(itemOrKey);
    if (!key) return;
    aliState.selectedMap.delete(key);
}

function getSelectedAliEntries() {
    return Array.from(aliState.selectedMap.entries()).slice(0, 10).map(([key, item], idx) => ({
        key,
        item,
        order: idx + 1
    }));
}

function getSelectedAliCandidates() {
    return getSelectedAliEntries().map(({ item }) => item);
}

function resetAliSelectionForItem(itemNo) {
    aliState.currentItemNo = itemNo || null;
    aliState.selectedMap.clear();
    aliState.currentPage = 1;
}

function flattenAliPages(aliPages) {
    const out = [];
    (Array.isArray(aliPages) ? aliPages : []).forEach((page, pageIndex) => {
        (Array.isArray(page) ? page : []).forEach((item, itemIndex) => {
            out.push({
                ...item,
                __page: pageIndex + 1,
                __pageIndex: itemIndex
            });
        });
    });
    return out;
}

function renderOnestopOptions(options) {
    if (!els.onestopOptions) return;

    const groups = Array.isArray(options) ? options : [];
    if (!groups.length) {
        els.onestopOptions.innerHTML = `<div class="meta small">옵션 없음</div>`;
        return;
    }

    els.onestopOptions.innerHTML = groups.map((group) => {
        const optionName = escapeHtml(group?.optionName || "옵션");
        const values = Array.isArray(group?.values) ? group.values : [];

        const chips = values.length
            ? values.map((value) => {
                const name = escapeHtml(value?.name || "");
                const diff = Number(value?.diff || 0);
                const diffText = diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : "";
                return `
                    <div style="padding:2px 6px;border:1px solid #d1d5db;border-radius:999px;font-size:12px;background:#fff;">
                        ${name}${escapeHtml(diffText)}
                    </div>
                `;
            }).join("")
            : `<div class="meta small">값 없음</div>`;

        return `
            <div style="margin-top:8px;">
                <div style="font-weight:700;margin-bottom:6px;">${optionName}</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${chips}
                </div>
            </div>
        `;
    }).join("");
}

function renderNotice(message) {
    if (message) {
        els.noticeCard.style.display = "block";
        els.noticeText.textContent = message;
    } else {
        els.noticeCard.style.display = "none";
        els.noticeText.textContent = "-";
    }
}

function getWorkflowLabel(stage) {
    const map = {
        SEARCHING: "검색 중",
        KEYWORD_FIX: "검색어 수정/패스 대기",
        REVIEW: "통합 검토",
        WAITING_DECISION: "사용자 입력 대기"
    };
    return map[String(stage || "").trim()] || "-";
}

function renderLoading(state) {
    const current = state?.current || {};
    const aliLoading = !!current?.isAliLoading;
    const reviewLoading = !!current?.isReviewLoading;

    if (els.aliLoadingCard) {
        els.aliLoadingCard.style.display = aliLoading ? "block" : "none";
    }
    if (els.aliLoadingText) {
        els.aliLoadingText.textContent = current?.aliLoadingText || "알리 이미지를 불러오는 중입니다...";
    }

    if (els.reviewLoadingCard) {
        els.reviewLoadingCard.style.display = reviewLoading ? "block" : "none";
    }
    if (els.reviewLoadingText) {
        els.reviewLoadingText.textContent = current?.reviewLoadingText || "셀록홈즈 후보를 불러오는 중입니다...";
    }
}

function getFormSettings() {
    return {
        rangeText: els.rangeInput.value.trim(),
        headless: !!els.headlessInput.checked,
        onestopUserId: els.onestopUserIdInput.value.trim(),
        onestopPassword: els.onestopPasswordInput.value,
        selloCookie: els.selloCookieInput.value.trim()
    };
}

function saveUiSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(getFormSettings()));
    } catch (error) {
        console.warn("localStorage 저장 실패:", error);
    }
}

function loadUiSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;

        const saved = JSON.parse(raw);
        els.rangeInput.value = saved.rangeText || "1~20";
        els.headlessInput.checked = !!saved.headless;
        els.onestopUserIdInput.value = saved.onestopUserId || "";
        els.onestopPasswordInput.value = saved.onestopPassword || "";
        els.selloCookieInput.value = saved.selloCookie || "";
    } catch (error) {
        console.warn("localStorage 불러오기 실패:", error);
    }
}

function clearUiSettings() {
    localStorage.removeItem(STORAGE_KEY);
}

function bindAutoSave() {
    const saveTargets = [
        els.rangeInput,
        els.headlessInput,
        els.onestopUserIdInput,
        els.onestopPasswordInput,
        els.selloCookieInput
    ];

    for (const el of saveTargets) {
        const eventName = el.type === "checkbox" ? "change" : "input";
        el.addEventListener(eventName, saveUiSettings);
    }
}

function bindKeywordEditingState() {
    els.keywordInput.addEventListener("focus", () => {
        els.keywordInput.dataset.userEditing = "1";
    });

    els.keywordInput.addEventListener("blur", () => {
        delete els.keywordInput.dataset.userEditing;
    });
}

function getSelectedPassReason() {
    const checked = document.querySelector('input[name="passReason"]:checked');
    const code = checked ? checked.value : "other";
    const etcText = els.passReasonEtcInput.value.trim();

    const labelMap = {
        different_image: "다른 이미지가 나옴",
        no_image: "아무런 이미지가 안나옴",
        discontinued: "단종상품 / 더이상 판매 안하는 상품",
        other: etcText || "기타 사유"
    };

    return {
        passReasonCode: code,
        passReasonText: labelMap[code] || etcText || "기타 사유"
    };
}

function updateAliSelectionInfo(totalPages) {
    const countText = `선택 ${aliState.selectedMap.size} / 10`;
    els.aliSelectionInfo.textContent = countText;
    els.aliPageInfo.textContent = `${aliState.currentPage} / ${Math.max(totalPages, 1)}`;
    els.aliSelectionDockInfo.textContent = countText;
}

function buildSelectedImageCard(entry) {
    const image = escapeHtml(entry?.item?.image || "");
    const order = Number(entry?.order || 0);
    const key = escapeHtml(entry?.key || "");

    return `
        <div class="selected-image-card" data-selected-key="${key}" title="선택 ${order}">
            <button type="button" class="selected-image-remove" data-remove-selected-key="${key}" aria-label="선택 제거">×</button>
            <img src="${image}" alt="" />
            <div class="selected-image-order">${order}</div>
            <div class="selected-image-card-hint">선택 ${order}</div>
        </div>
    `;
}

function bindSelectedLeftEvents() {
    const removeButtons = document.querySelectorAll("[data-remove-selected-key]");
    removeButtons.forEach((btn) => {
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = btn.getAttribute("data-remove-selected-key");
            removeSelectedAliItem(key);
            renderSelectedLeftPanel();
            const current = window.__lastCrawlerState?.current || {};
            renderAliCandidates(current.aliCandidatePages || [], current.workflowStage || "SEARCHING", current.onestop?.no || null);
        });
    });
}

function renderSelectedLeftPanel() {
    const selectedEntries = getSelectedAliEntries();

    if (!selectedEntries.length) {
        els.aliSelectionDockList.innerHTML = "";
        els.aliSelectionDockEmpty.style.display = "block";
        return;
    }

    els.aliSelectionDockEmpty.style.display = "none";
    els.aliSelectionDockList.innerHTML = selectedEntries
        .map((entry) => buildSelectedImageCard(entry))
        .join("");

    bindSelectedLeftEvents();
}

async function renderAliChoiceImages(choiceImages = []) {
    const items = Array.isArray(choiceImages) ? choiceImages : [];

    if (!items.length) {
        els.aliChoiceSection.style.display = "none";
        els.aliChoiceContainer.innerHTML = "";
        return;
    }

    els.aliChoiceSection.style.display = "block";
    els.aliChoiceContainer.innerHTML = items.map((item, idx) => {
        const image = escapeHtml(item?.image || "");
        const active = item?.selected ? "is-active" : "";
        return `
            <button type="button" class="ali-choice-item ${active}" data-choice-index="${idx}" title="상품 선택 ${idx + 1}">
                <img src="${image}" alt="" />
                ${item?.selected ? `<div class="ali-choice-badge">✓</div>` : ""}
            </button>
        `;
    }).join("");

    const buttons = els.aliChoiceContainer.querySelectorAll("[data-choice-index]");
    buttons.forEach((button) => {
        button.addEventListener("click", async () => {
            if (!hasApi()) {
                alert("preload 연결 실패");
                return;
            }

            const index = Number(button.getAttribute("data-choice-index"));
            if (!Number.isFinite(index)) return;

            const current = window.__lastCrawlerState?.current || {};
            const onestopNo = Number(current?.onestop?.no || 0);
            if (!onestopNo) {
                alert("현재 상품번호가 없습니다.");
                return;
            }

            try {
                const res = await window.crawlerApi.selectAliChoiceImage({
                    index,
                    onestopNo,
                    maxItemsPerPage: 36
                });

                if (!res?.ok) {
                    alert(res?.message || "알리 상품 선택 재검색 실패");
                    return;
                }

                await refreshState();
            } catch (error) {
                alert(`알리 상품 선택 재검색 실패: ${String(error?.message || error)}`);
            }
        });
    });
}

function renderAliCandidates(aliPages = [], workflowStage = "SEARCHING", itemNo = null) {
    if (aliState.currentItemNo !== itemNo) {
        resetAliSelectionForItem(itemNo);
    }

    const pages = Array.isArray(aliPages) ? aliPages : [];
    const totalPages = pages.length || 1;

    if (aliState.currentPage > totalPages) {
        aliState.currentPage = totalPages;
    }

    const pageItems = Array.isArray(pages[aliState.currentPage - 1]) ? pages[aliState.currentPage - 1] : [];
    els.aliCandidatesContainer.innerHTML = "";

    if (!flattenAliPages(pages).length) {
        els.aliEmptyState.style.display = "block";
        els.aliCandidatesContainer.style.display = "none";
        updateAliSelectionInfo(totalPages);
        renderSelectedLeftPanel();

        const isAliLoading = !!window.__lastCrawlerState?.current?.isAliLoading;
        els.aliPrevPageBtn.disabled = true;
        els.aliNextPageBtn.disabled = isAliLoading;
        if (els.aliLoadMoreBtn) {
            els.aliLoadMoreBtn.disabled = true;
            els.aliLoadMoreBtn.textContent = "더 없음";
        }
        return;
    }

    els.aliEmptyState.style.display = "none";
    els.aliCandidatesContainer.style.display = "grid";

    pageItems.forEach((item) => {
        const selected = hasSelectedAliItem(item);
        const selectedEntries = getSelectedAliEntries();
        const key = getAliItemKey(item);
        const order = selectedEntries.find((entry) => entry.key === key)?.order || 0;

        const card = document.createElement("button");
        card.type = "button";
        card.className = `ali-item ${selected ? "is-selected" : ""}`;

        card.innerHTML = `
            <div class="ali-thumb-wrap">
                <img src="${escapeHtml(item?.image || "")}" alt="" class="ali-thumb" />
                <div class="ali-check">${selected ? "선택됨" : "선택"}</div>
                ${selected ? `<div class="ali-order-badge">${order}</div>` : ""}
            </div>
        `;

        card.addEventListener("click", () => {
            if (workflowStage !== "REVIEW") return;

            if (hasSelectedAliItem(item)) {
                removeSelectedAliItem(item);
            } else {
                if (aliState.selectedMap.size >= 10) {
                    alert("알리 이미지는 최대 10개까지 선택할 수 있습니다.");
                    return;
                }
                addSelectedAliItem(item);
            }

            renderSelectedLeftPanel();
            renderAliCandidates(aliPages, workflowStage, itemNo);
        });

        els.aliCandidatesContainer.appendChild(card);
    });

    const isAliLoading = !!window.__lastCrawlerState?.current?.isAliLoading;
    const current = window.__lastCrawlerState?.current || {};
    const canLoadMore = current?.aliHasMore !== false;

    els.aliPrevPageBtn.disabled = isAliLoading || aliState.currentPage <= 1;
    els.aliNextPageBtn.disabled = isAliLoading;
    if (els.aliLoadMoreBtn) {
        els.aliLoadMoreBtn.disabled = isAliLoading || !canLoadMore;
        els.aliLoadMoreBtn.textContent = isAliLoading
            ? "불러오는 중..."
            : (canLoadMore ? "더보기" : "더 없음");
    }

    updateAliSelectionInfo(totalPages);
    renderSelectedLeftPanel();
}

function renderState(state) {
    window.__lastCrawlerState = state;
    const current = state.current || {};
    const counts = state.counts || {};
    const decision = state.pendingDecision || {};
    const stage = String(current.workflowStage || "");

    els.statusText.textContent = state.status || "대기중";
    els.workflowText.textContent = `단계: ${getWorkflowLabel(stage)}`;
    els.progressText.textContent = `${state.progress?.processed || 0} / ${state.progress?.total || 0}`;
    els.currentNoText.textContent = `상품번호: ${current.onestop?.no || "-"}`;
    els.searchKeywordText.textContent = `검색어: ${current.searchKeyword || "-"}`;
    els.countText.textContent =
        `smartstore ${counts.smartstore || 0} / coupang ${counts.coupang || 0} / passed ${counts.passed || 0} / errors ${counts.errors || 0}`;

    renderLoading(state);
    renderNotice(current.noticeMessage || "");

    setImg(els.onestopImage, current.onestop?.thumbnailUrl || "");
    els.onestopTitle.textContent = current.onestop?.title || "-";
    els.onestopPrice.textContent = current.onestop?.priceText || String(current.onestop?.price || "-");
    els.onestopUrl.textContent = current.onestop?.url || "-";
    renderOnestopOptions(current.onestop?.options || []);

    setImg(els.smartImage, current.smartCandidate?.image || "");
    els.smartTitle.textContent = current.smartCandidate?.title || "-";
    els.smartMeta.textContent = current.smartCandidate?.mallName
        ? `${current.smartCandidate?.mallName || "-"} / ${current.smartCandidate?.priceText || "-"}`
        : "-";
    els.smartUrl.textContent = current.smartCandidate?.link || "-";

    setImg(els.coupangImage, current.coupangCandidate?.image || "");
    els.coupangTitle.textContent = current.coupangCandidate?.title || "-";
    els.coupangMeta.textContent = current.coupangCandidate?.mallName
        ? `${current.coupangCandidate?.mallName || "-"} / ${current.coupangCandidate?.priceText || "-"}`
        : "-";
    els.coupangUrl.textContent = current.coupangCandidate?.link || "-";

    if (decision.searchKeyword && !els.keywordInput.dataset.userEditing) {
        els.keywordInput.value = decision.searchKeyword;
    }

    renderAliChoiceImages(current.aliChoiceImages || []);
    renderAliCandidates(current.aliCandidatePages || [], stage, current.onestop?.no || null);
    els.logBox.textContent = (state.logs || []).slice(-300).join("\n");
}

async function refreshState() {
    if (!hasApi()) {
        els.statusText.textContent = "PRELOAD 연결 실패";
        els.logBox.textContent = "window.crawlerApi가 없습니다.";
        return;
    }

    try {
        const state = await window.crawlerApi.getState();
        renderState(state);
    } catch (error) {
        els.logBox.textContent = `state:get 실패\n${String(error?.message || error)}`;
    }
}

async function handleDecision(payload, failMessage) {
    if (!hasApi()) {
        alert("preload 연결 실패");
        return;
    }

    try {
        const res = await window.crawlerApi.submitDecision(payload);

        if (!res?.ok) {
            alert(res?.message || failMessage);
            return;
        }

        await refreshState();
    } catch (error) {
        console.error(error);
        alert(`${failMessage}: ${String(error?.message || error)}`);
    }
}

async function getCurrentReviewState() {
    const state = await window.crawlerApi.getState();
    return state?.current || {};
}

async function startEditFlow(onestopNo) {
    if (!hasApi()) {
        alert("preload 연결 실패");
        return;
    }

    if (!window.crawlerApi.startEditItem) {
        alert("startEditItem API가 없습니다. preload / ipc 반영 후 앱을 완전히 재실행해주세요.");
        return;
    }

    const settings = getFormSettings();
    if (!settings.selloCookie) {
        alert("셀록홈즈 Cookie 전체 문자열을 입력해주세요.");
        return;
    }

    const ok = window.confirm(
        `${onestopNo}번 상품을 다시 선택하시겠습니까?\n기존 저장 결과는 같은 상품번호 기준으로 교체됩니다.`
    );
    if (!ok) return;

    try {
        const res = await window.crawlerApi.startEditItem({
            onestopNo,
            headless: settings.headless,
            selloCookie: settings.selloCookie
        });

        if (!res?.ok) {
            alert(res?.message || "재선택 시작 실패");
            return;
        }

        alert(`${onestopNo}번 재선택 모드를 시작했습니다.`);
        await refreshState();
    } catch (error) {
        alert(`재선택 시작 실패: ${String(error?.message || error)}`);
    }
}

async function startManualAliSearchFlow() {
    if (!hasApi()) {
        alert("preload 연결 실패");
        return;
    }

    if (!window.crawlerApi.pickImageAndSearchAli) {
        alert("pickImageAndSearchAli API가 없습니다. preload / ipc 반영 후 앱을 완전히 재실행해주세요.");
        return;
    }

    const state = await window.crawlerApi.getState();
    const currentNo = Number(state?.current?.onestop?.no);
    const stage = String(state?.current?.workflowStage || "");

    if (!Number.isFinite(currentNo) || currentNo <= 0) {
        alert("현재 상품번호가 없습니다.");
        return;
    }

    if (!["REVIEW", "KEYWORD_FIX", "SEARCHING"].includes(stage)) {
        alert("현재 단계에서는 알리 수동 재검색을 사용할 수 없습니다.");
        return;
    }

    try {
        const res = await window.crawlerApi.pickImageAndSearchAli({
            onestopNo: currentNo,
            maxItemsPerPage: 36
        });

        if (!res?.ok) {
            alert(res?.message || "알리 수동 재검색 실패");
            await refreshState();
            return;
        }

        await refreshState();
    } catch (error) {
        alert(`알리 수동 재검색 실패: ${String(error?.message || error)}`);
    }
}

els.aliPrevPageBtn.addEventListener("click", async () => {
    const current = await getCurrentReviewState();
    const totalPages = Array.isArray(current.aliCandidatePages) ? current.aliCandidatePages.length : 1;

    if (aliState.currentPage > 1) {
        aliState.currentPage -= 1;
        renderAliCandidates(current.aliCandidatePages || [], current.workflowStage || "SEARCHING", current.onestop?.no || null);
        updateAliSelectionInfo(totalPages);
    }
});

els.aliNextPageBtn.addEventListener("click", async () => {
    const current = await getCurrentReviewState();
    const loadedPages = Array.isArray(current.aliCandidatePages) ? current.aliCandidatePages : [];
    const totalLoadedPages = loadedPages.length || 1;

    if (aliState.currentPage < totalLoadedPages) {
        aliState.currentPage += 1;
        renderAliCandidates(loadedPages, current.workflowStage || "SEARCHING", current.onestop?.no || null);
        updateAliSelectionInfo(totalLoadedPages);
        return;
    }

    try {
        const res = await window.crawlerApi.getAliNextPage({ maxItemsPerPage: 36 });

        if (!res?.ok) {
            alert(res?.message || "다음 페이지가 없습니다.");
            return;
        }

        aliState.currentPage = Number(res.page) || aliState.currentPage;
        await refreshState();
    } catch (error) {
        alert(`알리 다음 페이지 로딩 실패: ${String(error?.message || error)}`);
    }
});

els.aliLoadMoreBtn.addEventListener("click", async () => {
    if (!hasApi()) {
        alert("preload 연결 실패");
        return;
    }

    try {
        const res = await window.crawlerApi.loadAliMore({ maxItemsPerBatch: 36 });

        if (!res?.ok) {
            alert(res?.message || "더보기 실패");
            return;
        }

        await refreshState();
    } catch (error) {
        alert(`더보기 실패: ${String(error?.message || error)}`);
    }
});

els.aliClearSelectionBtn.addEventListener("click", async () => {
    aliState.selectedMap.clear();
    renderSelectedLeftPanel();
    const current = await getCurrentReviewState();
    renderAliCandidates(current.aliCandidatePages || [], current.workflowStage || "SEARCHING", current.onestop?.no || null);
});

if (els.aliDockClearBtn) {
    els.aliDockClearBtn.addEventListener("click", async () => {
        aliState.selectedMap.clear();
        renderSelectedLeftPanel();
        const current = await getCurrentReviewState();
        renderAliCandidates(current.aliCandidatePages || [], current.workflowStage || "SEARCHING", current.onestop?.no || null);
    });
}

els.manualAliSearchBtn.addEventListener("click", async () => {
    await startManualAliSearchFlow();
});

els.aliOpenPrepareBtn.addEventListener("click", async () => {
    if (!hasApi()) {
        alert("preload 연결 실패");
        return;
    }

    try {
        const res = await window.crawlerApi.openAliPrepare({
            headless: false
        });

        if (!res?.ok) {
            alert(res?.message || "알리 준비 창 열기 실패");
            return;
        }

        alert("알리 창을 열었습니다.\n팝업 닫기/로그인/이미지검색 업로드창 준비 후 '알리 준비 완료'를 눌러주세요.");
        await refreshState();
    } catch (error) {
        alert(`알리 준비 창 열기 실패: ${String(error?.message || error)}`);
    }
});

els.aliConfirmReadyBtn.addEventListener("click", async () => {
    if (!hasApi()) {
        alert("preload 연결 실패");
        return;
    }

    try {
        const res = await window.crawlerApi.confirmAliReady();

        if (!res?.ok) {
            alert(res?.message || "알리 준비 완료 확인 실패");
            return;
        }

        alert("알리 준비 완료가 확인되었습니다. 이제 시작 버튼을 눌러 진행하세요.");
        await refreshState();
    } catch (error) {
        alert(`알리 준비 완료 확인 실패: ${String(error?.message || error)}`);
    }
});

els.startBtn.addEventListener("click", async () => {
    if (!hasApi()) {
        alert("preload 연결 실패");
        return;
    }

    const settings = getFormSettings();

    if (!settings.selloCookie) {
        alert("셀록홈즈 Cookie 전체 문자열을 입력해주세요.");
        return;
    }

    saveUiSettings();

    try {
        const res = await window.crawlerApi.startJob(settings);

        if (!res?.ok) {
            alert(res?.message || "시작 실패");
            await refreshState();
            return;
        }

        if (res?.resumeMessage) {
            alert(res.resumeMessage);
        }

        await refreshState();
    } catch (error) {
        alert(`시작 실패: ${String(error?.message || error)}`);
    }
});

els.stopBtn.addEventListener("click", async () => {
    if (!hasApi()) return;

    try {
        const res = await window.crawlerApi.stopJob();
        if (!res?.ok) {
            alert(res?.message || "중지 실패");
            return;
        }
        await refreshState();
    } catch (error) {
        alert(`중지 실패: ${String(error?.message || error)}`);
    }
});

els.editCurrentBtn.addEventListener("click", async () => {
    const state = await window.crawlerApi.getState();
    const currentNo = Number(state?.current?.onestop?.no);
    if (!Number.isFinite(currentNo) || currentNo <= 0) {
        alert("현재 상품번호가 없습니다.");
        return;
    }
    await startEditFlow(currentNo);
});

els.editByNoBtn.addEventListener("click", async () => {
    const raw = window.prompt("다시 선택할 상품번호를 입력하세요.", "");
    if (!raw) return;

    const onestopNo = Number(raw);
    if (!Number.isFinite(onestopNo) || onestopNo <= 0) {
        alert("올바른 상품번호를 입력해주세요.");
        return;
    }

    await startEditFlow(onestopNo);
});

els.smartYesBtn.addEventListener("click", async () => {
    await handleDecision(
        {
            action: "smartstore",
            selectedAliCandidates: getSelectedAliCandidates()
        },
        "스마트스토어 판정 실패"
    );
});

els.smartNoBtn.addEventListener("click", () => {
    const target = els.coupangImage;
    if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
});

els.coupangYesBtn.addEventListener("click", async () => {
    await handleDecision(
        {
            action: "coupang",
            selectedAliCandidates: getSelectedAliCandidates()
        },
        "쿠팡 판정 실패"
    );
});

els.passBtn.addEventListener("click", async () => {
    const { passReasonCode, passReasonText } = getSelectedPassReason();

    if (passReasonCode === "other" && !els.passReasonEtcInput.value.trim()) {
        alert("기타 사유를 입력해주세요.");
        return;
    }

    await handleDecision(
        {
            action: "pass",
            passReasonCode,
            passReasonText,
            selectedAliCandidates: getSelectedAliCandidates()
        },
        "패스 처리 실패"
    );
});

els.retryBtn.addEventListener("click", async () => {
    const keyword = els.keywordInput.value.trim();
    if (!keyword) {
        alert("재검색할 키워드를 입력해주세요.");
        return;
    }

    await handleDecision(
        {
            action: "retry",
            searchKeyword: keyword
        },
        "재검색 요청 실패"
    );
});

els.refreshUiBtn.addEventListener("click", () => {
    saveUiSettings();
    window.location.reload();
});

els.clearSavedBtn.addEventListener("click", () => {
    const ok = window.confirm("저장된 계정/쿠키/설정값을 모두 지울까요?");
    if (!ok) return;

    clearUiSettings();
    els.rangeInput.value = "1~20";
    els.headlessInput.checked = false;
    els.onestopUserIdInput.value = "";
    els.onestopPasswordInput.value = "";
    els.selloCookieInput.value = "";
    saveUiSettings();
    alert("저장값을 초기화했습니다.");
});

document.addEventListener("DOMContentLoaded", async () => {
    loadUiSettings();
    bindAutoSave();
    bindKeywordEditingState();
    renderSelectedLeftPanel();
    await refreshState();

    if (hasApi()) {
        window.crawlerApi.onStateChanged((state) => {
            renderState(state);
        });
    }
});
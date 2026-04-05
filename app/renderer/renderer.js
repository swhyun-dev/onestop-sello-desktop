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
    aliPageInfo: document.getElementById("aliPageInfo"),

    aliCandidatesContainer: document.getElementById("aliCandidatesContainer"),
    aliSelectionInfo: document.getElementById("aliSelectionInfo"),
    aliSelectedStrip: document.getElementById("aliSelectedStrip"),
    aliEmptyState: document.getElementById("aliEmptyState"),

    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    retryBtn: document.getElementById("retryBtn"),
    smartYesBtn: document.getElementById("smartYesBtn"),
    smartNoBtn: document.getElementById("smartNoBtn"),
    coupangYesBtn: document.getElementById("coupangYesBtn"),
    passBtn: document.getElementById("passBtn"),
    refreshUiBtn: document.getElementById("refreshUiBtn"),
    clearSavedBtn: document.getElementById("clearSavedBtn"),
    keywordInput: document.getElementById("keywordInput"),
    passReasonEtcInput: document.getElementById("passReasonEtcInput"),

    statusText: document.getElementById("statusText"),
    workflowText: document.getElementById("workflowText"),
    progressText: document.getElementById("progressText"),
    currentNoText: document.getElementById("currentNoText"),
    searchKeywordText: document.getElementById("searchKeywordText"),
    countText: document.getElementById("countText"),

    loadingCard: document.getElementById("loadingCard"),
    loadingText: document.getElementById("loadingText"),

    noticeCard: document.getElementById("noticeCard"),
    noticeText: document.getElementById("noticeText"),

    onestopImage: document.getElementById("onestopImage"),
    onestopTitle: document.getElementById("onestopTitle"),
    onestopPrice: document.getElementById("onestopPrice"),
    onestopUrl: document.getElementById("onestopUrl"),

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
    const status = String(state?.status || "");
    const current = state?.current || {};
    const logs = Array.isArray(state?.logs) ? state.logs : [];
    const lastLog = logs.length ? logs[logs.length - 1] : "";
    const stage = String(current?.workflowStage || "");

    const isWaitingDecision = status === "WAITING_DECISION";
    const isSearchingByLog =
        lastLog.includes("셀록 searchAll 시작") ||
        lastLog.includes("셀록 요청 시작") ||
        lastLog.includes("셀록 검색:") ||
        lastLog.includes("알리 이미지 검색:");

    if (isWaitingDecision && stage !== "SEARCHING") {
        els.loadingCard.style.display = "none";
        return;
    }

    if (stage === "SEARCHING" || isSearchingByLog) {
        els.loadingCard.style.display = "block";
        els.loadingText.textContent = current?.searchKeyword
            ? `셀록홈즈/알리 검색 결과를 불러오는 중입니다... (${current.searchKeyword})`
            : "셀록홈즈/알리 검색 결과를 불러오는 중입니다...";
        return;
    }

    els.loadingCard.style.display = "none";
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

function getSelectedAliCandidates() {
    return Array.from(aliState.selectedMap.values()).slice(0, 10);
}

function updateAliSelectionInfo(totalPages) {
    els.aliSelectionInfo.textContent = `선택 ${aliState.selectedMap.size} / 10`;
    els.aliPageInfo.textContent = `${aliState.currentPage} / ${Math.max(totalPages, 1)}`;
}

function renderSelectedStrip() {
    const selected = getSelectedAliCandidates();

    if (!selected.length) {
        els.aliSelectedStrip.style.display = "none";
        els.aliSelectedStrip.innerHTML = "";
        return;
    }

    els.aliSelectedStrip.style.display = "grid";
    els.aliSelectedStrip.innerHTML = selected
        .map((item, idx) => {
            const image = escapeHtml(item?.image || "");
            return `
                <div class="selected-image-card" title="선택 ${idx + 1}">
                    <img src="${image}" alt="" />
                    <div class="selected-image-order">${idx + 1}</div>
                </div>
            `;
        })
        .join("");
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
        renderSelectedStrip();
        els.aliPrevPageBtn.disabled = true;
        els.aliNextPageBtn.disabled = false;
        return;
    }

    els.aliEmptyState.style.display = "none";
    els.aliCandidatesContainer.style.display = "grid";

    pageItems.forEach((item, idx) => {
        const key = `${aliState.currentPage}:${idx}`;
        const selected = aliState.selectedMap.has(key);
        const order = Array.from(aliState.selectedMap.keys()).indexOf(key) + 1;

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

            if (aliState.selectedMap.has(key)) {
                aliState.selectedMap.delete(key);
            } else {
                if (aliState.selectedMap.size >= 10) {
                    alert("알리 이미지는 최대 10개까지 선택할 수 있습니다.");
                    return;
                }
                aliState.selectedMap.set(key, item);
            }

            renderAliCandidates(aliPages, workflowStage, itemNo);
        });

        els.aliCandidatesContainer.appendChild(card);
    });

    els.aliPrevPageBtn.disabled = aliState.currentPage <= 1;
    els.aliNextPageBtn.disabled = false;

    updateAliSelectionInfo(totalPages);
    renderSelectedStrip();
}

function renderState(state) {
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
        const res = await window.crawlerApi.getAliNextPage({ maxItemsPerPage: 300 });

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

els.aliClearSelectionBtn.addEventListener("click", async () => {
    const current = await getCurrentReviewState();
    aliState.selectedMap.clear();
    renderAliCandidates(current.aliCandidatePages || [], current.workflowStage || "SEARCHING", current.onestop?.no || null);
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
    await refreshState();

    if (hasApi()) {
        window.crawlerApi.onStateChanged((state) => {
            renderState(state);
        });
    }
});
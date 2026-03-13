// // app/renderer/renderer.js
const STORAGE_KEY = "onestop_sello_desktop_ui_settings_v1";

const els = {
    rangeInput: document.getElementById("rangeInput"),
    headlessInput: document.getElementById("headlessInput"),

    onestopUserIdInput: document.getElementById("onestopUserIdInput"),
    onestopPasswordInput: document.getElementById("onestopPasswordInput"),
    selloCookieInput: document.getElementById("selloCookieInput"),

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

function renderNotice(message) {
    if (message) {
        els.noticeCard.style.display = "block";
        els.noticeText.textContent = message;
    } else {
        els.noticeCard.style.display = "none";
        els.noticeText.textContent = "-";
    }
}

function renderLoading(state) {
    const status = String(state?.status || "");
    const current = state?.current || {};
    const logs = Array.isArray(state?.logs) ? state.logs : [];
    const lastLog = logs.length ? logs[logs.length - 1] : "";

    const isLoading =
        status === "RUNNING" &&
        !!current?.onestop?.no &&
        !current?.smartCandidate &&
        !current?.coupangCandidate &&
        !current?.noticeMessage;

    const isWaitingDecision = status === "WAITING_DECISION";
    const isSearchingByLog =
        lastLog.includes("셀록 searchAll 시작") ||
        lastLog.includes("셀록 요청 시작") ||
        lastLog.includes("셀록 검색:");

    if (isWaitingDecision) {
        els.loadingCard.style.display = "none";
        return;
    }

    if (isLoading || isSearchingByLog) {
        els.loadingCard.style.display = "block";
        els.loadingText.textContent = current?.searchKeyword
            ? `셀록홈즈 검색 결과를 불러오는 중입니다... (${current.searchKeyword})`
            : "셀록홈즈 검색 결과를 불러오는 중입니다...";
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

function renderState(state) {
    const current = state.current || {};
    const counts = state.counts || {};
    const decision = state.pendingDecision || {};

    els.statusText.textContent = state.status || "대기중";
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
    await handleDecision({ action: "smartstore" }, "스마트스토어 판정 실패");
});

els.smartNoBtn.addEventListener("click", async () => {
    await handleDecision({ action: "smart_no" }, "스마트스토어 제외 실패");
});

els.coupangYesBtn.addEventListener("click", async () => {
    await handleDecision({ action: "coupang" }, "쿠팡 판정 실패");
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
            passReasonText
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
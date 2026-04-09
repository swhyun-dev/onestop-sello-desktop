// app/main/preload.js
const { contextBridge, ipcRenderer } = require("electron");

function safeInvoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
}

const api = {
    // 크롤링 기본
    startJob: (payload) => safeInvoke("crawl:start", payload),
    stopJob: () => safeInvoke("crawl:stop"),
    getState: () => safeInvoke("state:get"),
    submitDecision: (payload) => safeInvoke("crawl:decision", payload),

    // 수정 모드
    startEditItem: (payload) => safeInvoke("crawl:edit-item", payload),

    // 알리 관련
    pickImageAndSearchAli: (payload) => safeInvoke("crawl:ali-search-with-file", payload),
    openAliPrepare: (payload) => safeInvoke("crawl:ali-open-prepare", payload),
    confirmAliReady: () => safeInvoke("crawl:ali-confirm-ready"),

    // 👉 알리 페이지 이동
    getAliNextPage: (payload) => safeInvoke("crawl:ali-next-page", payload),

    // ✅ 추가 (핵심)
    loadAliMore: (payload) => safeInvoke("crawl:ali-load-more", payload),

    // 상태 구독
    onStateChanged: (callback) => {
        const handler = (_event, data) => {
            try {
                callback(data);
            } catch (error) {
                console.error("[preload] onStateChanged callback error:", error);
            }
        };

        ipcRenderer.on("state:changed", handler);

        return () => {
            ipcRenderer.removeListener("state:changed", handler);
        };
    }
};

try {
    contextBridge.exposeInMainWorld("crawlerApi", api);
    console.log("[preload] crawlerApi exposed");
} catch (error) {
    console.error("[preload] expose failed:", error);
}
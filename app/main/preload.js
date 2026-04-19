// app/main/preload.js
const { contextBridge, ipcRenderer } = require("electron");

function safeInvoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
}

const api = {
    startJob: (payload) => safeInvoke("crawl:start", payload),
    stopJob: () => safeInvoke("crawl:stop"),
    getState: () => safeInvoke("state:get"),
    submitDecision: (payload) => safeInvoke("crawl:decision", payload),

    startEditItem: (payload) => safeInvoke("crawl:edit-item", payload),
    pickImageAndSearchAli: (payload) => safeInvoke("crawl:ali-search-with-file", payload),

    openAliPrepare: (payload) => safeInvoke("crawl:ali-open-prepare", payload),
    confirmAliReady: () => safeInvoke("crawl:ali-confirm-ready"),
    getAliNextPage: (payload) => safeInvoke("crawl:ali-next-page", payload),
    loadAliMore: (payload) => safeInvoke("crawl:ali-load-more", payload),
    selectAliChoiceImage: (payload) => safeInvoke("crawl:ali-select-choice-image", payload),

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
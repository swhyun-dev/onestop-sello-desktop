// app/main/ipc/crawl.ipc.js
const { ipcMain, dialog } = require("electron");

function registerCrawlIpc(jobManager) {
    ipcMain.handle("crawl:start", async (_event, payload) => {
        try {
            return await jobManager.start(payload);
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:stop", async () => {
        try {
            return await jobManager.stop();
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:decision", async (_event, payload) => {
        try {
            return await jobManager.submitDecision(payload);
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:edit-item", async (_event, payload) => {
        try {
            return await jobManager.startEditItem({
                onestopNo: Number(payload?.onestopNo),
                headless: !!payload?.headless,
                selloCookie: String(payload?.selloCookie || "")
            });
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:ali-search-with-file", async (_event, payload) => {
        try {
            const onestopNo = Number(payload?.onestopNo);
            const maxItemsPerPage = Number(payload?.maxItemsPerPage) || 36;

            if (!Number.isFinite(onestopNo) || onestopNo <= 0) {
                return {
                    ok: false,
                    message: "유효한 상품번호가 필요합니다."
                };
            }

            const selected = await dialog.showOpenDialog({
                title: "알리 재검색에 사용할 이미지를 선택하세요",
                properties: ["openFile"],
                filters: [
                    { name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "avif"] }
                ]
            });

            if (selected.canceled || !selected.filePaths?.length) {
                return {
                    ok: false,
                    message: "이미지 선택이 취소되었습니다."
                };
            }

            return await jobManager.searchAliWithManualFile({
                onestopNo,
                filePath: selected.filePaths[0],
                maxItemsPerPage
            });
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:ali-open-prepare", async (_event, payload) => {
        try {
            return await jobManager.openAliPrepare(!!payload?.headless);
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:ali-confirm-ready", async () => {
        try {
            return await jobManager.confirmAliReady();
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:ali-next-page", async (_event, payload) => {
        try {
            return await jobManager.loadNextAliPage(Number(payload?.maxItemsPerPage) || 36);
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:ali-load-more", async (_event, payload) => {
        try {
            return await jobManager.loadMoreAliInCurrentPage({
                maxItemsPerBatch: Number(payload?.maxItemsPerBatch) || 36
            });
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });

    ipcMain.handle("crawl:ali-select-choice-image", async (_event, payload) => {
        try {
            return await jobManager.selectAliChoiceImage({
                index: Number(payload?.index),
                onestopNo: Number(payload?.onestopNo),
                maxItemsPerPage: Number(payload?.maxItemsPerPage) || 36
            });
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    });
}

module.exports = { registerCrawlIpc };
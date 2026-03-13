// app/main/ipc/crawl.ipc.js
const { ipcMain } = require("electron");

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
}

module.exports = { registerCrawlIpc };
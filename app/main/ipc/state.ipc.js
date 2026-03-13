// app/main/ipc/state.ipc.js
const { ipcMain } = require("electron");

function registerStateIpc(stateStore) {
    ipcMain.handle("state:get", async () => {
        return stateStore.getState();
    });
}

module.exports = { registerStateIpc };
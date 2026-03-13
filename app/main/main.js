// app/main/main.js
const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const dotenv = require("dotenv");
const { JobManager } = require("../../src/core/job-manager");
const { createStateStore } = require("../../src/core/state-store");
const { registerCrawlIpc } = require("./ipc/crawl.ipc");
const { registerStateIpc } = require("./ipc/state.ipc");

dotenv.config();

let mainWindow = null;
let jobManager = null;
let stateStore = null;

function createWindow() {
    const dataDir = path.resolve(process.cwd(), "data");

    stateStore = createStateStore({ dataDir });

    mainWindow = new BrowserWindow({
        width: 1480,
        height: 980,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });

    jobManager = new JobManager({
        dataDir,
        stateStore,
        notify: (state) => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.webContents.send("state:changed", state);
        }
    });

    registerCrawlIpc(jobManager);
    registerStateIpc(stateStore);

    const rendererPath = path.join(__dirname, "../renderer/index.html");
    mainWindow.loadFile(rendererPath);

    mainWindow.webContents.on("did-finish-load", () => {
        console.log("[main] renderer loaded");
    });

    mainWindow.webContents.on("did-fail-load", (_event, code, desc, validatedURL) => {
        console.error("[main] did-fail-load:", {
            code,
            desc,
            validatedURL
        });
    });

    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        console.error("[main] render-process-gone:", details);
    });

    mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
        console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
    });

    mainWindow.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("web-contents-created", (_event, contents) => {
    contents.on("did-create-window", () => {
        console.log("[main] child window created");
    });
});

process.on("uncaughtException", (error) => {
    console.error("[main] uncaughtException:", error);
});

process.on("unhandledRejection", (reason) => {
    console.error("[main] unhandledRejection:", reason);
});
// app/main/main.js
const path = require("node:path");
const fs = require("node:fs");
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

function copySeedFileIfMissing(dataDir, filename) {
    try {
        const targetPath = path.join(dataDir, filename);

        if (fs.existsSync(targetPath)) {
            return;
        }

        const seedPath = app.isPackaged
            ? path.join(process.resourcesPath, "seed", filename)
            : path.resolve(process.cwd(), "data", filename);

        if (!fs.existsSync(seedPath)) {
            console.warn(`[main] seed file not found: ${seedPath}`);
            return;
        }

        fs.mkdirSync(dataDir, { recursive: true });
        fs.copyFileSync(seedPath, targetPath);
        console.log(`[main] seed copied: ${filename}`);
    } catch (error) {
        console.error(`[main] seed copy failed: ${filename}`, error);
    }
}

function ensureSeedFiles(dataDir) {
    copySeedFileIfMissing(dataDir, "onestop_products.json");
    copySeedFileIfMissing(dataDir, "onestop-storage.json");
}

function createWindow() {
    const dataDir = app.isPackaged
        ? path.join(app.getPath("userData"), "data")
        : path.resolve(process.cwd(), "data");

    ensureSeedFiles(dataDir);

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

    if (!app.isPackaged) {
        mainWindow.webContents.openDevTools({ mode: "detach" });
    }
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
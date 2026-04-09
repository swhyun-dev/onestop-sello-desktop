// src/storage/file-db.js
const fs = require("node:fs");
const path = require("node:path");

class FileDb {
    constructor({ dataDir }) {
        this.dataDir = dataDir;

        this.latestPaths = {
            smartstore: path.join(dataDir, "result_smartstore.json"),
            coupang: path.join(dataDir, "result_coupang.json"),
            pass: path.join(dataDir, "result_pass.json"),
            error: path.join(dataDir, "result_error.json")
        };

        this.runContext = null;

        Object.values(this.latestPaths).forEach((filePath) => {
            this.ensureFile(filePath);
        });
    }

    ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    ensureFile(filePath) {
        this.ensureDir(path.dirname(filePath));
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, "[]", "utf-8");
        }
    }

    readArray(filePath) {
        this.ensureFile(filePath);

        try {
            const raw = fs.readFileSync(filePath, "utf-8").trim();
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    writeArray(filePath, items) {
        this.ensureFile(filePath);
        fs.writeFileSync(filePath, JSON.stringify(items, null, 2), "utf-8");
    }

    makeRunPaths(runKey) {
        const runDir = path.join(this.dataDir, "runs", runKey);

        return {
            runDir,
            smartstore: path.join(runDir, "result_smartstore.json"),
            coupang: path.join(runDir, "result_coupang.json"),
            pass: path.join(runDir, "result_pass.json"),
            error: path.join(runDir, "result_error.json")
        };
    }

    beginRun({ runKey, resume = false }) {
        if (!runKey || !String(runKey).trim()) {
            throw new Error("runKey가 없습니다.");
        }

        const paths = this.makeRunPaths(String(runKey).trim());
        this.runContext = {
            runKey: String(runKey).trim(),
            paths
        };

        this.ensureDir(paths.runDir);

        if (resume) {
            this.ensureFile(paths.smartstore);
            this.ensureFile(paths.coupang);
            this.ensureFile(paths.pass);
            this.ensureFile(paths.error);

            this.writeArray(this.latestPaths.smartstore, this.readArray(paths.smartstore));
            this.writeArray(this.latestPaths.coupang, this.readArray(paths.coupang));
            this.writeArray(this.latestPaths.pass, this.readArray(paths.pass));
            this.writeArray(this.latestPaths.error, this.readArray(paths.error));
            return;
        }

        this.writeArray(paths.smartstore, []);
        this.writeArray(paths.coupang, []);
        this.writeArray(paths.pass, []);
        this.writeArray(paths.error, []);

        this.writeArray(this.latestPaths.smartstore, []);
        this.writeArray(this.latestPaths.coupang, []);
        this.writeArray(this.latestPaths.pass, []);
        this.writeArray(this.latestPaths.error, []);
    }

    getCurrentRunInfo() {
        return this.runContext
            ? {
                runKey: this.runContext.runKey,
                runDir: this.runContext.paths.runDir
            }
            : null;
    }

    getRunPaths(runKey) {
        return this.makeRunPaths(runKey);
    }

    removeByOnestopNo(filePath, onestopNo) {
        const targetNo = Number(onestopNo);
        const items = this.readArray(filePath);
        const filtered = items.filter((row) => Number(row?.onestop?.no) !== targetNo);
        this.writeArray(filePath, filtered);
    }

    upsertByOnestopNo(filePath, item) {
        const targetNo = Number(item?.onestop?.no);
        const items = this.readArray(filePath).filter((row) => Number(row?.onestop?.no) !== targetNo);
        items.push(item);
        this.writeArray(filePath, items);
    }

    appendDualUnique(latestPath, runPath, item) {
        this.upsertByOnestopNo(latestPath, item);
        if (runPath) {
            this.upsertByOnestopNo(runPath, item);
        }
    }

    appendSmartstore(item) {
        this.appendDualUnique(
            this.latestPaths.smartstore,
            this.runContext?.paths?.smartstore,
            item
        );
    }

    appendCoupang(item) {
        this.appendDualUnique(
            this.latestPaths.coupang,
            this.runContext?.paths?.coupang,
            item
        );
    }

    appendPassed(item) {
        this.appendDualUnique(
            this.latestPaths.pass,
            this.runContext?.paths?.pass,
            item
        );
    }

    appendError(item) {
        this.appendDualUnique(
            this.latestPaths.error,
            this.runContext?.paths?.error,
            item
        );
    }

    removeDecisionByOnestopNo(onestopNo) {
        const latest = this.latestPaths;

        this.removeByOnestopNo(latest.smartstore, onestopNo);
        this.removeByOnestopNo(latest.coupang, onestopNo);
        this.removeByOnestopNo(latest.pass, onestopNo);
        this.removeByOnestopNo(latest.error, onestopNo);

        if (this.runContext?.paths) {
            this.removeByOnestopNo(this.runContext.paths.smartstore, onestopNo);
            this.removeByOnestopNo(this.runContext.paths.coupang, onestopNo);
            this.removeByOnestopNo(this.runContext.paths.pass, onestopNo);
            this.removeByOnestopNo(this.runContext.paths.error, onestopNo);
        }
    }
}

module.exports = { FileDb };
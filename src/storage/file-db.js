// src/storage/file-db.js
const fs = require("node:fs");
const path = require("node:path");

class FileDb {
    constructor({ dataDir }) {
        this.dataDir = dataDir;
        this.smartstorePath = path.join(dataDir, "result_smartstore.json");
        this.coupangPath = path.join(dataDir, "result_coupang.json");
        this.passPath = path.join(dataDir, "result_pass.json");
        this.errorPath = path.join(dataDir, "result_error.json");

        this.ensureFile(this.smartstorePath);
        this.ensureFile(this.coupangPath);
        this.ensureFile(this.passPath);
        this.ensureFile(this.errorPath);
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

    append(filePath, item) {
        const items = this.readArray(filePath);
        items.push(item);
        this.writeArray(filePath, items);
    }

    appendSmartstore(item) {
        this.append(this.smartstorePath, item);
    }

    appendCoupang(item) {
        this.append(this.coupangPath, item);
    }

    appendPassed(item) {
        this.append(this.passPath, item);
    }

    appendError(item) {
        this.append(this.errorPath, item);
    }
}

module.exports = { FileDb };
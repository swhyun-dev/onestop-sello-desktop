// src/utils/resume-helper.js
const fs = require("fs");
const path = require("path");

function readJsonSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, "utf-8").trim();
        if (!raw) return [];
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

function collectProcessedNos(dataDir) {
    const files = [
        "smartstore.json",
        "coupang.json",
        "passed.json",
        "errors.json"
    ];

    const processed = new Set();

    for (const file of files) {
        const full = path.join(dataDir, file);
        const rows = readJsonSafe(full);

        rows.forEach(r => {
            const no = r?.onestop?.no;
            if (Number.isFinite(Number(no))) {
                processed.add(Number(no));
            }
        });
    }

    return processed;
}

module.exports = {
    collectProcessedNos
};
// src/utils/logger.js
const fs = require("node:fs");
const path = require("node:path");

function createLogger({ dataDir }) {
    const logPath = path.join(dataDir, "run.log");

    function log(message) {
        const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
        const line = `[${ts}] ${message}`;
        fs.appendFileSync(logPath, `${line}\n`, "utf-8");
    }

    return { log };
}

module.exports = { createLogger };
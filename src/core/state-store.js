// src/core/state-store.js
const fs = require("node:fs");
const path = require("node:path");

function createInitialState() {
    return {
        status: "IDLE",
        run: {
            headless: false,
            rangeText: ""
        },
        progress: {
            total: 0,
            processed: 0
        },
        counts: {
            smartstore: 0,
            coupang: 0,
            passed: 0,
            errors: 0
        },
        current: {
            onestop: null,
            searchKeyword: "",
            smartCandidate: null,
            coupangCandidate: null
        },
        pendingDecision: null,
        logs: []
    };
}

function createStateStore({ dataDir }) {
    const statePath = path.join(dataDir, "progress.json");
    let state = createInitialState();

    function persist() {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
    }

    function getState() {
        return JSON.parse(JSON.stringify(state));
    }

    function resetForRun({ total, headless, rangeText }) {
        state = createInitialState();
        state.status = "RUNNING";
        state.progress.total = total;
        state.run.headless = headless;
        state.run.rangeText = rangeText;
        persist();
    }

    function setStatus(status) {
        state.status = status;
        persist();
    }

    function setCurrent(partial) {
        state.current = {
            ...state.current,
            ...partial
        };
        persist();
    }

    function clearCandidates() {
        state.current.smartCandidate = null;
        state.current.coupangCandidate = null;
        persist();
    }

    function setPendingDecision(payload) {
        state.pendingDecision = payload;
        persist();
    }

    function clearPendingDecision() {
        state.pendingDecision = null;
        persist();
    }

    function incrementProcessed(value) {
        state.progress.processed += value;
        persist();
    }

    function incrementCount(key) {
        state.counts[key] = (state.counts[key] || 0) + 1;
        persist();
    }

    function appendLog(message) {
        state.logs.push(message);
        if (state.logs.length > 500) state.logs = state.logs.slice(-500);
        persist();
    }

    return {
        getState,
        resetForRun,
        setStatus,
        setCurrent,
        clearCandidates,
        setPendingDecision,
        clearPendingDecision,
        incrementProcessed,
        incrementCount,
        appendLog
    };
}

module.exports = { createStateStore };
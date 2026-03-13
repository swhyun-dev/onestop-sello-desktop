// src/core/range-parser.js
function parseRangeText(rangeText) {
    const input = String(rangeText || "").trim();
    if (!input) throw new Error("범위를 입력해주세요.");

    const set = new Set();
    const parts = input.split(",").map((x) => x.trim()).filter(Boolean);

    for (const part of parts) {
        if (part.includes("~")) {
            const [startRaw, endRaw] = part.split("~").map((x) => x.trim());
            const start = Number(startRaw);
            const end = Number(endRaw);

            if (!Number.isInteger(start) || !Number.isInteger(end)) {
                throw new Error(`잘못된 범위입니다: ${part}`);
            }
            if (start > end) {
                throw new Error(`시작이 끝보다 큽니다: ${part}`);
            }

            for (let i = start; i <= end; i += 1) {
                set.add(i);
            }
        } else {
            const value = Number(part);
            if (!Number.isInteger(value)) {
                throw new Error(`잘못된 번호입니다: ${part}`);
            }
            set.add(value);
        }
    }

    return [...set].sort((a, b) => a - b);
}

module.exports = { parseRangeText };
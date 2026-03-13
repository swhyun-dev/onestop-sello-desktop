// src/parser/keyword-rule.js
const STRIP_FIRST_WORDS = new Set([
    "핸셀",
    "원스톱",
    "브랜드",
    "돌다리",
    "디앤에프"
]);

function buildSearchKeyword(onestopItem) {
    const title = String(onestopItem?.title || "").trim();
    if (!title) return "";

    const words = title.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && STRIP_FIRST_WORDS.has(words[0])) {
        return words.slice(1).join(" ").trim();
    }

    return title;
}

module.exports = { buildSearchKeyword };
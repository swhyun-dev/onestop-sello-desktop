// src/parser/sello-parser.js
function pickSmartKeywords(searchJson, limit = 15) {
    const arr = searchJson?.keywordData?.relKwdInfoArray || [];
    return arr
        .filter((x) => x && typeof x.keyword === "string" && x.keyword.trim())
        .slice(0, limit)
        .map((x) => x.keyword.trim());
}

function pickCoupangKeywords(popJson, limit = 15) {
    const arr = popJson?.data || [];
    return arr
        .filter((x) => x && typeof x.keyword === "string" && x.keyword.trim())
        .slice(0, limit)
        .map((x) => x.keyword.trim());
}

function parsePopularCoup(json) {
    if (!json?.success || !json?.data) return null;

    let keywords = [];
    try {
        keywords = JSON.parse(json.data.keyword || "[]");
    } catch {
        keywords = [];
    }

    return {
        categoryDepth: Number(json.data.deps || 0),
        categories: [
            json.data.deps1,
            json.data.deps2,
            json.data.deps3,
            json.data.deps4,
            json.data.deps5,
            json.data.deps6
        ].filter(Boolean),
        keywords
    };
}

module.exports = {
    pickSmartKeywords,
    pickCoupangKeywords,
    parsePopularCoup
};
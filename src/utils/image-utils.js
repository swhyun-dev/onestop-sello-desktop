// src/utils/image-utils.js

function normalizeAliImageToJpg(url) {
    if (!url) return "";

    let u = String(url).trim();

    // 1. avif 제거
    if (u.endsWith("_.avif")) {
        u = u.replace("_.avif", "");
    }

    // 2. webp 제거
    if (u.endsWith(".webp")) {
        u = u.replace(".webp", ".jpg");
    }

    // 3. 쿼리 제거
    const qIndex = u.indexOf("?");
    if (qIndex !== -1) {
        u = u.slice(0, qIndex);
    }

    return u;
}

module.exports = {
    normalizeAliImageToJpg
};
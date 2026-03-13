// src/utils/url.js
function safeUrl(input) {
    try {
        return new URL(input);
    } catch {
        return null;
    }
}

module.exports = { safeUrl };
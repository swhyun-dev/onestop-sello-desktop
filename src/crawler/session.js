// src/crawler/session.js
function getOnestopStoragePath() {
    return process.env.ONESTOP_STORAGE_PATH || "";
}

function getSelloCookie() {
    return process.env.SELLO_COOKIE || "";
}

module.exports = {
    getOnestopStoragePath,
    getSelloCookie
};
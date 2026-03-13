// src/parser/onestop-parser.js
function parseWon(text) {
    const n = Number(String(text || "").replace(/[^\d]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

async function detectMissingProduct(page) {
    const title = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const currentUrl = page.url();

    if (!currentUrl.includes("/goods/view?no=")) return true;
    if (String(title).includes("404")) return true;
    if (String(bodyText).includes("존재하지 않는")) return true;
    if (String(bodyText).includes("없는 상품")) return true;

    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content").catch(() => "");
    if (!ogTitle) return true;

    return false;
}

async function getMeta(page, selector) {
    return (await page.locator(selector).getAttribute("content").catch(() => "")) || "";
}

async function parseOptionsFromDom(page) {
    const optionSelect = page.locator('select[name="viewOptions[]"]');
    const count = await optionSelect.count().catch(() => 0);
    if (!count) return [];

    return optionSelect.evaluateAll((sels) => {
        const out = [];
        for (const sel of sels) {
            const options = Array.from(sel.querySelectorAll("option"));
            for (const o of options) {
                const value = o.getAttribute("value") || "";
                if (!value.trim()) continue;

                out.push({
                    value,
                    text: (o.textContent || "").trim(),
                    addPrice: Number(o.getAttribute("price") || 0),
                    stock: Number(o.getAttribute("stock") || 0)
                });
            }
        }
        return out;
    });
}

async function parseDetailImages(page) {
    return page.evaluate(() => {
        const set = new Set();
        const scope = document.querySelector("#contents") || document.body;
        const imgs = Array.from(scope.querySelectorAll("img"));

        for (const img of imgs) {
            const src = img.getAttribute("data-original") || img.getAttribute("src") || "";
            if (src && src.startsWith("http")) set.add(src);
        }

        return Array.from(set);
    }).catch(() => []);
}

async function parseOnestopProductPage(page, no, url) {
    const ogTitle = await getMeta(page, 'meta[property="og:title"]');
    const ogImage = await getMeta(page, 'meta[property="og:image"]');
    const titleText = ogTitle || (await page.locator("h3").first().innerText().catch(() => "")) || "";

    const priceText =
        (await page.locator("xpath=/html/body/div[1]/div[2]/div[2]/div[3]/div[1]/div[2]/form/ul[1]/li[1]/p[2]/span[1]").innerText().catch(() => "")) ||
        "";

    const detailImages = await parseDetailImages(page);
    const options = await parseOptionsFromDom(page);

    return {
        exists: true,
        no,
        url,
        title: titleText.trim(),
        priceText: priceText.trim(),
        price: parseWon(priceText),
        thumbnailUrl: ogImage,
        images: detailImages,
        options
    };
}

module.exports = {
    detectMissingProduct,
    parseOnestopProductPage
};
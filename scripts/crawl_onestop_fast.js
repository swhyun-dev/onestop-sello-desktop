// scripts/crawl_onestop_fast.js
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { OnestopClient } = require("../src/crawler/onestop-client");

const DATA_DIR = path.resolve(__dirname, "../data");
const OUTPUT_PATH = path.join(DATA_DIR, "onestop_products.json");
const STORAGE_PATH = path.join(DATA_DIR, "onestop-storage.json");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadExistingItems() {
    if (!fs.existsSync(OUTPUT_PATH)) return [];
    try {
        const raw = fs.readFileSync(OUTPUT_PATH, "utf-8").trim();
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveItems(items) {
    ensureDir(DATA_DIR);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2), "utf-8");
}

function upsertByNo(list, item) {
    const targetNo = Number(item?.no);
    const filtered = list.filter((row) => Number(row?.no) !== targetNo);
    filtered.push(item);
    filtered.sort((a, b) => Number(a.no) - Number(b.no));
    return filtered;
}

async function crawlCatalogPage(page, pageNo) {
    const url = `https://onestopdome.com/goods/catalog?code=0014&page=${pageNo}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);

    const items = await page.evaluate(() => {
        const out = [];
        const links = Array.from(document.querySelectorAll('a[href*="/goods/view?no="]'));

        const seen = new Set();

        for (const a of links) {
            const href = a.getAttribute("href") || "";
            const match = href.match(/no=(\d+)/);
            if (!match) continue;

            const no = Number(match[1]);
            if (!Number.isFinite(no) || seen.has(no)) continue;
            seen.add(no);

            const card =
                a.closest("li") ||
                a.closest(".goods_list") ||
                a.closest(".goods_display_item") ||
                a.parentElement;

            const titleEl =
                card?.querySelector(".goods_name") ||
                card?.querySelector(".name") ||
                a.querySelector("img");

            const imgEl = card?.querySelector("img");
            const priceCandidates = Array.from(card?.querySelectorAll("*") || []).map((el) =>
                String(el.textContent || "").trim()
            );
            const priceText = priceCandidates.find((v) => /[0-9][0-9,]*\s*원/.test(v)) || "";

            const categoryText =
                Array.from(document.querySelectorAll(".respCategoryList .on em"))
                    .map((el) => el.textContent.trim())
                    .join(" > ") || "";

            out.push({
                no,
                title:
                    titleEl?.getAttribute?.("alt") ||
                    titleEl?.textContent?.trim() ||
                    "",
                priceText,
                price: Number((priceText.match(/[0-9,]+/) || ["0"])[0].replace(/,/g, "")),
                thumbnail: imgEl?.src || "",
                url: href,
                category: categoryText
            });
        }

        return out;
    });

    return items;
}

async function main() {
    ensureDir(DATA_DIR);

    const headless = !process.argv.includes("--show");
    const detailOnly = process.argv.includes("--detail-only");
    const loginOnly = process.argv.includes("--login-only");

    const userId = process.env.ONESTOP_USER_ID || "";
    const password = process.env.ONESTOP_PASSWORD || "";

    if (loginOnly) {
        const client = new OnestopClient({
            dataDir: DATA_DIR,
            headless: false,
            storageStatePath: STORAGE_PATH,
            logger: console.log
        });

        try {
            if (userId && password) {
                await client.loginWithCredentials({ userId, password });
            } else {
                await client.openManualLoginPage();
                console.log("브라우저에서 원스톱 로그인 후 Enter 를 누르세요.");
                process.stdin.resume();
                await new Promise((resolve) => process.stdin.once("data", resolve));
                await client.confirmManualLogin();
            }
        } finally {
            await client.close();
        }
        return;
    }

    let items = loadExistingItems();

    if (!detailOnly) {
        const browser = await chromium.launch({ headless });
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);

        try {
            let pageNo = 1;
            while (true) {
                console.log(`ℹ️ 원스톱 카탈로그 크롤링: page=${pageNo}`);
                const pageItems = await crawlCatalogPage(page, pageNo);

                if (!pageItems.length) break;

                for (const item of pageItems) {
                    items = upsertByNo(items, item);
                }

                saveItems(items);
                console.log(`✅ 카탈로그 누적 저장: ${items.length}건`);

                if (pageItems.length < 10) break;
                pageNo += 1;
                if (pageNo > 300) break;
            }
        } finally {
            await browser.close();
        }
    }

    const client = new OnestopClient({
        dataDir: DATA_DIR,
        headless,
        storageStatePath: STORAGE_PATH,
        logger: console.log
    });

    try {
        if (userId && password && !fs.existsSync(STORAGE_PATH)) {
            await client.loginWithCredentials({ userId, password });
        }

        for (const item of items) {
            const no = Number(item.no);
            if (!Number.isFinite(no)) continue;

            console.log(`ℹ️ 상세 옵션 수집: no=${no}`);

            try {
                const detail = await client.crawlGoodsDetail(item.url);

                const merged = {
                    ...item,
                    goodsPrice: detail.goodsPrice,
                    options: detail.options,
                    optionSummary: detail.optionSummary,
                    optionAddPriceSummary: detail.optionAddPriceSummary,
                    detailHtml: detail.detailHtml,
                    hasOptions: detail.hasOptions,
                    loginRequired: detail.loginRequired,
                    optionUpdatedAt: new Date().toISOString()
                };

                items = upsertByNo(items, merged);
                saveItems(items);

                console.log(
                    `✅ 상세 저장: no=${no} / options=${detail.options.length} / loginRequired=${detail.loginRequired}`
                );
            } catch (error) {
                console.log(`❌ 상세 실패: no=${no} / ${String(error?.message || error)}`);
            }
        }
    } finally {
        await client.close();
    }

    console.log(`✅ 완료: ${OUTPUT_PATH}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
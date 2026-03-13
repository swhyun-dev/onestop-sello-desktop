// scripts/crawl_onestop_catalog.js
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const BASE = "https://onestopdome.com";
const ONESTOP_COOKIE = String(process.env.ONESTOP_COOKIE || "").trim();

const CATEGORIES = [
    { name: "vvip", code: "0012", category: "c0012" },
    { name: "normal", code: "0014", category: "c0014" }
];

const PER_PAGE = 200;
const OUT_DIR = path.resolve("data");
const DEBUG_DIR = path.join(OUT_DIR, "_debug_onestop_catalog");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function fetchPage(category, code, page) {
    const url =
        `${BASE}/goods/catalog?page=${page}` +
        `&searchMode=catalog` +
        `&category=${category}` +
        `&per=${PER_PAGE}` +
        `&sorting=sale` +
        `&filter_display=lattice` +
        `&code=${code}`;

    console.log("fetch:", url);

    const res = await axios.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            ...(ONESTOP_COOKIE ? { Cookie: ONESTOP_COOKIE } : {})
        },
        timeout: 20000
    });

    return {
        url,
        html: res.data
    };
}

function saveDebugHtml(name, html) {
    ensureDir(DEBUG_DIR);
    const file = path.join(DEBUG_DIR, name);
    fs.writeFileSync(file, html, "utf-8");
    return file;
}

function textOf($root) {
    return $root.text().replace(/\s+/g, " ").trim();
}

function pickNoFromHref(href) {
    const m1 = String(href || "").match(/[?&]no=(\d+)/i);
    if (m1) return Number(m1[1]);

    const m2 = String(href || "").match(/[?&]goodsNo=(\d+)/i);
    if (m2) return Number(m2[1]);

    return null;
}

function parseProducts(html) {
    const $ = cheerio.load(html);

    const debugInfo = {
        goodsListItem: $(".goods_list_item").length,
        goodsName: $(".goods_name").length,
        anchorsWithView: $('a[href*="/goods/view"]').length,
        anchorsWithNo: $('a[href*="no="]').length,
        anchorsWithGoodsNo: $('a[href*="goodsNo="]').length
    };

    console.log("debug selectors:", debugInfo);

    const items = [];
    const seen = new Set();

    // 1차: 예전 selector
    $(".goods_list_item").each((_, el) => {
        const $el = $(el);

        const href =
            $el.find('a[href*="/goods/view"]').attr("href") ||
            $el.find("a").attr("href") ||
            "";

        const no = pickNoFromHref(href);
        const title =
            textOf($el.find(".goods_name")) ||
            textOf($el.find(".name")) ||
            textOf($el.find("strong")) ||
            textOf($el.find("a"));

        const img =
            $el.find("img").attr("data-original") ||
            $el.find("img").attr("src") ||
            "";

        const priceText =
            textOf($el.find(".goods_price")) ||
            textOf($el.find(".price")) ||
            textOf($el.find("[class*=price]"));

        const price = Number(String(priceText).replace(/[^\d]/g, "")) || null;

        const absUrl = href
            ? (href.startsWith("http") ? href : BASE + href)
            : "";

        const thumb = img
            ? (img.startsWith("http") ? img : BASE + img)
            : "";

        if (!absUrl || !title) return;

        const key = `${no || ""}|${absUrl}`;
        if (seen.has(key)) return;
        seen.add(key);

        items.push({
            no,
            title,
            price,
            thumbnail: thumb,
            url: absUrl
        });
    });

    // 2차 fallback: 상세 링크 전체 스캔
    if (items.length === 0) {
        $('a[href*="/goods/view"]').each((_, a) => {
            const href = $(a).attr("href") || "";
            const absUrl = href.startsWith("http") ? href : BASE + href;
            const no = pickNoFromHref(href);

            const $box =
                $(a).closest(".goods_list_item").length
                    ? $(a).closest(".goods_list_item")
                    : $(a).parent();

            const title =
                textOf($box.find(".goods_name")) ||
                textOf($box.find(".name")) ||
                textOf($(a));

            const img =
                $box.find("img").attr("data-original") ||
                $box.find("img").attr("src") ||
                "";

            const priceText =
                textOf($box.find(".goods_price")) ||
                textOf($box.find(".price")) ||
                textOf($box.find("[class*=price]"));

            const price = Number(String(priceText).replace(/[^\d]/g, "")) || null;
            const thumb = img
                ? (img.startsWith("http") ? img : BASE + img)
                : "";

            if (!absUrl || !title) return;

            const key = `${no || ""}|${absUrl}`;
            if (seen.has(key)) return;
            seen.add(key);

            items.push({
                no,
                title,
                price,
                thumbnail: thumb,
                url: absUrl
            });
        });
    }

    return items;
}

function detectLoginOrEmpty(html) {
    const s = String(html || "");
    return {
        hasLoginForm:
            s.includes('name="userid"') ||
            s.includes('name="user_id"') ||
            s.includes('type="password"'),
        hasGoodsViewLink:
            s.includes("/goods/view?") || s.includes("/goods/view&"),
        hasCatalogWord:
            s.includes("상품") || s.includes("카테고리") || s.includes("catalog")
    };
}

async function crawlCategory(cat) {
    console.log(`\n=== ${cat.name} 시작 ===`);

    let page = 1;
    const result = [];

    while (true) {
        const { url, html } = await fetchPage(cat.category, cat.code, page);

        const debugFile = saveDebugHtml(`${cat.name}_page_${page}.html`, html);
        const signals = detectLoginOrEmpty(html);

        console.log("signals:", signals);
        console.log("debug html:", debugFile);

        const items = parseProducts(html);

        if (page === 1 && items.length === 0) {
            console.log("⚠️ 첫 페이지에서 0건입니다.");
            console.log("⚠️ 가능 원인: 로그인 쿠키 없음 / selector 불일치");
            break;
        }

        if (items.length === 0) {
            break;
        }

        console.log(`page ${page} → ${items.length}개`);
        result.push(...items);

        if (items.length < PER_PAGE) {
            break;
        }

        page += 1;
    }

    console.log(`${cat.name} 총 ${result.length}개`);
    return result;
}

async function main() {
    ensureDir(OUT_DIR);

    if (!ONESTOP_COOKIE) {
        console.log("⚠️ .env의 ONESTOP_COOKIE가 비어 있습니다.");
        console.log("⚠️ 로그인 필요한 카탈로그면 0건이 나올 수 있습니다.");
    }

    const all = [];

    for (const cat of CATEGORIES) {
        const items = await crawlCategory(cat);
        for (const item of items) {
            item.category = cat.name;
        }
        all.push(...items);
    }

    const file = path.join(OUT_DIR, "onestop_products.json");
    fs.writeFileSync(file, JSON.stringify(all, null, 2), "utf-8");

    console.log(`\n저장 완료 → ${file}`);
}

main().catch((error) => {
    console.error("❌ 실패:", error?.message || error);
    process.exit(1);
});
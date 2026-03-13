// scripts/crawl_onestop_fast.js
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const BASE = "https://onestopdome.com";
const ONESTOP_COOKIE = String(process.env.ONESTOP_COOKIE || "").trim();

const OUT_DIR = path.resolve("data");
const DEBUG_DIR = path.join(OUT_DIR, "_debug_onestop_fast");

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function fetchPage(page, category, code) {
    const url =
        `${BASE}/goods/search_list?page=${page}` +
        `&searchMode=catalog` +
        `&category=${category}` +
        `&per=200` +
        `&sorting=sale` +
        `&filter_display=lattice` +
        `&code=${code}` +
        `&auto=1`;

    console.log("fetch:", url);

    const res = await axios.get(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `${BASE}/goods/catalog?page=${page}&searchMode=catalog&category=${category}&per=200&sorting=sale&filter_display=lattice&code=${code}`,
            ...(ONESTOP_COOKIE ? { Cookie: ONESTOP_COOKIE } : {})
        },
        timeout: 20000,
        responseType: "text"
    });

    return {
        url,
        data: String(res.data || "")
    };
}

function saveDebug(name, content) {
    ensureDir(DEBUG_DIR);
    const file = path.join(DEBUG_DIR, name);
    fs.writeFileSync(file, content, "utf-8");
    return file;
}

function textOf($el) {
    return $el.text().replace(/\s+/g, " ").trim();
}

function absUrl(u) {
    if (!u) return "";
    if (u.startsWith("http")) return u;
    return BASE + u;
}

function pickNoFromHref(href) {
    const s = String(href || "");
    const m1 = s.match(/[?&]no=(\d+)/i);
    if (m1) return Number(m1[1]);

    const m2 = s.match(/[?&]goodsNo=(\d+)/i);
    if (m2) return Number(m2[1]);

    return null;
}

function cleanTitle(title) {
    return String(title || "").replace(/\s+/g, " ").trim();
}

function normalizePrice(priceText) {
    const digits = String(priceText || "").replace(/[^\d]/g, "");
    if (!digits) return null;
    const num = Number(digits);
    return Number.isFinite(num) ? num : null;
}

function recordScore(item) {
    let score = 0;
    if (item.no) score += 5;
    if (item.title) score += Math.min(item.title.length, 30);
    if (item.thumbnail) score += 20;
    if (item.price !== null && item.price !== undefined) score += 15;
    return score;
}

function mergePreferBetter(existing, incoming) {
    if (!existing) return incoming;
    if (!incoming) return existing;

    const a = recordScore(existing);
    const b = recordScore(incoming);

    if (b > a) {
        return {
            ...existing,
            ...incoming,
            no: incoming.no ?? existing.no,
            title: incoming.title || existing.title,
            price: incoming.price ?? existing.price,
            thumbnail: incoming.thumbnail || existing.thumbnail,
            url: incoming.url || existing.url
        };
    }

    return {
        ...incoming,
        ...existing,
        no: existing.no ?? incoming.no,
        title: existing.title || incoming.title,
        price: existing.price ?? incoming.price,
        thumbnail: existing.thumbnail || incoming.thumbnail,
        url: existing.url || incoming.url
    };
}

function dedupeItems(items) {
    const byKey = new Map();

    for (const item of items) {
        const key = item.no ? `no:${item.no}` : `url:${item.url}`;
        const prev = byKey.get(key);
        byKey.set(key, mergePreferBetter(prev, item));
    }

    return Array.from(byKey.values());
}

function detectResponseShape(raw) {
    const s = String(raw || "").trim();

    if (!s) return { type: "empty" };
    if (s.startsWith("{") || s.startsWith("[")) return { type: "json_like" };
    if (s.includes("<html") || s.includes("<body")) return { type: "full_html" };
    if (s.includes("/goods/view") || s.includes("goods_list") || s.includes("goods_name")) {
        return { type: "fragment_html" };
    }
    return { type: "unknown_text" };
}

function parseMaybeJson(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function parseFromHtml(html) {
    const $ = cheerio.load(html);
    const items = [];

    const candidateSelectors = [
        ".goods_list_item",
        ".goods_list li",
        ".goods_list > div",
        "[class*=goods_list_item]",
        "[class*=goodsDisplayItemWrap]",
        ".list_item",
        "li"
    ];

    let usedSelector = "";

    for (const sel of candidateSelectors) {
        const nodes = $(sel);
        if (!nodes.length) continue;

        const temp = [];

        nodes.each((_, el) => {
            const $el = $(el);

            const href =
                $el.find('a[href*="/goods/view"]').attr("href") ||
                $el.find('a[href*="no="]').attr("href") ||
                $el.find("a").attr("href") ||
                "";

            if (!href) return;

            const no = pickNoFromHref(href);

            const title = cleanTitle(
                textOf($el.find(".goods_name")) ||
                textOf($el.find(".name")) ||
                textOf($el.find("[class*=goods_name]")) ||
                textOf($el.find("[class*=name]")) ||
                textOf($el.find("strong")) ||
                textOf($el.find("a"))
            );

            const img =
                $el.find("img").attr("data-original") ||
                $el.find("img").attr("src") ||
                "";

            // 가격 selector를 조금 더 보수적으로
            const priceText =
                textOf($el.find(".goods_price")) ||
                textOf($el.find("[class*=goods_price]")) ||
                textOf($el.find(".price")) ||
                "";

            if (!title) return;

            temp.push({
                no,
                title,
                price: normalizePrice(priceText),
                thumbnail: absUrl(img),
                url: absUrl(href)
            });
        });

        if (temp.length) {
            usedSelector = sel;
            items.push(...temp);
            break;
        }
    }

    // fallback: 링크 기반 스캔
    if (!items.length) {
        $('a[href*="/goods/view"], a[href*="no="]').each((_, a) => {
            const href = $(a).attr("href") || "";
            if (!href) return;

            const $box = $(a).closest("li").length ? $(a).closest("li") : $(a).parent();
            const no = pickNoFromHref(href);

            const title = cleanTitle(
                textOf($box.find(".goods_name")) ||
                textOf($box.find(".name")) ||
                textOf($(a))
            );

            const img =
                $box.find("img").attr("data-original") ||
                $box.find("img").attr("src") ||
                "";

            const priceText =
                textOf($box.find(".goods_price")) ||
                textOf($box.find("[class*=goods_price]")) ||
                textOf($box.find(".price")) ||
                "";

            if (!title) return;

            items.push({
                no,
                title,
                price: normalizePrice(priceText),
                thumbnail: absUrl(img),
                url: absUrl(href)
            });
        });

        if (items.length) {
            usedSelector = "fallback:a[href]";
        }
    }

    const deduped = dedupeItems(items);

    return {
        items: deduped,
        usedSelector,
        debug: {
            goodsViewLinks: $('a[href*="/goods/view"]').length,
            noLinks: $('a[href*="no="]').length,
            goodsName: $(".goods_name").length,
            goodsPrice: $(".goods_price").length,
            rawItems: items.length,
            dedupedItems: deduped.length
        }
    };
}

function extractItems(raw) {
    const shape = detectResponseShape(raw);

    if (shape.type === "json_like") {
        const parsed = parseMaybeJson(raw);
        if (parsed && typeof parsed === "object") {
            const htmlCandidate =
                parsed.html ||
                parsed.data?.html ||
                parsed.content ||
                parsed.list ||
                parsed.result;

            if (typeof htmlCandidate === "string") {
                const parsedHtml = parseFromHtml(htmlCandidate);
                return {
                    items: parsedHtml.items,
                    shape,
                    usedSelector: parsedHtml.usedSelector,
                    debug: parsedHtml.debug,
                    source: "json.html"
                };
            }
        }
    }

    const parsedHtml = parseFromHtml(raw);
    return {
        items: parsedHtml.items,
        shape,
        usedSelector: parsedHtml.usedSelector,
        debug: parsedHtml.debug,
        source: "html"
    };
}

async function crawlCategory(cat) {
    console.log(`\n=== ${cat.name} 시작 ===`);

    let page = 1;
    const result = [];

    while (true) {
        const { data } = await fetchPage(page, cat.category, cat.code);
        const debugFile = saveDebug(`${cat.name}_page_${page}.txt`, data);

        console.log(`response length: ${data.length}`);
        console.log(`debug file: ${debugFile}`);

        const parsed = extractItems(data);

        console.log("shape:", parsed.shape);
        console.log("selector:", parsed.usedSelector || "-");
        console.log("debug:", parsed.debug);

        const items = parsed.items || [];

        if (!items.length) {
            if (page === 1) {
                console.log("⚠️ 첫 페이지에서 0건입니다.");
            }
            break;
        }

        console.log(`page ${page} → ${items.length}개`);

        for (const item of items) {
            item.category = cat.name;
        }

        result.push(...items);

        if (items.length < 200) {
            break;
        }

        page += 1;
    }

    console.log(`${cat.name} 총 ${result.length}개`);
    return result;
}

async function main() {
    ensureDir(OUT_DIR);

    const vvip = await crawlCategory({
        name: "vvip",
        category: "c0012",
        code: "0012"
    });

    const normal = await crawlCategory({
        name: "normal",
        category: "c0014",
        code: "0014"
    });

    const all = dedupeItems([...vvip, ...normal]);

    const outFile = path.join(OUT_DIR, "onestop_products.json");
    fs.writeFileSync(outFile, JSON.stringify(all, null, 2), "utf-8");

    console.log(`\n완료: ${all.length}`);
    console.log(`저장: ${outFile}`);
}

main().catch((error) => {
    console.error("❌ 실패:", error?.message || error);
    process.exit(1);
});
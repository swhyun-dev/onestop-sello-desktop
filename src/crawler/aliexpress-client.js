// src/crawler/aliexpress-client.js
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");
const cheerio = require("cheerio");

class AliExpressClient {
    constructor({ browser, dataDir, logger }) {
        this.browser = browser;
        this.dataDir = dataDir;
        this.logger = typeof logger === "function" ? logger : () => {};
        this.context = null;
        this.page = null;
        this.currentResultPage = 1;
        this.debugDir = path.join(dataDir, "_debug_aliexpress");
        this.tmpDir = path.join(dataDir, "_tmp_aliexpress");
        this.defaultHeaders = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
        };
        this._sharp = null;
        this.searchSeq = 0;
    }

    ensureDir(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    async init() {
        this.ensureDir(this.debugDir);
        this.ensureDir(this.tmpDir);

        if (!this.context) {
            this.context = await this.browser.newContext({
                locale: "ko-KR",
                userAgent: this.defaultHeaders["User-Agent"],
                viewport: { width: 1365, height: 900 }
            });
        }

        if (!this.page) {
            this.page = await this.context.newPage();
            this.page.setDefaultTimeout(30000);
        }
    }

    async close() {
        try {
            if (this.context) {
                await this.context.close();
            }
        } catch {}

        this.context = null;
        this.page = null;
        this.currentResultPage = 1;
    }

    log(message) {
        this.logger(message);
    }

    cleanText(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
    }

    normalizeAliUrl(url) {
        const s = String(url || "").trim();
        if (!s) return "";
        if (s.startsWith("http://") || s.startsWith("https://")) return s;
        if (s.startsWith("//")) return `https:${s}`;
        if (s.startsWith("/")) return `https://ko.aliexpress.com${s}`;
        return s;
    }

    normalizeAliImage(url) {
        const s = String(url || "").trim();
        if (!s) return "";
        if (s.startsWith("data:image/")) return "";
        if (s.startsWith("http://") || s.startsWith("https://")) return s;
        if (s.startsWith("//")) return `https:${s}`;
        if (s.startsWith("/")) return `https://ko.aliexpress.com${s}`;
        return s;
    }

    parsePrice(text) {
        const s = this.cleanText(text);
        const m =
            s.match(/(US \$\s?\d[\d.,]*)/i) ||
            s.match(/(₩\s?\d[\d,]*)/i) ||
            s.match(/(KRW\s?\d[\d,]*)/i) ||
            s.match(/(\d[\d,]*\s?원)/i);

        return m ? this.cleanText(m[1]) : "";
    }

    scoreCandidate(item) {
        let score = 0;
        if (item.url && item.url.includes("/item/")) score += 30;
        if (item.image) score += 20;
        if (item.title) score += Math.min(item.title.length, 40);
        if (item.priceText) score += 10;
        return score;
    }

    dedupeAndSort(items, maxItems = 300) {
        const map = new Map();

        for (const item of items || []) {
            const url = this.normalizeAliUrl(item.url);
            if (!url) continue;

            const normalized = {
                id: item.id || "",
                title: this.cleanText(item.title),
                priceText: this.cleanText(item.priceText),
                image: this.normalizeAliImage(item.image),
                url
            };

            const prev = map.get(url);
            if (!prev || this.scoreCandidate(normalized) > this.scoreCandidate(prev)) {
                map.set(url, normalized);
            }
        }

        return Array.from(map.values())
            .sort((a, b) => this.scoreCandidate(b) - this.scoreCandidate(a))
            .slice(0, maxItems)
            .map((item, idx) => ({
                ...item,
                id: `ali_${idx + 1}`
            }));
    }

    async dumpDebug(prefix, htmlText = "") {
        try {
            this.ensureDir(this.debugDir);

            if (this.page) {
                await this.page.screenshot({
                    path: path.join(this.debugDir, `${prefix}.png`),
                    fullPage: true
                }).catch(() => {});
            }

            if (htmlText) {
                fs.writeFileSync(
                    path.join(this.debugDir, `${prefix}.html`),
                    String(htmlText || ""),
                    "utf-8"
                );
            } else if (this.page) {
                const content = await this.page.content().catch(() => "");
                if (content) {
                    fs.writeFileSync(
                        path.join(this.debugDir, `${prefix}.html`),
                        content,
                        "utf-8"
                    );
                }
            }
        } catch {}
    }

    async ensureSharp() {
        if (this._sharp) return this._sharp;

        try {
            this._sharp = require("sharp");
            return this._sharp;
        } catch (error) {
            throw new Error(
                `sharp 모듈이 필요합니다. 'npm install sharp' 후 다시 실행해주세요. / ${String(error?.message || error)}`
            );
        }
    }

    shouldConvertToJpeg(imageUrl, contentType = "") {
        const url = String(imageUrl || "").toLowerCase();
        const type = String(contentType || "").toLowerCase();

        return url.includes(".avif") || type.includes("image/avif");
    }

    async downloadImage(imageUrl, filePath) {
        if (!imageUrl) {
            throw new Error("알리 검색용 이미지 URL이 없습니다.");
        }

        const response = await fetch(imageUrl, {
            headers: {
                "User-Agent": this.defaultHeaders["User-Agent"]
            }
        });

        if (!response.ok) {
            throw new Error(`이미지 다운로드 실패: HTTP ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        let buffer = Buffer.from(arrayBuffer);
        const contentType = response.headers.get("content-type") || "";

        if (this.shouldConvertToJpeg(imageUrl, contentType)) {
            const sharp = await this.ensureSharp();
            buffer = await sharp(buffer).jpeg({ quality: 92 }).toBuffer();
            this.log(`ℹ️ 알리 검색 이미지 변환 완료: AVIF → JPG / ${imageUrl}`);
        }

        fs.writeFileSync(filePath, buffer);
        return filePath;
    }

    async getCookieHeaderForAli() {
        if (!this.context) return "";
        const cookies = await this.context.cookies("https://ko.aliexpress.com/");
        if (!Array.isArray(cookies) || !cookies.length) {
            return "";
        }
        return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }

    async openPreparePage() {
        await this.init();

        const urls = [
            "https://ko.aliexpress.com/",
            "https://www.aliexpress.com/"
        ];

        let lastError = null;

        for (const url of urls) {
            try {
                this.log(`ℹ️ 알리 준비 페이지 열기: ${url}`);
                await this.page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: 30000
                });
                await this.page.waitForTimeout(1800);
                await this.dumpDebug("ali_prepare_opened");
                return {
                    ok: true,
                    url: this.page.url()
                };
            } catch (error) {
                lastError = error;
                this.log(`⚠️ 알리 준비 페이지 열기 실패: ${url} / ${String(error?.message || error)}`);
            }
        }

        await this.dumpDebug("ali_prepare_open_failed");
        throw new Error(`알리 준비 페이지를 열지 못했습니다: ${String(lastError?.message || lastError || "unknown")}`);
    }

    async closeBlockingPopups() {
        if (!this.page) return;

        const closeSelectors = [
            'button[aria-label="Close"]',
            'button[aria-label="close"]',
            '[class*="close"]',
            '[class*="Close"]',
            '[data-role="close"]',
            ".btn-close",
            ".close-btn",
            ".next-dialog-close",
            ".comet-modal-close",
            ".comet-dialog-close"
        ];

        for (let round = 0; round < 2; round += 1) {
            let closedSomething = false;

            for (const selector of closeSelectors) {
                try {
                    const loc = this.page.locator(selector);
                    const count = await loc.count().catch(() => 0);

                    for (let i = 0; i < Math.min(count, 5); i += 1) {
                        const item = loc.nth(i);
                        const visible = await item.isVisible().catch(() => false);
                        if (!visible) continue;

                        await item.click({ force: true, timeout: 1000 }).catch(() => {});
                        await this.page.waitForTimeout(180);
                        closedSomething = true;
                    }
                } catch {}
            }

            await this.page.keyboard.press("Escape").catch(() => {});
            await this.page.waitForTimeout(120);

            if (!closedSomething) break;
        }
    }

    async findFileInputQuick() {
        if (!this.page) return null;

        const selectors = [
            'input[type="file"]',
            'input[accept*="image"]',
            'input[accept*="jpg"]',
            'input[accept*="png"]'
        ];

        for (const selector of selectors) {
            try {
                const loc = this.page.locator(selector).first();
                const count = await loc.count().catch(() => 0);
                if (!count) continue;
                return loc;
            } catch {}
        }

        return null;
    }

    async findAliPicSearchButton() {
        if (!this.page) return null;

        const selectors = [
            'div[class*="search--picSearch"] div[class*="esm--picture-search-btn"]',
            'div[class*="picture-search-btn"]',
            'div[class*="picture-search-container"] img[alt*="이미지로 검색하기"]',
            'img[alt*="이미지로 검색하기"]',
            '[class*="picSearch"]',
            '[class*="picture-search"]',
            '[class*="image-search"]',
            '[class*="ImageSearch"]'
        ];

        for (const selector of selectors) {
            try {
                const loc = this.page.locator(selector).first();
                const count = await loc.count().catch(() => 0);
                if (!count) continue;

                const visible = await loc.isVisible().catch(() => false);
                if (!visible) continue;

                return loc;
            } catch {}
        }

        return null;
    }

    async tryOpenImageSearchUi() {
        if (!this.page) return false;

        await this.closeBlockingPopups();

        const picBtn = await this.findAliPicSearchButton();
        if (!picBtn) {
            await this.dumpDebug("ali_picsearch_button_not_found");
            return false;
        }

        try {
            await picBtn.scrollIntoViewIfNeeded().catch(() => {});
            await this.page.waitForTimeout(150);

            await picBtn.hover({ force: true }).catch(() => {});
            await this.page.waitForTimeout(400);

            let input = await this.findFileInputQuick();
            if (input) return true;

            await picBtn.click({ force: true, timeout: 1600 }).catch(() => {});
            await this.page.waitForTimeout(900);

            input = await this.findFileInputQuick();
            if (input) return true;

            const parent = picBtn.locator("..");
            await parent.click({ force: true, timeout: 1200 }).catch(() => {});
            await this.page.waitForTimeout(900);

            input = await this.findFileInputQuick();
            if (input) return true;

            return false;
        } catch (error) {
            this.log(`⚠️ 알리 이미지검색 버튼 클릭 실패: ${String(error?.message || error)}`);
            return false;
        }
    }

    async findFileInputFromPreparedPage() {
        if (!this.page) return null;

        await this.closeBlockingPopups();

        let input = await this.findFileInputQuick();
        if (input) return input;

        const opened = await this.tryOpenImageSearchUi();
        if (!opened) return null;

        input = await this.findFileInputQuick();
        if (input) return input;

        return null;
    }

    async confirmManualReady() {
        await this.init();

        if (!this.page) {
            throw new Error("알리 page가 초기화되지 않았습니다.");
        }

        this.log("ℹ️ 알리 준비완료 확인 시작");
        await this.page.bringToFront().catch(() => {});
        await this.page.waitForTimeout(500);

        const input = await this.findFileInputFromPreparedPage();
        if (!input) {
            await this.dumpDebug("ali_prepare_not_ready");
            throw new Error(
                "알리 준비완료 실패: 홈 화면의 이미지 검색 버튼은 찾았지만 업로드창을 열지 못했습니다. 알리 화면을 맨 위로 둔 상태에서 다시 눌러보세요."
            );
        }

        this.log("✅ 알리 준비완료 확인됨");
        return {
            ok: true,
            url: this.page.url()
        };
    }

    async waitForResultReady(previousUrl = "") {
        if (!this.page) return "";

        const start = Date.now();

        try {
            await this.page.waitForFunction(
                (prev) => {
                    const hasItems = !!document.querySelector('#card-list a[href*="/item/"], .search-card-item[href*="/item/"], a[href*="/item/"]');
                    return window.location.href !== prev || hasItems;
                },
                previousUrl,
                { timeout: 9000 }
            );
        } catch {}

        await this.page.waitForTimeout(1400);

        try {
            await this.page.waitForLoadState("domcontentloaded", { timeout: 2500 }).catch(() => {});
            await this.page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
        } catch {}

        const waitedMs = Date.now() - start;
        this.log(`ℹ️ 알리 결과 대기 완료: ${waitedMs}ms`);

        return this.page.url();
    }

    async uploadImageFromPreparedPage(imagePath) {
        const input = await this.findFileInputFromPreparedPage();
        if (!input) {
            await this.dumpDebug("ali_prepared_page_no_input");
            throw new Error("알리 준비된 페이지에서 업로드 input을 찾지 못했습니다.");
        }

        const beforeUrl = this.page.url();
        await input.setInputFiles(imagePath);
        this.log(`ℹ️ 알리 파일 업로드 완료(준비된 페이지): ${imagePath}`);

        const currentUrl = await this.waitForResultReady(beforeUrl);
        this.log(`ℹ️ 알리 현재 URL: ${currentUrl}`);
        return currentUrl;
    }

    async uploadImage(imagePath) {
        let lastError = null;

        try {
            return await this.uploadImageFromPreparedPage(imagePath);
        } catch (error) {
            lastError = error;
        }

        await this.dumpDebug("ali_upload_failed_final");
        throw new Error(`알리 이미지 업로드 실패: ${String(lastError?.message || lastError || "unknown")}`);
    }

    async scrollResultListForMore(rounds = 5) {
        if (!this.page) return;

        for (let i = 0; i < rounds; i += 1) {
            try {
                await this.page.mouse.wheel(0, 2200).catch(() => {});
                await this.page.waitForTimeout(450);
            } catch {}
        }

        try {
            await this.page.evaluate(() => {
                window.scrollTo(0, 0);
            });
        } catch {}

        await this.page.waitForTimeout(120);
    }

    async collectCandidatesFromPage(maxItems = 300) {
        if (!this.page) return [];

        try {
            await this.page.waitForTimeout(900);
            await this.scrollResultListForMore(5);

            const items = await this.page.evaluate((limit) => {
                const clean = (value) =>
                    String(value || "")
                        .replace(/\s+/g, " ")
                        .replace(/[\u200B-\u200D\uFEFF]/g, "")
                        .trim();

                const normalizeUrl = (url) => {
                    const s = String(url || "").trim();
                    if (!s) return "";
                    if (s.startsWith("http://") || s.startsWith("https://")) return s;
                    if (s.startsWith("//")) return `https:${s}`;
                    if (s.startsWith("/")) return `https://ko.aliexpress.com${s}`;
                    return s;
                };

                const normalizeImg = (url) => {
                    const s = String(url || "").trim();
                    if (!s) return "";
                    if (s.startsWith("data:image/")) return "";
                    if (s.startsWith("http://") || s.startsWith("https://")) return s;
                    if (s.startsWith("//")) return `https:${s}`;
                    if (s.startsWith("/")) return `https://ko.aliexpress.com${s}`;
                    return s;
                };

                const result = [];
                const anchors = Array.from(
                    document.querySelectorAll('#card-list a[href*="/item/"], .search-card-item[href*="/item/"], a[href*="/item/"]')
                );

                for (const a of anchors) {
                    const box =
                        a.closest(".search-item-card-wrapper-imageSearch") ||
                        a.closest(".search-item-card-wrapper-gallery") ||
                        a.closest(".search-item-card-wrapper") ||
                        a.closest(".card-out-wrapper") ||
                        a.closest("article") ||
                        a.closest('[class*="card"]') ||
                        a.closest("div");

                    const titleNode =
                        box?.querySelector('[class*="lw_k4"]') ||
                        box?.querySelector('[class*="title"]') ||
                        box?.querySelector("h1,h2,h3,h4");

                    const priceNode =
                        box?.querySelector('[class*="lw_el"]') ||
                        box?.querySelector('[class*="price"]');

                    const imgNode =
                        box?.querySelector("img.product-img") ||
                        box?.querySelector("img");

                    const title = clean(
                        a.getAttribute("title") ||
                        titleNode?.textContent ||
                        a.textContent ||
                        ""
                    );

                    const priceText = clean(
                        priceNode?.getAttribute("aria-label") ||
                        priceNode?.textContent ||
                        ""
                    );

                    const image = normalizeImg(
                        imgNode?.getAttribute("src") ||
                        imgNode?.getAttribute("data-src") ||
                        imgNode?.getAttribute("image-src") ||
                        imgNode?.getAttribute("srcset") ||
                        ""
                    );

                    const url = normalizeUrl(a.getAttribute("href") || a.href || "");
                    if (!url) continue;

                    result.push({
                        title,
                        priceText,
                        image,
                        url
                    });

                    if (result.length >= limit * 3) break;
                }

                return result;
            }, maxItems);

            return this.dedupeAndSort(items, maxItems);
        } catch (error) {
            this.log(`⚠️ 알리 페이지 직접 파싱 실패: ${String(error?.message || error)}`);
            return [];
        }
    }

    parseCandidatesFromHtml(html, maxItems = 300) {
        const $ = cheerio.load(html);
        const raw = [];

        $('#card-list a[href*="/item/"], .search-card-item[href*="/item/"], a[href*="/item/"]').each((_, a) => {
            const $a = $(a);
            const href = $a.attr("href") || "";

            const box =
                $a.closest(".search-item-card-wrapper-imageSearch").length
                    ? $a.closest(".search-item-card-wrapper-imageSearch")
                    : $a.closest(".search-item-card-wrapper-gallery").length
                        ? $a.closest(".search-item-card-wrapper-gallery")
                        : $a.closest(".card-out-wrapper").length
                            ? $a.closest(".card-out-wrapper")
                            : $a.closest("article").length
                                ? $a.closest("article")
                                : $a.closest('[class*="card"]').length
                                    ? $a.closest('[class*="card"]')
                                    : $a.closest("div");

            const title =
                $a.attr("title") ||
                box.find(".lw_k4").first().text() ||
                box.find('[class*="title"]').first().text() ||
                box.find("h1,h2,h3,h4").first().text() ||
                $a.text();

            const img =
                box.find("img.product-img").first().attr("src") ||
                box.find("img").first().attr("src") ||
                box.find("img").first().attr("data-src") ||
                box.find("img").first().attr("image-src") ||
                box.find("img").first().attr("srcset") ||
                "";

            const priceText =
                box.find(".lw_el").first().attr("aria-label") ||
                box.find(".lw_el").first().text() ||
                box.find('[class*="price"]').first().text() ||
                this.parsePrice(box.text());

            raw.push({
                title,
                priceText,
                image: img,
                url: href
            });
        });

        return this.dedupeAndSort(raw, maxItems);
    }

    async fetchResultHtml(resultUrl) {
        const cookieHeader = await this.getCookieHeaderForAli();

        const response = await axios.get(resultUrl, {
            headers: {
                ...this.defaultHeaders,
                ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                Referer: "https://ko.aliexpress.com/"
            },
            timeout: 22000,
            responseType: "text"
        });

        return String(response.data || "");
    }

    async collectCandidatesFast(resultUrl, maxItems = 300) {
        if (!resultUrl) return [];

        try {
            const html = await this.fetchResultHtml(resultUrl);
            const parsed = this.parseCandidatesFromHtml(html, maxItems);
            if (parsed.length) {
                this.log(`ℹ️ 알리 HTML 직접 파싱 성공: ${parsed.length}건`);
                return parsed;
            }
        } catch (error) {
            this.log(`⚠️ 알리 HTML 직접 파싱 실패: ${String(error?.message || error)}`);
        }

        return [];
    }

    async collectStableCandidates(resultUrl, maxItems = 300) {
        let items = await this.collectCandidatesFast(resultUrl, maxItems);

        if (items.length >= 20) {
            return items;
        }

        await this.page.waitForTimeout(1400);

        const secondTry = await this.collectCandidatesFast(resultUrl, maxItems);
        if (secondTry.length > items.length) {
            items = secondTry;
        }

        if (items.length >= 20) {
            return items;
        }

        const pageItems = await this.collectCandidatesFromPage(maxItems);
        if (pageItems.length > items.length) {
            items = pageItems;
        }

        return items;
    }

    async tryGoNextResultPage(pageNo = 2) {
        if (!this.page) return false;

        const nextSelectors = [
            'button[aria-label*="다음"]',
            'button[aria-label*="Next"]',
            'a[aria-label*="다음"]',
            'a[aria-label*="Next"]',
            '[class*="pagination-next"]',
            '[class*="Pagination-next"]',
            ".comet-pagination-next",
            ".next-btn"
        ];

        for (const selector of nextSelectors) {
            try {
                const loc = this.page.locator(selector).first();
                const count = await loc.count().catch(() => 0);
                if (!count) continue;

                const visible = await loc.isVisible().catch(() => false);
                if (!visible) continue;

                const beforeUrl = this.page.url();
                await loc.click({ force: true, timeout: 1800 }).catch(() => {});
                await this.waitForResultReady(beforeUrl);
                return true;
            } catch {}
        }

        try {
            const currentUrl = this.page.url();
            const nextUrl = new URL(currentUrl);
            nextUrl.searchParams.set("page", String(pageNo));
            await this.page.goto(nextUrl.toString(), {
                waitUntil: "domcontentloaded",
                timeout: 30000
            });
            await this.page.waitForTimeout(1500);
            return true;
        } catch (error) {
            this.log(`⚠️ 알리 다음 페이지 이동 실패: ${String(error?.message || error)}`);
        }

        return false;
    }

    async getNextPageCandidates(maxItems = 300) {
        if (!this.page) {
            return {
                ok: false,
                page: this.currentResultPage,
                items: [],
                message: "알리 결과 페이지가 열려 있지 않습니다."
            };
        }

        const nextPage = (this.currentResultPage || 1) + 1;
        const moved = await this.tryGoNextResultPage(nextPage);

        if (!moved) {
            return {
                ok: false,
                page: this.currentResultPage,
                items: [],
                message: "다음 페이지로 이동하지 못했습니다."
            };
        }

        this.currentResultPage = nextPage;
        const items = await this.collectStableCandidates(this.page.url(), maxItems);

        return {
            ok: true,
            page: nextPage,
            items
        };
    }

    async searchByImage({ imageUrl, itemNo, maxItemsPerPage = 300 }) {
        await this.init();

        this.searchSeq += 1;
        const searchToken = this.searchSeq;

        this.currentResultPage = 1;

        // 이전 결과 UI/상태가 남지 않도록 짧게 홈으로 복귀
        try {
            await this.page.goto("https://ko.aliexpress.com/", {
                waitUntil: "domcontentloaded",
                timeout: 30000
            });
            await this.page.waitForTimeout(1200);
        } catch {}

        const tmpFile = path.join(this.tmpDir, `ali_${itemNo || Date.now()}.jpg`);
        await this.downloadImage(imageUrl, tmpFile);

        this.log(`ℹ️ 알리 이미지 검색 시작: no=${itemNo || "-"} / token=${searchToken}`);

        const resultUrl = await this.uploadImage(tmpFile);
        const firstPageItems = await this.collectStableCandidates(resultUrl, maxItemsPerPage);

        this.log(`✅ 알리 후보 수집 완료: page=1 / count=${firstPageItems.length} / no=${itemNo || "-"}`);

        return {
            searched: true,
            resultUrl,
            pages: [firstPageItems],
            candidates: firstPageItems
        };
    }
}

module.exports = { AliExpressClient };
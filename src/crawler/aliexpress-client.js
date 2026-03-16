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
        this.debugDir = path.join(dataDir, "_debug_aliexpress");
        this.tmpDir = path.join(dataDir, "_tmp_aliexpress");
        this.defaultHeaders = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
        };
    }

    ensureDir(dir) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
            if (this.context) await this.context.close();
        } catch {}
        this.context = null;
        this.page = null;
    }

    async downloadImage(imageUrl, filePath) {
        if (!imageUrl) {
            throw new Error("알리 검색용 이미지 URL이 없습니다.");
        }

        const res = await fetch(imageUrl, {
            headers: {
                "User-Agent": this.defaultHeaders["User-Agent"]
            }
        });

        if (!res.ok) {
            throw new Error(`이미지 다운로드 실패: HTTP ${res.status}`);
        }

        const ab = await res.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(ab));
        return filePath;
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

    async getCookieHeaderForAli() {
        const cookies = await this.context.cookies("https://ko.aliexpress.com/");
        if (!Array.isArray(cookies) || !cookies.length) return "";
        return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    }

    async gotoDirectImageSearchPage() {
        if (!this.page) {
            throw new Error("알리 page가 초기화되지 않았습니다.");
        }

        const urls = [
            "https://ko.aliexpress.com/w/wholesale-.html?isNewImageSearch=y",
            "https://www.aliexpress.com/w/wholesale-.html?isNewImageSearch=y",
            "https://ko.aliexpress.com/"
        ];

        for (const url of urls) {
            try {
                this.logger(`ℹ️ 알리 이동: ${url}`);
                await this.page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: 30000
                });

                await this.page.waitForTimeout(2500);

                const input = await this.findFileInputQuick();
                if (input) {
                    this.logger(`✅ 알리 업로드 input 발견: ${url}`);
                    return input;
                }
            } catch (error) {
                this.logger(`⚠️ 알리 이동 실패: ${url} / ${String(error?.message || error)}`);
            }
        }

        await this.dumpDebug("ali_direct_page_failed");
        throw new Error("알리 직접 이미지검색 페이지에서 업로드 input을 찾지 못했습니다.");
    }

    async findFileInputQuick() {
        if (!this.page) return null;

        const selectors = [
            'input[type="file"]',
            'input[accept*="image"]',
            'input[accept*="jpg"]',
            'input[accept*="png"]'
        ];

        for (const sel of selectors) {
            try {
                const loc = this.page.locator(sel).first();
                const count = await loc.count().catch(() => 0);
                if (!count) continue;
                return loc;
            } catch {}
        }

        return null;
    }

    async waitForUploadInput(totalMs = 15000, stepMs = 500) {
        const loops = Math.max(1, Math.ceil(totalMs / stepMs));

        for (let i = 0; i < loops; i += 1) {
            const direct = await this.findFileInputQuick();
            if (direct) return direct;
            await this.page.waitForTimeout(stepMs);
        }

        return null;
    }

    async uploadImageFromDirectPage(imagePath) {
        const input = await this.gotoDirectImageSearchPage();
        await input.setInputFiles(imagePath);
        this.logger(`ℹ️ 알리 파일 업로드 완료: ${imagePath}`);

        await this.page.waitForTimeout(4000);

        try {
            await this.page.waitForURL(/isNewImageSearch=y|wholesale-\.html/i, {
                timeout: 20000
            });
        } catch {}

        const currentUrl = this.page.url();
        this.logger(`ℹ️ 알리 현재 URL: ${currentUrl}`);

        if (!/isNewImageSearch=y|wholesale-\.html/i.test(currentUrl)) {
            await this.dumpDebug("ali_upload_not_result");
            throw new Error("알리 이미지 업로드 후 결과 페이지로 이동하지 못했습니다.");
        }

        return currentUrl;
    }

    cleanText(v) {
        return String(v || "")
            .replace(/\s+/g, " ")
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            .trim();
    }

    normalizeAliUrl(u) {
        const s = String(u || "").trim();
        if (!s) return "";
        if (s.startsWith("http://") || s.startsWith("https://")) return s;
        if (s.startsWith("//")) return `https:${s}`;
        if (s.startsWith("/")) return `https://ko.aliexpress.com${s}`;
        return s;
    }

    normalizeAliImage(u) {
        const s = String(u || "").trim();
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

    dedupeAndSort(items, maxItems = 20) {
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
            if (!prev) {
                map.set(url, normalized);
                continue;
            }

            if (this.scoreCandidate(normalized) > this.scoreCandidate(prev)) {
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

    parseCandidatesFromHtml(html, maxItems = 20) {
        const $ = cheerio.load(html);
        const raw = [];

        $('a[href*="/item/"]').each((_, a) => {
            const $a = $(a);
            const href = $a.attr("href") || "";
            const box =
                $a.closest("article").length ? $a.closest("article") :
                    $a.closest('[class*="card"]').length ? $a.closest('[class*="card"]') :
                        $a.closest("div");

            const title =
                $a.attr("title") ||
                box.find('[class*="title"]').first().text() ||
                box.find("h1,h2,h3,h4").first().text() ||
                $a.text();

            const img =
                box.find("img").first().attr("src") ||
                box.find("img").first().attr("data-src") ||
                box.find("img").first().attr("image-src") ||
                box.find("img").first().attr("srcset") ||
                "";

            const priceText =
                box.find('[class*="price"]').first().text() ||
                this.parsePrice(box.text());

            raw.push({
                title,
                priceText,
                image: img,
                url: href
            });
        });

        if (!raw.length) {
            $("script").each((_, script) => {
                const txt = $(script).html() || "";
                const urlRegex = /https?:\/\/[^"'\\\s]+\/item\/[^"'\\\s]+/g;
                const imgRegex = /https?:\/\/[^"'\\\s]+(?:jpg|jpeg|png|webp)/gi;

                const urls = txt.match(urlRegex) || [];
                const imgs = txt.match(imgRegex) || [];

                for (let i = 0; i < urls.length; i += 1) {
                    raw.push({
                        title: "",
                        priceText: "",
                        image: imgs[i] || "",
                        url: urls[i]
                    });
                }
            });
        }

        return this.dedupeAndSort(raw, maxItems);
    }

    async fetchResultHtml(resultUrl) {
        const cookieHeader = await this.getCookieHeaderForAli();

        const res = await axios.get(resultUrl, {
            headers: {
                ...this.defaultHeaders,
                ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                Referer: "https://ko.aliexpress.com/"
            },
            timeout: 25000,
            responseType: "text"
        });

        return String(res.data || "");
    }

    async collectCandidatesFromPage(maxItems = 20) {
        if (!this.page) return [];

        try {
            const items = await this.page.evaluate((limit) => {
                const normalizeUrl = (u) => {
                    if (!u) return "";
                    if (u.startsWith("http://") || u.startsWith("https://")) return u;
                    if (u.startsWith("//")) return `https:${u}`;
                    if (u.startsWith("/")) return `https://ko.aliexpress.com${u}`;
                    return u;
                };

                const normalizeImg = (u) => {
                    if (!u) return "";
                    if (u.startsWith("data:image/")) return "";
                    if (u.startsWith("http://") || u.startsWith("https://")) return u;
                    if (u.startsWith("//")) return `https:${u}`;
                    if (u.startsWith("/")) return `https://ko.aliexpress.com${u}`;
                    return u;
                };

                const clean = (v) =>
                    String(v || "")
                        .replace(/\s+/g, " ")
                        .replace(/[\u200B-\u200D\uFEFF]/g, "")
                        .trim();

                const out = [];
                const anchors = Array.from(document.querySelectorAll('a[href*="/item/"]'));

                for (const a of anchors) {
                    const box =
                        a.closest("article") ||
                        a.closest('[class*="card"]') ||
                        a.closest("div");

                    const titleNode =
                        box?.querySelector('[class*="title"]') ||
                        box?.querySelector("h1,h2,h3,h4");

                    const priceNode = box?.querySelector('[class*="price"]');
                    const imgNode = box?.querySelector("img");

                    const title = clean(a.getAttribute("title") || titleNode?.textContent || a.textContent || "");
                    const priceText = clean(priceNode?.textContent || "");
                    const image = normalizeImg(
                        imgNode?.getAttribute("src") ||
                        imgNode?.getAttribute("data-src") ||
                        imgNode?.getAttribute("image-src") ||
                        ""
                    );
                    const url = normalizeUrl(a.getAttribute("href") || "");

                    if (!url) continue;

                    out.push({
                        title,
                        priceText,
                        image,
                        url
                    });

                    if (out.length >= limit * 4) break;
                }

                return out;
            }, maxItems).catch(() => []);

            return this.dedupeAndSort(items, maxItems);
        } catch {
            return [];
        }
    }

    async searchByImage({ imageUrl, itemNo, maxItems = 20 }) {
        await this.init();

        const tmpFile = path.join(this.tmpDir, `ali_${itemNo || Date.now()}.jpg`);
        await this.downloadImage(imageUrl, tmpFile);

        this.logger(`ℹ️ 알리 이미지 검색 시작: no=${itemNo || "-"}`);

        const resultUrl = await this.uploadImageFromDirectPage(tmpFile);

        let candidates = await this.collectCandidatesFromPage(maxItems);

        if (!candidates.length) {
            const html = await this.fetchResultHtml(resultUrl);
            await this.dumpDebug(`ali_${itemNo || "unknown"}_result`, html);
            candidates = this.parseCandidatesFromHtml(html, maxItems);
        } else {
            await this.dumpDebug(`ali_${itemNo || "unknown"}_page`);
        }

        this.logger(`✅ 알리 후보 수집 완료: ${candidates.length}개 / no=${itemNo || "-"}`);

        return {
            searched: true,
            resultUrl,
            candidates
        };
    }
}

module.exports = { AliExpressClient };
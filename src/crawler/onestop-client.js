const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

class OnestopClient {
    constructor({
                    dataDir,
                    headless = true,
                    logger = console.log,
                    baseUrl = "https://onestopdome.com",
                    storageStatePath = null
                } = {}) {
        this.dataDir = dataDir || path.resolve(process.cwd(), "data");
        this.headless = !!headless;
        this.logger = typeof logger === "function" ? logger : console.log;
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.storageStatePath =
            storageStatePath || path.join(this.dataDir, "onestop-storage.json");

        this.browser = null;
        this.context = null;
        this.page = null;
        this.lightweight = true;
    }

    log(message) {
        this.logger(message);
    }

    async init({ lightweight = true } = {}) {
        if (this.browser) return;

        this.lightweight = !!lightweight;

        const contextOptions = {};
        if (fs.existsSync(this.storageStatePath)) {
            contextOptions.storageState = this.storageStatePath;
            this.log(`ℹ️ 원스톱 storageState 사용: ${this.storageStatePath}`);
        } else {
            this.log(`ℹ️ 원스톱 storageState 없음: ${this.storageStatePath}`);
        }

        this.browser = await chromium.launch({ headless: this.headless });
        this.context = await this.browser.newContext(contextOptions);

        // 로그인 화면은 정상 렌더링, 상세 크롤링은 경량화
        if (this.lightweight) {
            await this.context.route("**/*", async (route) => {
                const req = route.request();
                const type = req.resourceType();
                const url = req.url();

                if (
                    url.includes("/member/login") ||
                    url.includes("/login") ||
                    url.includes("/login_process")
                ) {
                    await route.continue();
                    return;
                }

                if (["image", "stylesheet", "font", "media"].includes(type)) {
                    await route.abort();
                    return;
                }

                await route.continue();
            });
        }

        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(20000);
    }

    async close() {
        try { if (this.page) await this.page.close(); } catch {}
        try { if (this.context) await this.context.close(); } catch {}
        try { if (this.browser) await this.browser.close(); } catch {}

        this.page = null;
        this.context = null;
        this.browser = null;
    }

    async saveStorageState() {
        if (!this.context) return;
        await this.context.storageState({ path: this.storageStatePath });
        this.log(`✅ 원스톱 storageState 저장: ${this.storageStatePath}`);
    }

    async openManualLoginPage() {
        await this.init({ lightweight: false });
        await this.page.goto(`${this.baseUrl}/member/login`, {
            waitUntil: "domcontentloaded"
        });
        this.log("🪟 원스톱 로그인 창을 열었습니다. 로그인 후 수동 확인하세요.");
        return { ok: true, url: this.page.url() };
    }

    async confirmManualLogin() {
        await this.init({ lightweight: false });
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForTimeout(1000);

        const html = await this.page.content();
        const loginOk =
            html.includes("LOGOUT") ||
            html.includes("님 반갑습니다") ||
            html.includes("/login_process/logout");

        if (!loginOk) {
            throw new Error("원스톱 로그인 상태가 확인되지 않았습니다.");
        }

        await this.saveStorageState();
        return { ok: true, url: this.page.url() };
    }

    async loginWithCredentials({ userId, password }) {
        await this.init({ lightweight: false });

        await this.page.goto(`${this.baseUrl}/member/login`, {
            waitUntil: "domcontentloaded"
        });

        const userInput = this.page.locator('input[name="userid"], input[name="user_id"]').first();
        const passInput = this.page.locator('input[type="password"]').first();

        await userInput.fill(String(userId || ""));
        await passInput.fill(String(password || ""));

        const submitCandidates = [
            this.page.locator('button[type="submit"]').first(),
            this.page.locator('input[type="submit"]').first(),
            this.page.locator(".btn_login").first(),
            this.page.locator('a[href*="login"]').first()
        ];

        let clicked = false;
        for (const locator of submitCandidates) {
            try {
                if (await locator.count()) {
                    await locator.click();
                    clicked = true;
                    break;
                }
            } catch {}
        }

        if (!clicked) {
            await this.page.keyboard.press("Enter");
        }

        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForTimeout(1500);

        await this.confirmManualLogin();
    }

    normalizeUrl(url) {
        if (!url) return "";
        if (/^https?:\/\//i.test(url)) return url;
        if (url.startsWith("/")) return `${this.baseUrl}${url}`;
        return `${this.baseUrl}/${url.replace(/^\/+/, "")}`;
    }

    extractGoodsNo(url) {
        const match = String(url || "").match(/[?&]no=(\d+)/i);
        return match ? String(match[1]) : "";
    }

    async debugDetailPage(prefix = "DEBUG") {
        try {
            const info = await this.page.evaluate(() => {
                return {
                    url: location.href,
                    title: document.title || "",
                    imgCount: document.querySelectorAll("img").length,
                    bodyTextSnippet: (document.body?.innerText || "").slice(0, 500),
                    bodyHtmlSnippet: (document.body?.innerHTML || "").slice(0, 2000)
                };
            });
            this.log(`${prefix}: ${JSON.stringify(info, null, 2)}`);
        } catch (error) {
            this.log(`${prefix} 실패: ${String(error?.message || error)}`);
        }
    }

    async crawlGoodsMain(url) {
        const targetUrl = this.normalizeUrl(url);
        if (!targetUrl) {
            throw new Error("상세 URL이 비어 있습니다.");
        }

        await this.page.goto(targetUrl, {
            waitUntil: "domcontentloaded"
        });

        await this.page.waitForTimeout(1200);

        await this.page.waitForFunction(
            () =>
                typeof window.gl_goods_price !== "undefined" ||
                document.body.innerText.includes("로그인") ||
                document.body.innerHTML.includes("goods_description"),
            { timeout: 5000 }
        ).catch(() => {});

        await this.page.waitForTimeout(500);

        const html = await this.page.content();

        const loginRequired =
            html.includes("member/login") &&
            !html.includes("gl_option_n0") &&
            !html.includes("님 반갑습니다");

        const data = await this.page.evaluate(() => {
            const goodsPrice = Number(window.gl_goods_price || 0);
            const rawOptions = [
                ...(window.gl_option_n0 || []),
                ...(window.gl_option_n1 || []),
                ...(window.gl_option_n2 || []),
                ...(window.gl_option_n3 || [])
            ];

            const options = rawOptions.map((opt) => {
                const optionPrice = Number(opt?.price || 0);
                return {
                    optionName: String(opt?.opt || "").trim(),
                    optionPrice,
                    addPrice: optionPrice - goodsPrice
                };
            });

            return {
                goodsPrice,
                options
            };
        });

        return {
            url: targetUrl,
            goodsPrice: data.goodsPrice || 0,
            options: Array.isArray(data.options) ? data.options : [],
            optionSummary: (data.options || []).map((v) => v.optionName).join("|"),
            optionAddPriceSummary: (data.options || []).map((v) => String(v.addPrice)).join("|"),
            loginRequired,
            hasOptions: Array.isArray(data.options) && data.options.length > 0
        };
    }

    async crawlGoodsContentsByNo(goodsNo) {
        if (!goodsNo) {
            return {
                detailHtml: "",
                detailImages: [],
                detailSourceUrl: "",
                detailImageCount: 0
            };
        }

        const contentsUrl = `${this.baseUrl}/goods/view_contents?no=${goodsNo}&zoom=1`;

        await this.page.goto(contentsUrl, {
            waitUntil: "domcontentloaded"
        });

        await this.page.waitForTimeout(1000);

        const data = await this.page.evaluate(() => {
            const root = document.querySelector(".goods_desc_contents.goods_description");

            if (!root) {
                return {
                    detailHtml: "",
                    detailImages: []
                };
            }

            const cloned = root.cloneNode(true);

            const detailImages = [];
            const imgs = Array.from(cloned.querySelectorAll("img"));

            for (const img of imgs) {
                const src =
                    img.getAttribute("data-original") ||
                    img.getAttribute("data-src") ||
                    img.getAttribute("src") ||
                    "";

                if (src) {
                    img.setAttribute("src", src);
                    detailImages.push(src);
                }
            }

            return {
                detailHtml: cloned.innerHTML.trim(),
                detailImages: [...new Set(detailImages.filter(Boolean))]
            };
        });

        return {
            detailHtml: data.detailHtml || "",
            detailImages: Array.isArray(data.detailImages) ? data.detailImages : [],
            detailSourceUrl: contentsUrl,
            detailImageCount: Array.isArray(data.detailImages) ? data.detailImages.length : 0
        };
    }

    async crawlGoodsDetail(url) {
        await this.init({ lightweight: true });

        const targetUrl = this.normalizeUrl(url);
        const goodsNo = this.extractGoodsNo(targetUrl);

        const main = await this.crawlGoodsMain(targetUrl);
        const contents = await this.crawlGoodsContentsByNo(goodsNo);

        if (!contents.detailHtml) {
            await this.debugDetailPage("DEBUG view_contents 비어있음");
        }

        return {
            url: targetUrl,
            goodsNo,
            goodsPrice: main.goodsPrice || 0,
            options: main.options || [],
            optionSummary: main.optionSummary || "",
            optionAddPriceSummary: main.optionAddPriceSummary || "",
            detailHtml: contents.detailHtml || "",
            detailImages: contents.detailImages || [],
            detailSourceUrl: contents.detailSourceUrl || "",
            detailImageCount: contents.detailImageCount || 0,
            loginRequired: !!main.loginRequired,
            hasOptions: !!main.hasOptions
        };
    }
}

module.exports = { OnestopClient };
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
    }

    log(message) {
        this.logger(message);
    }

    async init() {
        if (this.browser) return;

        const contextOptions = {};
        if (fs.existsSync(this.storageStatePath)) {
            contextOptions.storageState = this.storageStatePath;
            this.log(`ℹ️ 원스톱 storageState 사용: ${this.storageStatePath}`);
        } else {
            this.log(`ℹ️ 원스톱 storageState 없음: ${this.storageStatePath}`);
        }

        this.browser = await chromium.launch({ headless: this.headless });
        this.context = await this.browser.newContext(contextOptions);

        await this.context.route("**/*", async (route) => {
            const type = route.request().resourceType();
            if (["image", "stylesheet", "font", "media"].includes(type)) {
                await route.abort();
                return;
            }
            await route.continue();
        });

        this.page = await this.context.newPage();
        this.page.setDefaultTimeout(15000);
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
        await this.init();
        await this.page.goto(`${this.baseUrl}/member/login`, {
            waitUntil: "domcontentloaded"
        });
        this.log("🪟 원스톱 로그인 창을 열었습니다. 로그인 후 수동 확인하세요.");
        return { ok: true, url: this.page.url() };
    }

    async confirmManualLogin() {
        await this.init();
        await this.page.waitForLoadState("domcontentloaded");
        await this.page.waitForTimeout(500);

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

    normalizeUrl(url) {
        if (!url) return "";
        if (/^https?:\/\//i.test(url)) return url;
        if (url.startsWith("/")) return `${this.baseUrl}${url}`;
        return `${this.baseUrl}/${url.replace(/^\/+/, "")}`;
    }

    async crawlGoodsDetail(url) {
        await this.init();

        const targetUrl = this.normalizeUrl(url);
        if (!targetUrl) {
            throw new Error("상세 URL이 비어 있습니다.");
        }

        await this.page.goto(targetUrl, {
            waitUntil: "domcontentloaded"
        });

        await this.page.waitForFunction(
            () => typeof window.gl_goods_price !== "undefined" || document.body.innerText.includes("로그인"),
            { timeout: 3000 }
        ).catch(() => {});

        await this.page.waitForTimeout(250);

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
}

module.exports = { OnestopClient };
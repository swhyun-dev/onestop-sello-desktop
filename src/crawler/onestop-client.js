// src/crawler/sello-client.js
const {
    pickSmartKeywords,
    pickCoupangKeywords
} = require("../parser/sello-parser");

class HttpError extends Error {
    constructor(status, statusText, bodyText, retryAfterSec) {
        super(`HTTP ${status} ${statusText}`);
        this.name = "HttpError";
        this.status = status;
        this.statusText = statusText;
        this.bodyText = bodyText || "";
        this.retryAfterSec = retryAfterSec ?? null;
    }
}

class SelloClient {
    constructor({ cookie, logger }) {
        this.cookie = String(cookie || "").trim();
        this.baseUrl = "https://sellochomes.co.kr";
        this.logger = typeof logger === "function" ? logger : () => {};
        this.maxRetries = 4;
        this.max429WaitMs = 5 * 60 * 1000;
        this.requestTimeoutMs = 15000;
    }

    sanitizeKeyword(keyword) {
        let s = String(keyword || "").trim();

        s = s.replace(/\[[^\]]*\]/g, " ");
        s = s.replace(/\s+/g, " ").trim();

        if (s.length > 20) {
            s = s.slice(0, 20).trim();
        }

        return s;
    }

    makeHeaders(keywordForReferer) {
        return {
            Accept: "application/json, text/plain, */*",
            "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
            Connection: "keep-alive",
            Cookie: this.cookie,
            Origin: "https://sellochomes.co.kr",
            Referer: `${this.baseUrl}/sellerlife/keyword-analysis/?keyword=${encodeURIComponent(keywordForReferer)}`,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
        };
    }

    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async fetchJsonGET(url, keywordForReferer, label) {
        this.logger(`ℹ️ 셀록 요청 시작: ${label}`);

        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, this.requestTimeoutMs);

        try {
            const res = await fetch(url, {
                method: "GET",
                headers: this.makeHeaders(keywordForReferer),
                signal: controller.signal
            });

            const retryAfterHeader = res.headers.get("retry-after");
            const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : null;
            const text = await res.text().catch(() => "");

            if (!res.ok) {
                this.logger(`⚠️ 셀록 HTTP ${res.status} / ${label}`);
                this.logger(`⚠️ 응답 일부: ${String(text).slice(0, 300)}`);
                throw new HttpError(res.status, res.statusText, text.slice(0, 1000), retryAfterSec);
            }

            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (error) {
                this.logger(`⚠️ 셀록 JSON 파싱 실패 / ${label}`);
                this.logger(`⚠️ 응답 일부: ${String(text).slice(0, 300)}`);
                throw new Error(`JSON 파싱 실패: ${String(error?.message || error)}`);
            }

            this.logger(`✅ 셀록 요청 성공: ${label}`);
            return parsed;
        } catch (error) {
            if (error?.name === "AbortError") {
                this.logger(`⚠️ 셀록 요청 타임아웃(${this.requestTimeoutMs}ms): ${label}`);
                throw new Error(`셀록 요청 타임아웃: ${label}`);
            }
            throw error;
        } finally {
            clearTimeout(timer);
        }
    }

    async withRetry(fn, label) {
        let lastErr = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
            try {
                return await fn();
            } catch (error) {
                lastErr = error;

                if (
                    error?.name === "HttpError" &&
                    error.status === 403 &&
                    String(error.bodyText || "").includes("로그인 필요")
                ) {
                    throw new Error("셀록 로그인 필요 / Cookie 부족 또는 만료");
                }

                if (attempt === this.maxRetries) {
                    throw error;
                }

                if (error?.name === "HttpError" && error.status === 429) {
                    let waitMs = 0;
                    if (Number.isFinite(error.retryAfterSec) && error.retryAfterSec > 0) {
                        waitMs = error.retryAfterSec * 1000;
                    } else {
                        waitMs = Math.min(15000 * Math.pow(2, attempt), this.max429WaitMs);
                    }

                    this.logger(
                        `⚠️ ${label} 429 -> ${Math.ceil(waitMs / 1000)}초 대기 후 재시도 (${attempt + 1}/${this.maxRetries})`
                    );
                    await this.sleep(waitMs);
                    continue;
                }

                const waitMs = 700 + attempt * 700;
                this.logger(
                    `⚠️ ${label} 실패 -> ${waitMs}ms 후 재시도 (${attempt + 1}/${this.maxRetries}) : ${String(error?.message || error).split("\n")[0]}`
                );
                await this.sleep(waitMs);
            }
        }

        throw lastErr;
    }

    async search(keyword) {
        const safeKeyword = this.sanitizeKeyword(keyword);
        const url = `${this.baseUrl}/api/v1/sellerlife/keyword-analysis/search?keyword=${encodeURIComponent(safeKeyword)}&first=true`;
        return this.withRetry(
            () => this.fetchJsonGET(url, safeKeyword, `search(${safeKeyword})`),
            `search(${safeKeyword})`
        );
    }

    async coupangPopularKeyword(keyword) {
        const safeKeyword = this.sanitizeKeyword(keyword);
        const url = `${this.baseUrl}/api/v1/sellerlife/keyword-analysis/CoupangPopularyKeyword?keyword=${encodeURIComponent(safeKeyword)}`;
        return this.withRetry(
            () => this.fetchJsonGET(url, safeKeyword, `coupang(${safeKeyword})`),
            `coupang(${safeKeyword})`
        );
    }

    async searchAll(keyword) {
        const safeKeyword = this.sanitizeKeyword(keyword);
        this.logger(`ℹ️ 셀록 searchAll 시작: ${safeKeyword}`);

        const [searchJson, coupangJson] = await Promise.all([
            this.search(safeKeyword),
            this.coupangPopularKeyword(safeKeyword)
        ]);

        this.logger(`✅ 셀록 searchAll 완료: ${safeKeyword}`);

        return {
            keyword: safeKeyword,
            searchJson,
            smartKeywords: pickSmartKeywords(searchJson, 15),
            coupangKeywords: pickCoupangKeywords(coupangJson, 15)
        };
    }
}

module.exports = { SelloClient };
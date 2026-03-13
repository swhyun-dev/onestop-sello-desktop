// src/core/job-manager.js
const fs = require("node:fs");
const path = require("node:path");
const { parseRangeText } = require("./range-parser");
const { createLogger } = require("../utils/logger");
const { SelloClient } = require("../crawler/sello-client");
const { splitCandidates } = require("../crawler/compare-service");
const { FileDb } = require("../storage/file-db");

class JobManager {
    constructor({ dataDir, stateStore, notify }) {
        this.dataDir = dataDir;
        this.stateStore = stateStore;
        this.notify = notify;
        this.logger = createLogger({ dataDir });
        this.db = new FileDb({ dataDir });
        this.running = false;
        this.stopRequested = false;
        this.decisionResolver = null;
        this.onestopProductsPath = path.resolve(dataDir, "onestop_products.json");
    }

    emit() {
        this.notify(this.stateStore.getState());
    }

    log(message) {
        this.logger.log(message);
        this.stateStore.appendLog(message);
        this.emit();
    }

    loadOnestopProducts() {
        if (!fs.existsSync(this.onestopProductsPath)) {
            throw new Error(`원스톱 상품 JSON이 없습니다: ${this.onestopProductsPath}`);
        }

        const raw = fs.readFileSync(this.onestopProductsPath, "utf-8").trim();
        if (!raw) {
            throw new Error(`원스톱 상품 JSON이 비어 있습니다: ${this.onestopProductsPath}`);
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (error) {
            throw new Error(`원스톱 상품 JSON 파싱 실패: ${String(error?.message || error)}`);
        }

        if (!Array.isArray(parsed)) {
            throw new Error("원스톱 상품 JSON 형식이 올바르지 않습니다. 배열이어야 합니다.");
        }

        return parsed;
    }

    normalizeKeyword(title) {
        let s = String(title || "").trim();
        s = s.replace(/돌다리$/i, "").trim();

        const codeMatch = s.match(/\b([A-Z]\d{3,5})\b/i);
        const code = codeMatch ? codeMatch[1].toUpperCase() : "";

        let beforeCode = s;
        if (codeMatch && typeof codeMatch.index === "number") {
            beforeCode = s.slice(0, codeMatch.index).trim();
        }

        const parts = beforeCode.split(/\s+/).filter(Boolean);
        let productName = beforeCode;

        if (parts.length >= 2) {
            productName = parts.slice(1).join(" ").trim();
        }

        if (!productName) {
            productName = beforeCode;
        }

        let result = [productName, code].filter(Boolean).join(" ").trim();

        if (!result) {
            result = productName || s;
        }

        result = result.replace(/\s+/g, " ").trim();

        if (result.length > 20) {
            if (code) {
                const maxNameLen = Math.max(1, 20 - code.length - 1);
                result = `${productName.slice(0, maxNameLen).trim()} ${code}`.trim();
            } else {
                result = result.slice(0, 20).trim();
            }
        }

        return result;
    }

    buildSearchKeyword(item) {
        return this.normalizeKeyword(item?.title || "");
    }

    async start({ rangeText, selloCookie }) {
        if (this.running) {
            return { ok: false, message: "이미 실행 중입니다." };
        }

        if (!selloCookie || !String(selloCookie).trim()) {
            return { ok: false, message: "셀록 Cookie가 필요합니다." };
        }

        const numbers = parseRangeText(rangeText);
        if (!numbers.length) {
            return { ok: false, message: "범위에서 상품번호를 만들지 못했습니다." };
        }

        let products = this.loadOnestopProducts();
        const targetSet = new Set(numbers.map((n) => Number(n)));
        products = products.filter((item) => item && Number.isFinite(Number(item.no)) && targetSet.has(Number(item.no)));

        if (!products.length) {
            return { ok: false, message: "선택한 범위에 해당하는 원스톱 상품이 없습니다." };
        }

        this.running = true;
        this.stopRequested = false;

        this.stateStore.resetForRun({
            total: products.length,
            headless: false,
            rangeText
        });

        this.log(`🚀 작업 시작 / 총 ${products.length}건`);
        this.log(`ℹ️ 원스톱 JSON 사용: ${this.onestopProductsPath}`);
        this.log(`ℹ️ 범위 기준 상품번호 시작: ${products[0].no}`);

        this.run(products, { selloCookie }).catch((error) => {
            this.stateStore.setStatus("ERROR");
            this.log(`❌ ${String(error?.message || error)}`);
            this.running = false;
            this.emit();
        });

        return { ok: true, total: products.length };
    }

    async stop() {
        this.stopRequested = true;
        this.stateStore.setStatus("STOPPED");
        this.log("■ 중지 요청됨");

        if (this.decisionResolver) {
            this.decisionResolver({ action: "pass" });
            this.decisionResolver = null;
        }

        this.emit();
        return { ok: true };
    }

    async submitDecision(payload) {
        if (!this.decisionResolver) {
            return { ok: false, message: "현재 대기중인 판정이 없습니다." };
        }

        const action = String(payload?.action || "").trim();
        const searchKeyword = String(payload?.searchKeyword || "").trim();
        const passReasonCode = String(payload?.passReasonCode || "").trim();
        const passReasonText = String(payload?.passReasonText || "").trim();

        if (action === "retry" && !searchKeyword) {
            return { ok: false, message: "재검색 키워드가 비어 있습니다." };
        }

        if (action === "pass" && !passReasonCode) {
            return { ok: false, message: "패스 사유 코드가 비어 있습니다." };
        }

        const resolver = this.decisionResolver;
        this.decisionResolver = null;
        resolver({ action, searchKeyword, passReasonCode, passReasonText });

        return { ok: true };
    }

    async waitForDecision(searchKeyword) {
        this.stateStore.setPendingDecision({ searchKeyword });
        this.stateStore.setStatus("WAITING_DECISION");
        this.emit();

        return new Promise((resolve) => {
            this.decisionResolver = resolve;
        });
    }

    async waitForKeywordFix(onestopItem, currentKeyword, noticeMessage) {
        this.stateStore.setCurrent({
            onestop: onestopItem,
            searchKeyword: currentKeyword,
            smartCandidate: null,
            coupangCandidate: null,
            noticeMessage
        });
        this.emit();

        this.log(noticeMessage);
        return this.waitForDecision(currentKeyword);
    }

    async run(products, credentials) {
        const sello = new SelloClient({
            cookie: credentials.selloCookie,
            logger: (msg) => this.log(msg)
        });

        for (const item of products) {
            if (this.stopRequested) break;

            const onestopItem = {
                exists: true,
                no: Number(item.no),
                url: String(item.url || ""),
                finalUrl: String(item.url || ""),
                title: String(item.title || "").trim(),
                price: item.price ?? null,
                priceText: item.price != null ? String(item.price) : "",
                thumbnailUrl: String(item.thumbnail || ""),
                category: String(item.category || "").trim()
            };

            this.stateStore.setCurrent({
                onestop: onestopItem,
                searchKeyword: "",
                smartCandidate: null,
                coupangCandidate: null,
                noticeMessage: ""
            });
            this.emit();

            try {
                this.log(`- 원스톱(JSON) 조회: no=${onestopItem.no} / ${onestopItem.title}`);

                let activeKeyword = this.buildSearchKeyword(onestopItem);
                this.stateStore.setCurrent({
                    onestop: onestopItem,
                    searchKeyword: activeKeyword,
                    noticeMessage: ""
                });
                this.emit();

                let selloResult = null;
                let candidates = null;

                while (true) {
                    this.log(`- 셀록 검색: ${activeKeyword}`);
                    selloResult = await sello.searchAll(activeKeyword);
                    candidates = splitCandidates(selloResult.searchJson);

                    this.log(
                        `ℹ️ 후보 추출 완료 / rawCount=${candidates.rawCount} / smart=${candidates.smartCandidate?.title || "-"} / coupang=${candidates.coupangCandidate?.title || "-"}`
                    );

                    if (candidates.rawCount === 0) {
                        const decision = await this.waitForKeywordFix(
                            onestopItem,
                            activeKeyword,
                            "검색 결과가 없습니다. 검색어를 수정한 뒤 재검색하거나 패스하세요."
                        );

                        if (decision.action === "retry") {
                            activeKeyword = decision.searchKeyword;
                            continue;
                        }

                        if (decision.action === "pass") {
                            await this.applyDecision(
                                onestopItem,
                                { smartKeywords: [], coupangKeywords: [], searchJson: null },
                                { smartCandidate: null, coupangCandidate: null, rawCount: 0 },
                                decision,
                                activeKeyword
                            );
                            break;
                        }

                        await this.applyDecision(
                            onestopItem,
                            { smartKeywords: [], coupangKeywords: [], searchJson: null },
                            { smartCandidate: null, coupangCandidate: null, rawCount: 0 },
                            {
                                action: "pass",
                                passReasonCode: "other",
                                passReasonText: "검색 결과 없음 / 수동 패스"
                            },
                            activeKeyword
                        );
                        break;
                    }

                    this.stateStore.setCurrent({
                        onestop: onestopItem,
                        searchKeyword: activeKeyword,
                        smartCandidate: candidates.smartCandidate,
                        coupangCandidate: candidates.coupangCandidate,
                        noticeMessage: ""
                    });
                    this.emit();

                    this.log("⏸ 사용자 판정 대기중");
                    const decision = await this.waitForDecision(activeKeyword);

                    if (decision.action === "retry") {
                        activeKeyword = decision.searchKeyword;
                        this.stateStore.setCurrent({
                            onestop: onestopItem,
                            searchKeyword: activeKeyword,
                            smartCandidate: null,
                            coupangCandidate: null,
                            noticeMessage: ""
                        });
                        this.emit();
                        continue;
                    }

                    await this.applyDecision(onestopItem, selloResult, candidates, decision, activeKeyword);
                    break;
                }

                this.stateStore.incrementProcessed(1);
                this.stateStore.clearPendingDecision();
                this.stateStore.clearCandidates();
                this.stateStore.setCurrent({
                    noticeMessage: ""
                });
                this.stateStore.setStatus("RUNNING");
                this.emit();
            } catch (error) {
                const errorItem = {
                    no: onestopItem.no,
                    url: onestopItem.url,
                    title: onestopItem.title,
                    error: String(error?.message || error),
                    createdAt: new Date().toISOString()
                };
                this.db.appendError(errorItem);
                this.stateStore.incrementCount("errors");
                this.stateStore.incrementProcessed(1);
                this.log(`❌ 오류(${onestopItem.no}): ${errorItem.error}`);
                this.emit();
            }
        }

        if (this.stopRequested) {
            this.stateStore.setStatus("STOPPED");
        } else {
            this.stateStore.setStatus("DONE");
            this.log("✅ 작업 완료");
        }

        this.running = false;
        this.emit();
    }

    async applyDecision(onestopItem, selloResult, candidates, decision, searchKeyword) {
        const baseRecord = {
            createdAt: new Date().toISOString(),
            searchKeyword,
            onestop: onestopItem,
            sello: {
                rawCount: candidates?.rawCount ?? null,
                smartKeywords: selloResult?.smartKeywords || [],
                coupangKeywords: selloResult?.coupangKeywords || [],
                smartCandidate: candidates?.smartCandidate || null,
                coupangCandidate: candidates?.coupangCandidate || null
            }
        };

        if (decision.action === "smartstore") {
            this.db.appendSmartstore({ ...baseRecord, matched: candidates?.smartCandidate || null });
            this.stateStore.incrementCount("smartstore");
            this.log(`✅ 스마트스토어 확정: ${onestopItem.no}`);
            return;
        }

        if (decision.action === "coupang") {
            this.db.appendCoupang({ ...baseRecord, matched: candidates?.coupangCandidate || null });
            this.stateStore.incrementCount("coupang");
            this.log(`✅ 쿠팡 확정: ${onestopItem.no}`);
            return;
        }

        this.db.appendPassed({
            ...baseRecord,
            reason: decision.action || "manual_pass",
            passReasonCode: decision.passReasonCode || "other",
            passReasonText: decision.passReasonText || "기타 사유"
        });
        this.stateStore.incrementCount("passed");
        this.log(
            `⏭ 패스: ${onestopItem.no} / ${decision.passReasonText || decision.passReasonCode || "기타 사유"}`
        );
    }
}

module.exports = { JobManager };
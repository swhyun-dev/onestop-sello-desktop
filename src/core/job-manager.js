// src/core/job-manager.js
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { parseRangeText } = require("./range-parser");
const { createLogger } = require("../utils/logger");
const { SelloClient } = require("../crawler/sello-client");
const { AliExpressClient } = require("../crawler/aliexpress-client");
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
        this.browser = null;
        this.aliClient = null;
        this.aliReady = false;

        this.onestopProductsPath = path.resolve(dataDir, "onestop_products.json");
        this.resumeProgressPath = path.resolve(dataDir, "crawl-progress.json");

        this.resumeNoticeMessage = "";
        this.currentRunKey = "";
        this.currentRangeText = "";
        this.currentProcessedNos = new Set();
        this.editMode = null;
    }

    emit() {
        this.notify(this.stateStore.getState());
    }

    log(message) {
        this.logger.log(message);
        this.stateStore.appendLog(message);
        this.emit();
    }

    async ensureBrowser(headless) {
        if (this.browser) return;

        const executablePath = this.getChromiumPath();

        this.browser = await chromium.launch({
            headless: !!headless,
            slowMo: headless ? 0 : 50,
            ...(executablePath ? { executablePath } : {})
        });

        this.aliClient = new AliExpressClient({
            browser: this.browser,
            dataDir: this.dataDir,
            logger: (msg) => this.log(msg)
        });
    }

    async closeBrowser() {
        try {
            if (this.aliClient) await this.aliClient.close();
        } catch {}

        try {
            if (this.browser) await this.browser.close();
        } catch {}

        this.aliClient = null;
        this.browser = null;
        this.aliReady = false;
    }

    getChromiumPath() {
        if (!app.isPackaged) return null;

        const browsersDir = path.join(process.resourcesPath, "playwright-browsers");
        if (!fs.existsSync(browsersDir)) {
            return null;
        }

        const chromiumFolder = fs.readdirSync(browsersDir)
            .find((name) => name.startsWith("chromium-"));

        if (!chromiumFolder) {
            return null;
        }

        const baseDir = path.join(browsersDir, chromiumFolder);

        const candidates = [
            path.join(baseDir, "chrome-win", "chrome.exe"),
            path.join(baseDir, "chrome-win64", "chrome.exe")
        ];

        const found = candidates.find((p) => fs.existsSync(p));
        return found || null;
    }

    loadOnestopProducts() {
        if (!fs.existsSync(this.onestopProductsPath)) {
            throw new Error(`원스톱 상품 JSON이 없습니다: ${this.onestopProductsPath}`);
        }

        const raw = fs.readFileSync(this.onestopProductsPath, "utf-8").trim();
        if (!raw) {
            throw new Error(`원스톱 상품 JSON이 비어 있습니다: ${this.onestopProductsPath}`);
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            throw new Error("원스톱 상품 JSON 형식이 올바르지 않습니다. 배열이어야 합니다.");
        }

        return parsed;
    }

    normalizeRangeText(text) {
        return String(text || "").replace(/\s+/g, "").trim();
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

    setLoadingState({ aliLoading = false, aliLoadingText = "", reviewLoading = false, reviewLoadingText = "" } = {}) {
        this.stateStore.setCurrent({
            isAliLoading: !!aliLoading,
            aliLoadingText: aliLoadingText || "",
            isReviewLoading: !!reviewLoading,
            reviewLoadingText: reviewLoadingText || ""
        });
        this.emit();
    }

    normalizeOnestopOptions(found) {
        const rawOptions = Array.isArray(found?.options) ? found.options : [];

        if (!rawOptions.length) {
            return [];
        }

        const basePrice = Number(found?.price ?? found?.goodsPrice ?? 0);

        const isFlatOptionArray = rawOptions.every((opt) => {
            return opt && !Array.isArray(opt?.values) && !Array.isArray(opt?.items) && !Array.isArray(opt?.options);
        });

        if (isFlatOptionArray) {
            const values = rawOptions
                .map((opt, idx) => {
                    const name = String(
                        opt?.optionName ||
                        opt?.name ||
                        opt?.value ||
                        opt?.title ||
                        `옵션${idx + 1}`
                    ).trim();

                    const addPrice = Number(opt?.addPrice ?? 0);
                    const optionPrice = Number(opt?.optionPrice ?? (basePrice + addPrice));

                    return {
                        name,
                        price: Number.isFinite(optionPrice) ? optionPrice : 0,
                        diff: Number.isFinite(addPrice) ? addPrice : 0
                    };
                })
                .filter((v) => v.name);

            return values.length
                ? [
                    {
                        optionName: "옵션",
                        values
                    }
                ]
                : [];
        }

        return rawOptions
            .map((group, groupIndex) => {
                const optionName = String(
                    group?.optionName ||
                    group?.name ||
                    group?.title ||
                    `옵션${groupIndex + 1}`
                ).trim();

                const rawValues = Array.isArray(group?.values)
                    ? group.values
                    : Array.isArray(group?.items)
                        ? group.items
                        : Array.isArray(group?.options)
                            ? group.options
                            : [];

                const values = rawValues
                    .map((value, valueIndex) => {
                        const name = String(
                            value?.name ||
                            value?.value ||
                            value?.optionValue ||
                            value?.optionName ||
                            value?.title ||
                            value?.label ||
                            `값${valueIndex + 1}`
                        ).trim();

                        const optionPrice = Number(
                            value?.price ??
                            value?.optionPrice ??
                            value?.salePrice ??
                            0
                        );

                        const addPrice = Number(
                            value?.addPrice ??
                            value?.extraPrice ??
                            (optionPrice - basePrice) ??
                            0
                        );

                        return {
                            name,
                            price: Number.isFinite(optionPrice) ? optionPrice : 0,
                            diff: Number.isFinite(addPrice) ? addPrice : 0
                        };
                    })
                    .filter((value) => value.name);

                return {
                    optionName,
                    values
                };
            })
            .filter((group) => group.optionName && group.values.length > 0);
    }

    normalizeOnestopProduct(found) {
        if (!found) return null;

        return {
            exists: true,
            no: Number(found.no),
            url: String(found.url || ""),
            finalUrl: String(found.finalUrl || found.url || ""),
            title: String(found.title || "").trim(),
            price: found.price ?? found.goodsPrice ?? null,
            priceText: (found.price ?? found.goodsPrice) != null ? String(found.price ?? found.goodsPrice) : "",
            thumbnailUrl: String(found.thumbnailUrl || found.thumbnail || ""),
            category: String(found.category || "").trim(),
            options: this.normalizeOnestopOptions(found)
        };
    }

    getProductsForRange(numbers) {
        const targetSet = new Set(numbers.map((n) => Number(n)));

        const all = this.loadOnestopProducts()
            .filter((item) => item && Number.isFinite(Number(item.no)) && targetSet.has(Number(item.no)))
            .map((item) => this.normalizeOnestopProduct(item))
            .filter(Boolean);

        return this.sortProductsByInputRange(all, numbers);
    }

    getOnestopItemByNo(no) {
        const all = this.loadOnestopProducts();
        const found = all.find((item) => Number(item?.no) === Number(no));
        if (!found) return null;

        return this.normalizeOnestopProduct(found);
    }

    async applyDecision(onestopItem, selloResult, candidates, aliPages, decision, searchKeyword) {
        const selectedAli = Array.isArray(decision?.selectedAliCandidates)
            ? decision.selectedAliCandidates.slice(0, 10)
            : [];

        const normalizedOptions = Array.isArray(onestopItem?.options) ? onestopItem.options : [];

        const baseRecord = {
            createdAt: new Date().toISOString(),
            searchKeyword,
            onestop: {
                ...onestopItem,
                options: normalizedOptions
            },
            sello: {
                rawCount: candidates?.rawCount ?? null,
                smartKeywords: selloResult?.smartKeywords || [],
                coupangKeywords: selloResult?.coupangKeywords || [],
                smartCandidate: candidates?.smartCandidate || null,
                coupangCandidate: candidates?.coupangCandidate || null
            },
            aliexpress: {
                searched: true,
                queryImage: onestopItem.thumbnailUrl || "",
                selected: selectedAli
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
        this.log(`⏭ 패스: ${onestopItem.no} / ${decision.passReasonText || decision.passReasonCode || "기타 사유"}`);
    }

    loadResumeProgress() {
        try {
            if (!fs.existsSync(this.resumeProgressPath)) {
                return null;
            }

            const raw = fs.readFileSync(this.resumeProgressPath, "utf-8").trim();
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") return null;

            return parsed;
        } catch (error) {
            this.log(`⚠️ crawl-progress.json 로드 실패: ${String(error?.message || error)}`);
            return null;
        }
    }

    saveResumeProgress(progress) {
        try {
            fs.writeFileSync(this.resumeProgressPath, JSON.stringify(progress, null, 2), "utf-8");
        } catch (error) {
            this.log(`⚠️ crawl-progress.json 저장 실패: ${String(error?.message || error)}`);
        }
    }

    createRunKey() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");

        return [
            now.getFullYear(),
            pad(now.getMonth() + 1),
            pad(now.getDate()),
            "_",
            pad(now.getHours()),
            pad(now.getMinutes()),
            pad(now.getSeconds())
        ].join("");
    }

    getTargetOrderMap(numbers) {
        const map = new Map();
        numbers.forEach((n, idx) => map.set(Number(n), idx));
        return map;
    }

    sortProductsByInputRange(products, numbers) {
        const orderMap = this.getTargetOrderMap(numbers);
        return [...products].sort((a, b) => {
            const ai = orderMap.get(Number(a.no)) ?? Number.MAX_SAFE_INTEGER;
            const bi = orderMap.get(Number(b.no)) ?? Number.MAX_SAFE_INTEGER;
            return ai - bi;
        });
    }

    compressNosForMessage(nums) {
        const sorted = [...nums]
            .map(Number)
            .filter(Number.isFinite)
            .sort((a, b) => a - b);

        if (!sorted.length) return "";

        const groups = [];
        let start = sorted[0];
        let prev = sorted[0];

        for (let i = 1; i < sorted.length; i += 1) {
            const cur = sorted[i];
            if (cur === prev + 1) {
                prev = cur;
                continue;
            }
            groups.push(start === prev ? `${start}` : `${start}~${prev}`);
            start = cur;
            prev = cur;
        }

        groups.push(start === prev ? `${start}` : `${start}~${prev}`);

        if (groups.length <= 6) return groups.join(", ");
        return `${groups.slice(0, 6).join(", ")} 외 ${groups.length - 6}구간`;
    }

    collectProcessedNosFromFiles(runKey) {
        const paths = runKey
            ? this.db.getRunPaths(runKey)
            : {
                smartstore: path.join(this.dataDir, "result_smartstore.json"),
                coupang: path.join(this.dataDir, "result_coupang.json"),
                pass: path.join(this.dataDir, "result_pass.json"),
                error: path.join(this.dataDir, "result_error.json")
            };

        const result = new Set();

        [paths.smartstore, paths.coupang, paths.pass, paths.error].forEach((filePath) => {
            try {
                if (!fs.existsSync(filePath)) return;
                const raw = fs.readFileSync(filePath, "utf-8").trim();
                if (!raw) return;
                const arr = JSON.parse(raw);
                if (!Array.isArray(arr)) return;

                arr.forEach((row) => {
                    const no = Number(row?.onestop?.no);
                    if (Number.isFinite(no) && no > 0) {
                        result.add(no);
                    }
                });
            } catch {}
        });

        return result;
    }

    getResumeState(progress, rangeText, targetNumbers) {
        const normalizedInput = this.normalizeRangeText(rangeText);
        const sortedTargets = [...targetNumbers]
            .map(Number)
            .filter(Number.isFinite)
            .sort((a, b) => a - b);

        if (!progress) {
            return {
                runKey: this.createRunKey(),
                processedNos: new Set(),
                resume: false
            };
        }

        const savedRange = this.normalizeRangeText(progress.rangeText);
        if (!savedRange || savedRange !== normalizedInput) {
            return {
                runKey: this.createRunKey(),
                processedNos: new Set(),
                resume: false
            };
        }

        const runKey = String(progress.runKey || "").trim() || this.createRunKey();

        const savedProcessedNos = Array.isArray(progress.processedNos)
            ? progress.processedNos.map(Number).filter(Number.isFinite)
            : [];

        const fileProcessedNos = Array.from(this.collectProcessedNosFromFiles(runKey));
        const merged = new Set([...savedProcessedNos, ...fileProcessedNos]);

        const validProcessed = new Set(
            [...merged].filter((no) => sortedTargets.includes(no))
        );

        return {
            runKey,
            processedNos: validProcessed,
            resume: validProcessed.size > 0
        };
    }

    saveResumeSnapshot({
                           status,
                           rangeText,
                           runKey,
                           targetNumbers,
                           processedNos,
                           currentNo = null,
                           editMode = null
                       }) {
        const processed = [...processedNos]
            .map(Number)
            .filter(Number.isFinite)
            .sort((a, b) => a - b);

        const remaining = [...targetNumbers]
            .map(Number)
            .filter((no) => Number.isFinite(no))
            .filter((no) => !processedNos.has(no));

        this.saveResumeProgress({
            status: String(status || "RUNNING"),
            rangeText: String(rangeText || ""),
            runKey: String(runKey || ""),
            totalTargetCount: targetNumbers.length,
            processedCount: processed.length,
            processedNos: processed,
            nextNo: remaining.length ? remaining[0] : null,
            currentNo: currentNo != null ? Number(currentNo) : null,
            editMode: editMode
                ? {
                    enabled: true,
                    onestopNo: Number(editMode.onestopNo),
                    updatedAt: new Date().toISOString()
                }
                : null,
            updatedAt: new Date().toISOString()
        });
    }

    buildResumeMessage(targetNumbers, processedNos, nextNo) {
        const done = [...processedNos]
            .filter((no) => targetNumbers.includes(no))
            .sort((a, b) => a - b);

        if (!done.length) return "";
        const doneText = this.compressNosForMessage(done);

        if (nextNo == null) {
            return `원스톱 상품번호 ${doneText} 완료 / 남은 작업이 없습니다.`;
        }

        return `원스톱 상품번호 ${doneText} 완료 / ${nextNo}번부터 다시 시작합니다.`;
    }

    async start({ rangeText, headless, selloCookie }) {
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

        let products = this.getProductsForRange(numbers);
        if (!products.length) {
            return { ok: false, message: "선택한 범위에 해당하는 원스톱 상품이 없습니다." };
        }

        const resumeProgress = this.loadResumeProgress();
        this.log(`ℹ️ 현재 crawl-progress: ${JSON.stringify(resumeProgress || {})}`);

        const resumeState = this.getResumeState(resumeProgress, rangeText, numbers);
        this.log(
            `ℹ️ resume 판정: ${JSON.stringify({
                runKey: resumeState.runKey,
                resume: resumeState.resume,
                processedCount: resumeState.processedNos.size
            })}`
        );

        const processedNos = new Set(resumeState.processedNos);
        products = products.filter((item) => !processedNos.has(Number(item.no)));

        if (!products.length) {
            return {
                ok: false,
                message: "이미 범위 내 모든 상품이 처리되었습니다."
            };
        }

        this.db.beginRun({ runKey: resumeState.runKey, resume: resumeState.resume });

        if (!this.aliReady) {
            return {
                ok: false,
                message: "먼저 '알리 준비 열기' → 알리에서 팝업/로그인 처리 → '알리 준비 완료'를 눌러주세요."
            };
        }

        this.running = true;
        this.stopRequested = false;
        this.currentRunKey = resumeState.runKey;
        this.currentRangeText = rangeText;
        this.currentProcessedNos = processedNos;
        this.editMode = null;

        const nextNo = products[0] ? Number(products[0].no) : null;
        this.resumeNoticeMessage = this.buildResumeMessage(numbers, processedNos, nextNo);

        this.stateStore.resetForRun({
            total: products.length,
            headless: !!headless,
            rangeText
        });

        this.stateStore.setCurrent({
            noticeMessage: this.resumeNoticeMessage,
            workflowStage: "SEARCHING",
            aliCandidates: [],
            aliCandidatePages: [],
            aliPage: 1,
            aliHasMore: true
        });
        this.emit();

        this.saveResumeSnapshot({
            status: "RUNNING",
            rangeText,
            runKey: this.currentRunKey,
            targetNumbers: numbers,
            processedNos: this.currentProcessedNos,
            currentNo: nextNo,
            editMode: null
        });

        this.log(`🚀 작업 시작 / 총 ${products.length}건`);
        this.log(`ℹ️ 원스톱 JSON 사용: ${this.onestopProductsPath}`);

        const runInfo = this.db.getCurrentRunInfo();
        if (runInfo?.runDir) {
            this.log(`ℹ️ 이번 실행 결과 저장 위치: ${runInfo.runDir}`);
        }

        this.log(
            `ℹ️ 이번 실행용 최신 결과 파일: ${path.join(this.dataDir, "result_pass.json")} / result_smartstore.json / result_coupang.json / result_error.json`
        );
        this.log(`ℹ️ resume 저장 위치: ${this.resumeProgressPath}`);
        this.log(`ℹ️ 범위 기준 상품번호 시작: ${products[0].no}`);

        if (this.resumeNoticeMessage) {
            this.log(`♻️ ${this.resumeNoticeMessage}`);
        }

        this.run(products, { selloCookie, headless: !!headless, targetNumbers: numbers }).catch((error) => {
            this.stateStore.setStatus("ERROR");
            this.saveResumeSnapshot({
                status: "ERROR",
                rangeText: this.currentRangeText,
                runKey: this.currentRunKey,
                targetNumbers: numbers,
                processedNos: this.currentProcessedNos,
                currentNo: null,
                editMode: this.editMode
            });
            this.log(`❌ ${String(error?.message || error)}`);
            this.running = false;
            this.emit();
        });

        return {
            ok: true,
            total: products.length,
            runKey: this.currentRunKey,
            resultDir: runInfo?.runDir || "",
            resumeMessage: this.resumeNoticeMessage
        };
    }

    async startEditItem({ onestopNo, headless, selloCookie }) {
        if (this.running) {
            return { ok: false, message: "현재 작업 중입니다. 먼저 중지 후 수정 모드를 실행하세요." };
        }

        if (!selloCookie || !String(selloCookie).trim()) {
            return { ok: false, message: "셀록 Cookie가 필요합니다." };
        }

        const resumeProgress = this.loadResumeProgress();
        const runKey = String(resumeProgress?.runKey || "").trim() || this.createRunKey();
        const rangeText = String(resumeProgress?.rangeText || "");
        const targetNumbers = parseRangeText(rangeText);

        const onestopItem = this.getOnestopItemByNo(onestopNo);
        if (!onestopItem) {
            return { ok: false, message: `${onestopNo}번 상품을 찾을 수 없습니다.` };
        }

        this.db.beginRun({ runKey, resume: true });
        this.db.removeDecisionByOnestopNo(onestopNo);

        this.currentRunKey = runKey;
        this.currentRangeText = rangeText;
        this.currentProcessedNos = new Set(
            Array.isArray(resumeProgress?.processedNos)
                ? resumeProgress.processedNos.map(Number).filter(Number.isFinite)
                : []
        );

        this.editMode = { onestopNo: Number(onestopNo) };

        await this.ensureBrowser(!!headless);

        const sello = new SelloClient({
            cookie: selloCookie,
            logger: (msg) => this.log(msg)
        });

        this.running = true;
        this.stopRequested = false;

        this.stateStore.resetForRun({
            total: 1,
            headless: !!headless,
            rangeText: `${onestopNo}(edit)`
        });

        this.log(`✏️ 수정 모드 시작: ${onestopNo}번`);
        this.saveResumeSnapshot({
            status: "EDITING",
            rangeText: this.currentRangeText,
            runKey: this.currentRunKey,
            targetNumbers,
            processedNos: this.currentProcessedNos,
            currentNo: onestopNo,
            editMode: this.editMode
        });

        try {
            await this.processSingleItem(onestopItem, sello, targetNumbers, true);
            this.stateStore.setStatus("DONE");
            this.log(`✅ 수정 모드 완료: ${onestopNo}번`);
        } catch (error) {
            this.stateStore.setStatus("ERROR");
            this.log(`❌ 수정 모드 오류(${onestopNo}): ${String(error?.message || error)}`);
        } finally {
            this.running = false;
            this.editMode = null;
            this.saveResumeSnapshot({
                status: "STOPPED",
                rangeText: this.currentRangeText,
                runKey: this.currentRunKey,
                targetNumbers,
                processedNos: this.currentProcessedNos,
                currentNo: null,
                editMode: null
            });
            await this.closeBrowser();
            this.emit();
        }

        return { ok: true };
    }

    async stop() {
        this.stopRequested = true;
        this.stateStore.setStatus("STOPPED");
        this.log("■ 중지 요청됨");

        const targetNumbers = parseRangeText(this.currentRangeText || "");
        this.saveResumeSnapshot({
            status: "STOPPED",
            rangeText: this.currentRangeText,
            runKey: this.currentRunKey,
            targetNumbers,
            processedNos: this.currentProcessedNos,
            currentNo: null,
            editMode: this.editMode
        });

        if (this.decisionResolver) {
            this.decisionResolver({
                action: "pass",
                passReasonCode: "manual_stop",
                passReasonText: "사용자 중지",
                selectedAliCandidates: []
            });
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
        const selectedAliCandidates = Array.isArray(payload?.selectedAliCandidates)
            ? payload.selectedAliCandidates.slice(0, 10)
            : [];

        if (action === "retry" && !searchKeyword) {
            return { ok: false, message: "재검색 키워드가 비어 있습니다." };
        }

        if (action === "pass" && !passReasonCode) {
            return { ok: false, message: "패스 사유 코드가 비어 있습니다." };
        }

        const resolver = this.decisionResolver;
        this.decisionResolver = null;
        resolver({
            action,
            searchKeyword,
            passReasonCode,
            passReasonText,
            selectedAliCandidates
        });

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

    async waitForKeywordFix(onestopItem, currentKeyword, noticeMessage, aliPages = []) {
        this.stateStore.setCurrent({
            onestop: onestopItem,
            searchKeyword: currentKeyword,
            smartCandidate: null,
            coupangCandidate: null,
            aliCandidates: Array.isArray(aliPages[0]) ? aliPages[0] : [],
            aliCandidatePages: aliPages,
            aliPage: 1,
            aliHasMore: true,
            workflowStage: "KEYWORD_FIX",
            noticeMessage: this.resumeNoticeMessage || noticeMessage,
            isAliLoading: false,
            aliLoadingText: "",
            isReviewLoading: false,
            reviewLoadingText: ""
        });
        this.emit();

        this.log(noticeMessage);
        return this.waitForDecision(currentKeyword);
    }

    async waitForReview(onestopItem, currentKeyword, candidates, aliPages = [], noticeMessage = "") {
        this.stateStore.setCurrent({
            onestop: onestopItem,
            searchKeyword: currentKeyword,
            smartCandidate: candidates?.smartCandidate || null,
            coupangCandidate: candidates?.coupangCandidate || null,
            aliCandidates: Array.isArray(aliPages[0]) ? aliPages[0] : [],
            aliCandidatePages: aliPages,
            aliPage: 1,
            aliHasMore: true,
            workflowStage: "REVIEW",
            noticeMessage: this.resumeNoticeMessage || noticeMessage,
            isAliLoading: false,
            aliLoadingText: "",
            isReviewLoading: false,
            reviewLoadingText: ""
        });
        this.emit();

        this.log("⏸ 알리/스마트스토어/쿠팡 통합 검토 대기중");
        return this.waitForDecision(currentKeyword);
    }

    async processSingleItem(onestopItem, sello, targetNumbers, isEditMode = false) {
        this.stateStore.setCurrent({
            onestop: onestopItem,
            searchKeyword: "",
            smartCandidate: null,
            coupangCandidate: null,
            aliCandidates: [],
            aliCandidatePages: [],
            aliPage: 1,
            aliHasMore: true,
            workflowStage: "SEARCHING",
            noticeMessage: isEditMode ? `${onestopItem.no}번 수정 모드` : (this.resumeNoticeMessage || ""),
            isAliLoading: false,
            aliLoadingText: "",
            isReviewLoading: false,
            reviewLoadingText: ""
        });
        this.emit();

        this.log(`- 원스톱(JSON) 조회: no=${onestopItem.no} / ${onestopItem.title}`);

        let activeKeyword = this.buildSearchKeyword(onestopItem);

        this.stateStore.setCurrent({
            onestop: onestopItem,
            searchKeyword: activeKeyword,
            workflowStage: "SEARCHING",
            noticeMessage: isEditMode ? `${onestopItem.no}번 수정 모드` : (this.resumeNoticeMessage || ""),
            isAliLoading: !!onestopItem.thumbnailUrl,
            aliLoadingText: onestopItem.thumbnailUrl ? "알리 이미지 후보를 불러오는 중입니다..." : "",
            isReviewLoading: false,
            reviewLoadingText: ""
        });
        this.emit();

        let aliPages = [];
        let choiceImages = [];

        if (onestopItem.thumbnailUrl) {
            try {
                this.log(`- 알리 이미지 검색: no=${onestopItem.no}`);
                const ali = await this.aliClient.searchByImage({
                    imageUrl: onestopItem.thumbnailUrl,
                    itemNo: onestopItem.no,
                    maxItemsPerPage: 36
                });
                aliPages = Array.isArray(ali?.pages) ? ali.pages : [];
                choiceImages = Array.isArray(ali?.choiceImages) ? ali.choiceImages : [];
            } catch (error) {
                aliPages = [];
                choiceImages = [];
                this.log(`⚠️ 알리 이미지 검색 실패(${onestopItem.no}): ${String(error?.message || error)}`);
            }
        } else {
            this.log(`⚠️ 알리 이미지 검색 스킵(${onestopItem.no}): 원스톱 썸네일 없음`);
        }

        const aliTotal = aliPages.reduce((acc, page) => acc + (Array.isArray(page) ? page.length : 0), 0);
        this.log(`ℹ️ 알리 후보 총 수: ${aliTotal}`);

        this.stateStore.setCurrent({
            isAliLoading: false,
            aliLoadingText: "",
            isReviewLoading: true,
            aliChoiceImages: choiceImages,
            reviewLoadingText: activeKeyword
                ? `셀록홈즈 후보를 불러오는 중입니다... (${activeKeyword})`
                : "셀록홈즈 후보를 불러오는 중입니다..."
        });
        this.emit();

        while (true) {
            this.log(`- 셀록 검색: ${activeKeyword}`);
            const selloResult = await sello.searchAll(activeKeyword);
            const candidates = splitCandidates(selloResult.searchJson);

            this.log(
                `ℹ️ 후보 추출 완료 / rawCount=${candidates.rawCount} / smart=${candidates.smartCandidate?.title || "-"} / coupang=${candidates.coupangCandidate?.title || "-"}`
            );

            if (candidates.rawCount === 0) {
                const decision = await this.waitForKeywordFix(
                    onestopItem,
                    activeKeyword,
                    "검색 결과가 없습니다. 검색어를 수정한 뒤 재검색하거나 패스하세요.",
                    aliPages
                );

                if (decision.action === "retry") {
                    activeKeyword = decision.searchKeyword;
                    continue;
                }

                await this.applyDecision(
                    onestopItem,
                    { smartKeywords: [], coupangKeywords: [], searchJson: null },
                    { smartCandidate: null, coupangCandidate: null, rawCount: 0 },
                    aliPages,
                    decision,
                    activeKeyword
                );
                break;
            }

            const reviewNotice = aliTotal > 0
                ? "알리 후보를 먼저 일부만 보여줍니다. 더 필요하면 '더보기'로 현재 페이지를 추가 로딩하고, '다음 페이지'로 알리 실제 다음 페이지로 이동합니다."
                : "알리 이미지가 없습니다. 스마트스토어/쿠팡 후보를 확인하거나 패스를 저장하세요.";

            const decision = await this.waitForReview(
                onestopItem,
                activeKeyword,
                candidates,
                aliPages,
                reviewNotice
            );

            if (decision.action === "retry") {
                activeKeyword = decision.searchKeyword;
                this.stateStore.setCurrent({
                    onestop: onestopItem,
                    searchKeyword: activeKeyword,
                    smartCandidate: null,
                    coupangCandidate: null,
                    aliCandidates: Array.isArray(aliPages[0]) ? aliPages[0] : [],
                    aliCandidatePages: aliPages,
                    aliPage: 1,
                    aliHasMore: true,
                    workflowStage: "SEARCHING",
                    noticeMessage: isEditMode ? `${onestopItem.no}번 수정 모드` : (this.resumeNoticeMessage || ""),
                    isAliLoading: false,
                    aliLoadingText: "",
                    isReviewLoading: true,
                    reviewLoadingText: activeKeyword
                        ? `셀록홈즈 후보를 불러오는 중입니다... (${activeKeyword})`
                        : "셀록홈즈 후보를 불러오는 중입니다..."
                });
                this.emit();
                continue;
            }

            await this.applyDecision(onestopItem, selloResult, candidates, aliPages, decision, activeKeyword);
            break;
        }

        this.currentProcessedNos.add(Number(onestopItem.no));

        this.saveResumeSnapshot({
            status: isEditMode ? "EDITING" : "RUNNING",
            rangeText: this.currentRangeText,
            runKey: this.currentRunKey,
            targetNumbers,
            processedNos: this.currentProcessedNos,
            currentNo: null,
            editMode: this.editMode
        });

        this.stateStore.incrementProcessed(1);
        this.emit();
    }

    async run(products, credentials) {
        await this.ensureBrowser(!!credentials.headless);

        const sello = new SelloClient({
            cookie: credentials.selloCookie,
            logger: (msg) => this.log(msg)
        });

        for (const onestopItem of products) {
            if (this.stopRequested) break;

            if (!onestopItem) continue;

            try {
                this.saveResumeSnapshot({
                    status: "RUNNING",
                    rangeText: this.currentRangeText,
                    runKey: this.currentRunKey,
                    targetNumbers: credentials.targetNumbers,
                    processedNos: this.currentProcessedNos,
                    currentNo: onestopItem.no,
                    editMode: null
                });

                await this.processSingleItem(onestopItem, sello, credentials.targetNumbers, false);
            } catch (error) {
                const errorItem = {
                    no: onestopItem.no,
                    url: onestopItem.url,
                    title: onestopItem.title,
                    error: String(error?.message || error),
                    createdAt: new Date().toISOString()
                };

                this.db.appendError(errorItem);
                this.currentProcessedNos.add(Number(onestopItem.no));
                this.stateStore.incrementCount("errors");
                this.stateStore.incrementProcessed(1);

                this.saveResumeSnapshot({
                    status: "RUNNING",
                    rangeText: this.currentRangeText,
                    runKey: this.currentRunKey,
                    targetNumbers: credentials.targetNumbers,
                    processedNos: this.currentProcessedNos,
                    currentNo: null,
                    editMode: null
                });

                this.log(`❌ 오류(${onestopItem.no}): ${errorItem.error}`);
                this.emit();
            }
        }

        if (this.stopRequested) {
            this.stateStore.setStatus("STOPPED");
            this.saveResumeSnapshot({
                status: "STOPPED",
                rangeText: this.currentRangeText,
                runKey: this.currentRunKey,
                targetNumbers: credentials.targetNumbers,
                processedNos: this.currentProcessedNos,
                currentNo: null,
                editMode: null
            });
        } else {
            this.stateStore.setStatus("DONE");
            this.saveResumeSnapshot({
                status: "DONE",
                rangeText: this.currentRangeText,
                runKey: this.currentRunKey,
                targetNumbers: credentials.targetNumbers,
                processedNos: this.currentProcessedNos,
                currentNo: null,
                editMode: null
            });
            this.log("✅ 작업 완료");
        }

        this.running = false;
        this.resumeNoticeMessage = "";
        await this.closeBrowser();
        this.emit();
    }

    async loadNextAliPage(maxItemsPerPage = 36) {
        if (!this.aliClient) {
            return {
                ok: false,
                message: "알리 클라이언트가 준비되지 않았습니다."
            };
        }

        const state = this.stateStore.getState();
        const current = state?.current || {};
        const loadedPages = Array.isArray(current.aliCandidatePages) ? current.aliCandidatePages : [];

        const next = await this.aliClient.getNextPageCandidates(maxItemsPerPage);
        if (!next?.ok) {
            return next;
        }

        const newPages = loadedPages.slice();
        newPages[next.page - 1] = Array.isArray(next.items) ? next.items : [];

        this.stateStore.setCurrent({
            aliCandidatePages: newPages,
            aliCandidates: newPages[next.page - 1] || [],
            aliChoiceImages: Array.isArray(next.choiceImages) ? next.choiceImages : (current.aliChoiceImages || []),
            aliPage: next.page,
            noticeMessage: this.resumeNoticeMessage || current.noticeMessage || ""
        });
        this.emit();

        return {
            ok: true,
            page: next.page,
            items: next.items || []
        };
    }

    async searchAliWithManualFile({ onestopNo, filePath, maxItemsPerPage = 36 }) {
        if (!this.aliReady) {
            return {
                ok: false,
                message: "먼저 알리 준비 완료를 눌러주세요."
            };
        }

        const onestopItem = this.getOnestopItemByNo(onestopNo);
        if (!onestopItem) {
            return {
                ok: false,
                message: `${onestopNo}번 원스톱 상품을 찾지 못했습니다.`
            };
        }

        try {
            const result = await this.aliClient.searchByLocalImageFile({
                filePath,
                itemNo: onestopNo,
                maxItemsPerPage
            });

            const state = this.stateStore.getState();
            const current = state?.current || {};

            this.stateStore.setCurrent({
                onestop: onestopItem,
                searchKeyword: current.searchKeyword || this.buildSearchKeyword(onestopItem),
                aliCandidates: Array.isArray(result?.pages?.[0]) ? result.pages[0] : [],
                aliCandidatePages: Array.isArray(result?.pages) ? result.pages : [],
                aliChoiceImages: Array.isArray(result?.choiceImages) ? result.choiceImages : [],
                aliPage: 1,
                workflowStage: current.workflowStage || "REVIEW",
                noticeMessage: "직접 업로드한 이미지로 알리 재검색을 완료했습니다.",
                isAliLoading: false,
                aliLoadingText: "",
                isReviewLoading: false,
                reviewLoadingText: ""
            });
            this.emit();

            return {
                ok: true,
                count: result?.candidates?.length || 0
            };
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    }

    async selectAliChoiceImage({ index, onestopNo, maxItemsPerPage = 36 }) {
        if (!this.aliReady) {
            return {
                ok: false,
                message: "먼저 알리 준비 완료를 눌러주세요."
            };
        }

        if (!Number.isFinite(index) || index < 0) {
            return {
                ok: false,
                message: "유효한 상품 선택 인덱스가 아닙니다."
            };
        }

        const onestopItem = this.getOnestopItemByNo(onestopNo);
        if (!onestopItem) {
            return {
                ok: false,
                message: `${onestopNo}번 원스톱 상품을 찾지 못했습니다.`
            };
        }

        try {
            const result = await this.aliClient.selectChoiceImageAndCollect(index, maxItemsPerPage);

            const state = this.stateStore.getState();
            const current = state?.current || {};

            this.stateStore.setCurrent({
                onestop: onestopItem,
                searchKeyword: current.searchKeyword || this.buildSearchKeyword(onestopItem),
                aliCandidates: Array.isArray(result?.pages?.[0]) ? result.pages[0] : [],
                aliCandidatePages: Array.isArray(result?.pages) ? result.pages : [],
                aliChoiceImages: Array.isArray(result?.choiceImages) ? result.choiceImages : [],
                aliPage: 1,
                workflowStage: current.workflowStage || "REVIEW",
                noticeMessage: "알리 상품 선택 이미지를 기준으로 다시 검색했습니다.",
                isAliLoading: false,
                aliLoadingText: "",
                isReviewLoading: false,
                reviewLoadingText: ""
            });
            this.emit();

            return {
                ok: true,
                count: result?.candidates?.length || 0
            };
        } catch (error) {
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    }

    // async loadNextAliPage(maxItemsPerPage = 36) {
    //     if (!this.aliClient) {
    //         return {
    //             ok: false,
    //             message: "알리 클라이언트가 준비되지 않았습니다."
    //         };
    //     }
    //
    //     const state = this.stateStore.getState();
    //     const current = state?.current || {};
    //     const loadedPages = Array.isArray(current.aliCandidatePages) ? current.aliCandidatePages : [];
    //
    //     this.stateStore.setCurrent({
    //         isAliLoading: true,
    //         aliLoadingText: "알리 다음 페이지를 불러오는 중입니다..."
    //     });
    //     this.emit();
    //
    //     const next = await this.aliClient.getNextPageCandidates(maxItemsPerPage);
    //
    //     this.stateStore.setCurrent({
    //         isAliLoading: false,
    //         aliLoadingText: ""
    //     });
    //
    //     if (!next?.ok) {
    //         this.emit();
    //         return next;
    //     }
    //
    //     const newPages = loadedPages.slice();
    //     newPages[next.page - 1] = Array.isArray(next.items) ? next.items : [];
    //
    //     this.stateStore.setCurrent({
    //         aliCandidatePages: newPages,
    //         aliCandidates: newPages[next.page - 1] || [],
    //         aliPage: next.page,
    //         aliHasMore: true,
    //         noticeMessage: this.resumeNoticeMessage || current.noticeMessage || ""
    //     });
    //     this.emit();
    //
    //     return {
    //         ok: true,
    //         page: next.page,
    //         items: next.items || []
    //     };
    // }

    async loadMoreAliInCurrentPage({ maxItemsPerBatch = 36 } = {}) {
        if (!this.aliClient) {
            return {
                ok: false,
                message: "알리 클라이언트가 준비되지 않았습니다."
            };
        }

        const state = this.stateStore.getState();
        const current = state?.current || {};
        const currentPageNo = Number(current.aliPage || 1);
        const loadedPages = Array.isArray(current.aliCandidatePages) ? current.aliCandidatePages.slice() : [];
        const pageIndex = Math.max(0, currentPageNo - 1);
        const currentItems = Array.isArray(loadedPages[pageIndex]) ? loadedPages[pageIndex] : [];

        this.stateStore.setCurrent({
            isAliLoading: true,
            aliLoadingText: "알리 현재 페이지를 더 불러오는 중입니다..."
        });
        this.emit();

        const more = await this.aliClient.loadMoreOnCurrentPage({
            alreadyItems: currentItems,
            maxItemsPerBatch
        });

        this.stateStore.setCurrent({
            isAliLoading: false,
            aliLoadingText: ""
        });

        if (!more?.ok) {
            this.emit();
            return more;
        }

        loadedPages[pageIndex] = Array.isArray(more.items) ? more.items : currentItems;

        this.stateStore.setCurrent({
            aliCandidatePages: loadedPages,
            aliCandidates: loadedPages[pageIndex] || [],
            aliPage: currentPageNo,
            aliHasMore: !!more.hasMore,
            noticeMessage: more.addedCount > 0
                ? `알리 현재 페이지에서 ${more.addedCount}건 추가로 불러왔습니다.`
                : "더 이상 새로 불러올 알리 이미지가 없습니다."
        });
        this.emit();

        return {
            ok: true,
            page: currentPageNo,
            items: loadedPages[pageIndex] || [],
            addedCount: Number(more.addedCount || 0),
            hasMore: !!more.hasMore
        };
    }

    async openAliPrepare(headless = false) {
        await this.ensureBrowser(!!headless);

        const result = await this.aliClient.openPreparePage();
        this.aliReady = false;

        this.log("🪟 알리 준비 창을 열었습니다. 팝업 닫기/로그인/이미지검색 업로드창 준비 후 '알리 준비 완료'를 눌러주세요.");
        return {
            ok: true,
            url: result?.url || ""
        };
    }

    async confirmAliReady() {
        if (!this.aliClient) {
            return {
                ok: false,
                message: "먼저 '알리 준비 열기'를 눌러주세요."
            };
        }

        try {
            const result = await this.aliClient.confirmManualReady();
            this.aliReady = true;
            this.log("✅ 알리 준비 완료 상태로 저장했습니다.");
            return {
                ok: true,
                url: result?.url || ""
            };
        } catch (error) {
            this.aliReady = false;
            return {
                ok: false,
                message: String(error?.message || error)
            };
        }
    }

    // async searchAliWithManualFile({ onestopNo, filePath, maxItemsPerPage = 36 }) {
    //     if (!this.aliReady) {
    //         return {
    //             ok: false,
    //             message: "먼저 알리 준비 완료를 눌러주세요."
    //         };
    //     }
    //
    //     const onestopItem = this.getOnestopItemByNo(onestopNo);
    //     if (!onestopItem) {
    //         return {
    //             ok: false,
    //             message: `${onestopNo}번 원스톱 상품을 찾지 못했습니다.`
    //         };
    //     }
    //
    //     try {
    //         const result = await this.aliClient.searchByLocalImageFile({
    //             filePath,
    //             itemNo: onestopNo,
    //             maxItemsPerPage
    //         });
    //
    //         const state = this.stateStore.getState();
    //         const current = state?.current || {};
    //
    //         this.stateStore.setCurrent({
    //             onestop: onestopItem,
    //             searchKeyword: current.searchKeyword || this.buildSearchKeyword(onestopItem),
    //             aliCandidates: Array.isArray(result?.pages?.[0]) ? result.pages[0] : [],
    //             aliCandidatePages: Array.isArray(result?.pages) ? result.pages : [],
    //             aliPage: 1,
    //             aliHasMore: true,
    //             workflowStage: current.workflowStage || "REVIEW",
    //             noticeMessage: "직접 업로드한 이미지로 알리 재검색을 완료했습니다.",
    //             isAliLoading: false,
    //             aliLoadingText: "",
    //             isReviewLoading: false,
    //             reviewLoadingText: ""
    //         });
    //         this.emit();
    //
    //         this.log(`✅ 알리 수동 이미지 재검색 완료: no=${onestopNo} / count=${result?.candidates?.length || 0}`);
    //
    //         return {
    //             ok: true,
    //             count: result?.candidates?.length || 0
    //         };
    //     } catch (error) {
    //         return {
    //             ok: false,
    //             message: String(error?.message || error)
    //         };
    //     }
    // }
}

module.exports = { JobManager };
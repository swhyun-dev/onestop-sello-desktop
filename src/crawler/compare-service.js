// src/crawler/compare-service.js
function stripHtml(text) {
    return String(text || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function toPriceText(value) {
    if (value === null || value === undefined || value === "") return "";
    return `${String(value)}원`;
}

function normalizeLink(link) {
    return String(link || "").trim();
}

function isNaverMall(item) {
    const link = normalizeLink(item?.link);
    const mallName = String(item?.mallName || "");

    return (
        link.includes("smartstore.naver.com") ||
        link.includes("shopping.naver.com") ||
        link.includes("brand.naver.com") ||
        mallName.includes("스마트스토어") ||
        mallName.includes("네이버")
    );
}

function isCoupangMall(item) {
    const link = normalizeLink(item?.link);
    const mallName = String(item?.mallName || "");

    return link.includes("coupang.com") || mallName.includes("쿠팡");
}

function mapCandidate(item) {
    if (!item) return null;

    const category = [item.category1, item.category2, item.category3, item.category4]
        .filter(Boolean)
        .join(" / ");

    return {
        title: stripHtml(item.title),
        image: item.image || "",
        link: item.link || "",
        mallName: item.mallName || "",
        price: Number(item.lprice || 0),
        priceText: toPriceText(item.lprice || 0),
        category,
        productId: item.productId || "",
        productType: item.productType || ""
    };
}

function splitCandidates(searchJson) {
    const items = Array.isArray(searchJson?.keywordData?.naverShoppingProduct?.items)
        ? searchJson.keywordData.naverShoppingProduct.items
        : [];

    const mapped = items.map(mapCandidate).filter(Boolean);

    // 1순위: 명시적으로 네이버/쿠팡
    let smartCandidate = mapped.find((x) => isNaverMall(x));
    let coupangCandidate = mapped.find((x) => isCoupangMall(x));

    // 2순위 fallback
    if (!smartCandidate) {
        smartCandidate = mapped.find((x) => !isCoupangMall(x)) || mapped[0] || null;
    }

    if (!coupangCandidate) {
        coupangCandidate = mapped.find((x) => isCoupangMall(x)) || null;
    }

    return {
        smartCandidate,
        coupangCandidate,
        rawCount: mapped.length,
        topItems: mapped.slice(0, 5)
    };
}

module.exports = { splitCandidates };
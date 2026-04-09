// src/storage/exporter.js
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function buildOptionName(options) {
    if (!options || options.length === 0) return '';
    return options.map(opt => opt.optionName || '').filter(Boolean).join('\n');
}

function buildOptionValue(options) {
    if (!options || options.length === 0) return '';
    return options.map(opt =>
        (opt.values || []).map(v => v.name || '').filter(Boolean).join(',')
    ).join('\n');
}

function buildOptionPrice(options) {
    if (!options || options.length === 0) return '';
    return options.map(opt =>
        (opt.values || []).map(v => Number(v.diff || 0)).join(',')
    ).join('\n');
}

function buildDetailHtml(item) {
    const ali = item.aliexpress?.selected || [];
    const images = ali.map(v => `<img src="${v.image}" /><br/>`).join('');

    return `
<div>
    <h2>${item.onestop?.title || ''}</h2>
    ${images}
</div>
    `.trim();
}

function buildSmartstoreRows(data) {
    return data.map(item => {
        const ali = item.aliexpress?.selected || [];
        const basePrice = item.onestop?.price || 0;
        const options = item.onestop?.options || [];

        return {
            상품명: item.matched?.title || item.onestop?.title || '',
            판매가: Math.round(basePrice * 2),
            옵션명: buildOptionName(options),
            옵션값: buildOptionValue(options),
            옵션가: buildOptionPrice(options),
            대표이미지: ali[0]?.image || '',
            추가이미지: ali.slice(1).map(v => v.image).join(','),
            상세설명: buildDetailHtml(item),
            카테고리: item.matched?.category || '',
            키워드: item.sello?.smartKeywords?.join(',') || ''
        };
    });
}

function buildCoupangRows(data) {
    return data.map(item => {
        const ali = item.aliexpress?.selected || [];

        return {
            상품명: item.sello?.coupangCandidate?.title || item.onestop?.title || '',
            판매가: Math.round((item.onestop?.price || 0) * 2.2),
            대표이미지: ali[0]?.image || '',
            상세이미지: ali.map(v => v.image).join(','),
            브랜드: 'OEM',
            제조국: '중국'
        };
    });
}

function exportExcel(filePath, rows) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filePath);
}

function exportSmartstoreExcel(data, filePath) {
    const rows = buildSmartstoreRows(data);

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "상품");
    XLSX.writeFile(wb, filePath);
}

function runExport() {
    const smartPath = path.join(__dirname, '../../data/result_smartstore.json');
    const coupangPath = path.join(__dirname, '../../data/result_coupang.json');

    if (!fs.existsSync(smartPath)) {
        throw new Error(`스마트스토어 결과 파일이 없습니다: ${smartPath}`);
    }

    if (!fs.existsSync(coupangPath)) {
        throw new Error(`쿠팡 결과 파일이 없습니다: ${coupangPath}`);
    }

    const smartData = JSON.parse(fs.readFileSync(smartPath, 'utf-8'));
    const coupangData = JSON.parse(fs.readFileSync(coupangPath, 'utf-8'));

    exportExcel(
        path.join(__dirname, '../../data/export_smartstore.xlsx'),
        buildSmartstoreRows(smartData)
    );

    exportExcel(
        path.join(__dirname, '../../data/export_coupang.xlsx'),
        buildCoupangRows(coupangData)
    );

    console.log('✅ 엑셀 생성 완료');
}

module.exports = {
    runExport,
    exportSmartstoreExcel
};

if (require.main === module) {
    try {
        runExport();
    } catch (error) {
        console.error('❌ 엑셀 생성 실패');
        console.error(error.message);
        process.exit(1);
    }
}
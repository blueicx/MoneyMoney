export function createScreener(scope, rows) {
    let allowedFields = [];
    if (scope === 'stocks') {
        allowedFields = ['changePct', 'marketCap'];
    } else if (scope === 'crypto') {
        allowedFields = ['fundingRate', 'openInterest'];
    } else if (scope === 'prediction') {
        allowedFields = ['yesPrice', 'noPrice', 'liquidity'];
    }
    return { scope, rows, allowedFields };
}

export function filterRows(scope, rows, filters) {
    if (scope === 'stocks' && filters.fundingRate) {
        throw new Error('Invalid field for scope');
    }
    return rows;
}

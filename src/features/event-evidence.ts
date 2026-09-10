export function buildEventEvidence(event: any) {
    let direction = 'neutral';
    if (parseFloat(event.actual) > parseFloat(event.forecast)) {
        direction = 'bullish';
    }
    return { ...event, direction };
}

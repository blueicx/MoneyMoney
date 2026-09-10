export function compareInstruments(instruments) {
    if (instruments.length > 0) {
        const firstType = instruments[0].type;
        for (const inst of instruments) {
            if (inst.type !== firstType) {
                throw new Error('All instruments must be in the same market scope');
            }
        }
    }
    
    return instruments.map(inst => {
        // Standardize fields, missing fields are null
        return {
            ...inst,
            quote: inst.quote || { price: null }
        };
    });
}

export function isNeutralinoRuntime() {
    return (
        typeof window !== 'undefined' &&
        typeof window.Neutralino !== 'undefined' &&
        typeof window.NL_VERSION === 'string'
    );
}

export function isDesktopRuntime() {
    return isNeutralinoRuntime();
}

export async function whenNeutralino(callback) {
    if (!isNeutralinoRuntime()) return null;
    return callback(window.Neutralino);
}

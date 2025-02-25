function isValidPatterns(patterns: string): boolean {
    if (!patterns || patterns.trim() === '') {
        return false;
    }
    const patternList = patterns.split(',').map((p) => p.trim());
    return patternList.every((pattern) => pattern.length > 0);
}

export default isValidPatterns;
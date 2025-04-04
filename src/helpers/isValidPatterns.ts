function isValidURL(url: string): boolean {
    try {
        new URL(url);
        return true;
    } catch (error) {
        return false;
    }
}

function isValidPatterns(patterns: string): boolean {
    if (!patterns || patterns.trim() === '') {
        return false;
    }
    const patternList = patterns.split(',').map((p) => p.trim());
    return patternList.every((pattern) => {
        let url = pattern;

        if (!pattern.includes('http')) {
            url = `https://${pattern}`;
        }

        if (pattern.includes('*')) {
            return pattern.length;
        } else {
            return isValidURL(url);
        }
    });
}

export default isValidPatterns;
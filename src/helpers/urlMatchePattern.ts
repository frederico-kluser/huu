function normalizeUrl(url: string): string {
    let normalized = url.replace(/^(https?:)?\/\//, '');
    normalized = normalized.replace(/^www\./, '');
    return normalized;
}

function escapeRegExp(str: string): string {
    return str.replace(/[-\/\\^$+?.()|[\]{}]/g, '\\$&');
}

function patternToRegex(pattern: string): RegExp {
    const escapedParts = pattern.split('*').map(escapeRegExp);
    const regexStr = `^${escapedParts.join('.*')}$`;
    return new RegExp(regexStr);
}

function urlMatchesPattern(url: string, patterns: string): boolean {
    const normalizedUrl = normalizeUrl(url);
    const patternList = patterns.split(',').map((pattern) => normalizeUrl(pattern.trim()));
    return patternList.some((pattern) => patternToRegex(pattern).test(normalizedUrl));
}

// Exemplos de uso:
// console.log(urlMatchesPattern('https://www.youtube.com/watch?v=123', 'youtube.com/*')); // true
// console.log(urlMatchesPattern('http://api.example.com/v1/users', 'api.*.com/v1/*')); // true
// console.log(urlMatchesPattern('www.blog.example.com/post/123', '*example.com/post/*')); // true
// console.log(urlMatchesPattern('http://example.org', 'example.com, youtube.com/*')); // false

export default urlMatchesPattern;

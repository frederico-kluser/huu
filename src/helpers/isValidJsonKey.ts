const isValidJsonKey = (key: string) => {
    if (typeof key !== 'string') {
        return false;
    }
    
    // Allow empty strings as they're valid JSON keys
    if (key === '') {
        return true;
    }
    
    // Check for invalid characters in JSON key names that aren't quoted
    const invalidChars = [' ', '.', '/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    const hasInvalidChar = invalidChars.some(char => key.includes(char));
    
    if (hasInvalidChar) {
        return false;
    }
    
    try {
        const jsonKey = JSON.stringify(key);
        JSON.parse(`{${jsonKey}: null}`);
        return true;
    } catch (e) {
        return false;
    }
}

export default isValidJsonKey;
const isValidJsonKey = (key: string) => {
    if (typeof key !== 'string') {
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
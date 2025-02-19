type StoredData<T> = {
    value: T;
    expiry: number;
};

const setItem = <T>(key: string, value: T, ttl = -1): void => {
    const now = Date.now();
    const item: StoredData<T> = {
        value,
        expiry: ttl !== -1 ? now + ttl : -1,
    };
    localStorage.setItem(key, JSON.stringify(item));
};

const getItem = <T>(key: string): T | null => {
    const itemStr = localStorage.getItem(key);
    if (!itemStr) {
        return null;
    }

    try {
        const item: StoredData<T> = JSON.parse(itemStr);
        if (item.expiry !== -1 && Date.now() > item.expiry) {
            localStorage.removeItem(key);
            return null;
        }
        return item.value;
    } catch (error) {
        console.error('Error parsing localStorage data:', error);
        return null;
    }
};

const removeItem = (key: string): void => {
    localStorage.removeItem(key);
};

export { setItem, getItem, removeItem };
type StoredData<T> = {
    value: T;
    expiry: number;
};

const setItem = async <T>(key: string, value: T, ttl = -1): Promise<void> => {
    const now = Date.now();
    const item: StoredData<T> = {
        value,
        expiry: ttl !== -1 ? now + ttl : -1,
    };
    // Armazena o item convertendo para string
    await chrome.storage.local.set({ [key]: JSON.stringify(item) });
};

const getItem = async <T>(key: string): Promise<T | null> => {
    const result = await chrome.storage.local.get(key);
    const itemStr = result[key];
    if (!itemStr) {
        return null;
    }

    try {
        const item: StoredData<T> = JSON.parse(itemStr);
        // Se existir expiração e já estiver expirado, remove e retorna null
        if (item.expiry !== -1 && Date.now() > item.expiry) {
            await chrome.storage.local.remove(key);
            return null;
        }
        return item.value;
    } catch (error) {
        console.error('Error parsing chrome.storage.local data:', error);
        return null;
    }
};

const removeItem = async (key: string): Promise<void> => {
    await chrome.storage.local.remove(key);
};

export { setItem, getItem, removeItem };

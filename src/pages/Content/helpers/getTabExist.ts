const getTabExist = async (tabId: number): Promise<boolean> => {
    try {
        return await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getTabExist', tabId }, (result: boolean) => {
                resolve(result);
            });
        });
    } catch (error) {
        console.error('Erro ao obter tabId:', error);
        return false;
    }
};

export default getTabExist;
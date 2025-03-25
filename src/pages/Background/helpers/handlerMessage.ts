import { updateNavigation } from "../../../core/storage/navigation";

// No seu background script (service worker)
interface TabIdMessage {
    action: string;
    data?: any;
}

const handleMessage = () => {
    chrome.runtime.onMessage.addListener((
        message: TabIdMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: any) => void,
    ): boolean => {
        console.log('background -> message', message);

        if (message.action === 'getTabId' && sender.tab?.id) {
            sendResponse({ tabId: sender.tab.id });
        }
        if (message.action === 'navigate' && sender.tab?.id) {
            const { data } = message;

            updateNavigation({
                ...data,
                tabId: sender.tab?.id,
            });
        }
        return true; // Importante para manter a conexão aberta para respostas assíncronas
    });
};

export default handleMessage;
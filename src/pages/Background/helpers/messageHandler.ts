import { updateAgentNavigationCode } from "../../../core/storage/navigation";

// No seu background script (service worker)
interface TabIdMessage {
    action: string;
    data?: any;
}

const messageHandler = () => {
    chrome.runtime.onMessage.addListener((
        message: TabIdMessage,
        sender: chrome.runtime.MessageSender,
        sendResponse: (response?: any) => void,
    ): boolean => {
        console.log('background -> message', message);

        if (!sender.tab?.id) {
            return true;
        }

        switch (message.action) {
            case 'getTabId':
                sendResponse({ tabId: sender.tab.id });
                break;

            case 'navigate':
                const { data } = message;
                updateAgentNavigationCode({
                    ...data,
                    tabId: sender.tab.id,
                });
                break;

            default:
                // Ação não reconhecida
                break;
        }

        return true; // Importante para manter a conexão aberta para respostas assíncronas
    });
};

export default messageHandler;
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
    ): void => {
        console.log('background -> message', message);

        if (!sender.tab?.id) {
            return;
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
                    timestamp: Date.now(), // salvou tudo, porque o problema era que o set do chrome verifica o objeto, então se não fosse um novo objeto, não atualizava
                });
                break;

            default:
                // Ação não reconhecida
                break;
        }

        return; // Importante para manter a conexão aberta para respostas assíncronas
    });
};

export default messageHandler;
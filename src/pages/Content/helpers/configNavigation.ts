import { TypeNavigation } from "../../../types/agent";

const configNavigation = ({
    blockId,
    type,
    url,
}: TypeNavigation) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        var currentTabId = tabs[0].id;
        chrome.storage.local.set({
            navigation: {
                blockId,
                type,
                tabId: currentTabId,
            }
        }, () => {
            switch (type) {
                case 'forward':
                    window.history.forward();
                    break;
                case 'back':
                    window.history.back();
                    break;
                case 'refresh':
                    window.location.reload();
                    break;
                default:
                    if (url) {
                        window.location.href = url;
                    } else {
                        console.error('URL não informada');
                    }
                    break;
            };
        });
    });
};

export default configNavigation;
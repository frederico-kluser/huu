const changeWindowHandler = () => {
    // quando a janela ativa muda
    // chrome.windows.onFocusChanged.addListener((windowId) => {
    //     if (windowId === chrome.windows.WINDOW_ID_NONE) {
    //         console.log("Nenhuma janela ativa (usuário minimizou ou trocou de aplicação)");
    //     } else {
    //         console.log("Janela ativa mudou:", windowId);
    //     }
    // });

    // quando a aba é atualizada (mesmo um link passa por varios processos de atualização)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status !== "complete") return // no futuro vou permitir injeção de código em outras situações
        console.log("Aba atualizou:", {
            tabId,
            changeInfo,
            tab
        });
    });
    /*
    {
        "tabId": 1656147207,
        "changeInfo": {
            "status": "complete"
        },
        "tab": {
            "active": true,
            "audible": false,
            "autoDiscardable": true,
            "discarded": false,
            "favIconUrl": "https://www.youtube.com/s/desktop/f72bfc7f/img/logos/favicon_32x32.png",
            "frozen": false,
            "groupId": -1,
            "height": 1279,
            "highlighted": true,
            "id": 1656147207,
            "incognito": false,
            "index": 1,
            "lastAccessed": 1741011462051.818,
            "mutedInfo": {
                "muted": false
            },
            "openerTabId": 1656147163,
            "pinned": false,
            "selected": true,
            "status": "complete",
            "title": "YouTube",
            "url": "https://www.youtube.com/",
            "width": 1708,
            "windowId": 1656147162
        }
    }
    */
};

export default changeWindowHandler;
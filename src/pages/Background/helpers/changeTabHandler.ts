import agentGarbageHandler from "./agentGarbageHandler";

const changeTabHandler = () => {
    // quando a aba ativa muda
    chrome.tabs.onActivated.addListener((activeInfo) => {
        console.log("Aba ativa mudou:", activeInfo);
        /*
        {
            "tabId": 1656147163,
            "windowId": 1656147162
        }
        */
        chrome.tabs.get(activeInfo.tabId, (tab) => {
            console.log("Nova aba ativa:", tab);
        });
        /*
        {
            "active": true,
            "audible": false,
            "autoDiscardable": true,
            "discarded": false,
            "favIconUrl": "",
            "frozen": false,
            "groupId": -1,
            "height": 1279,
            "highlighted": true,
            "id": 1656147163,
            "incognito": false,
            "index": 0,
            "lastAccessed": 1741011694646.114,
            "mutedInfo": {
                "muted": false
            },
            "pinned": false,
            "selected": true,
            "status": "complete",
            "title": "Extensions",
            "url": "chrome://extensions/",
            "width": 1708,
            "windowId": 1656147162
        }
        */

        agentGarbageHandler();
    });
};

export default changeTabHandler;
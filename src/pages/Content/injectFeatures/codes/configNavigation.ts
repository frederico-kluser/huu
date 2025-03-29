import { TypeNavigation } from "../../../../types/storage";

const configNavigation = ({
    blockId,
    type,
    url,
    variables,
}: TypeNavigation) => {
    const data = {
        blockId,
        type,
        url,
        variables,
    };

    console.log("chrome.runtime.sendMessage({ action: 'navigate', data });", data);
    chrome.runtime.sendMessage({ action: 'navigate', data });
};

export default configNavigation; 
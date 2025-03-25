import { TypeNavigation } from "../../../types/agent";

const configNavigation = ({
    blockId,
    type,
    url,
}: TypeNavigation) => {
    chrome.runtime.sendMessage({ action: 'navigate', data: { blockId, type, url } });
};

export default configNavigation;
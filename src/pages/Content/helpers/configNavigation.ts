import { TypeNavigation } from "../../../types/storage";

const configNavigation = ({
    blockId,
    type,
    url,
}: TypeNavigation) => {
    chrome.runtime.sendMessage({ action: 'navigate', data: { blockId, type, url } });
};

export default configNavigation;
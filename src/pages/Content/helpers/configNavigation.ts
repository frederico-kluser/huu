import { TypeNavigation } from "../../../types/storage";

const configNavigation = ({
    blockId,
    type,
    url,
    variables,
}: TypeNavigation) => {
    chrome.runtime.sendMessage({ action: 'navigate', data: { blockId, type, url, variables } });
};

export default configNavigation;
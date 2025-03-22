import { getItem, removeItem, setItem } from ".";
import enums from "../../types/enums";

export const getElementSelection = async () => {
    return await getItem<{
        blockId: string;
        agentId: string;
        tabId: number;
    }>(enums.ELEMENT_SELECTION);
};

export const setElementSelection = async (blockId: string, agentId: string, tabId: number) => {
    return setItem(enums.ELEMENT_SELECTION, {
        blockId,
        agentId,
        tabId,
    });
};

export const removeElementSelection = async () => {
    return removeItem(enums.ELEMENT_SELECTION);
};
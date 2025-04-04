import { getItem, removeItem, setItem } from ".";
import enums from "../../types/enums";

export const getElementSelection = async () => {
    return await getItem<{
        blockId: string;
        agentId: string;
    }>(enums.ELEMENT_SELECTION);
};

export const setElementSelection = async (blockId: string, agentId: string) => {
    return setItem(enums.ELEMENT_SELECTION, {
        blockId,
        agentId,
    });
};

export const removeElementSelection = async () => {
    return removeItem(enums.ELEMENT_SELECTION);
};
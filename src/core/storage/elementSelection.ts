import { getItem, setItem } from ".";
import enums from "../../types/enums";

const getElementSelections = async () => {
    let allElementSelections = await getItem<{
        [key: string]: string;
    }>(enums.ELEMENT_SELECTION);

    return allElementSelections || {};
};

export const fetchEmptyElementSelectionKey = async () => {
    const allElementSelections = await getElementSelections();

    for (const [key, value] of Object.entries(allElementSelections)) {
        if (!value) {
            return key;
        }
    }

    return null;
};

export const getElementSelection = async (blockId: string) => {
    let allElementSelections = await getElementSelections();

    return allElementSelections[blockId] || null;
};

export const addElementSelection = async (blockId: string, value: string) => {
    let allElementSelections = await getElementSelections();

    return setItem(enums.ELEMENT_SELECTION, {
        ...allElementSelections,
        [blockId]: value,
    });
};

export const addNewElementSelection = async (blockId: string) => {
    return addElementSelection(blockId, '');
};
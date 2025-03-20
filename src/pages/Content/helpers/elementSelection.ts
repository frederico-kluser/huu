import createUniqueElementSelector from "../../../core/createUniqueElementSelector";
import setupElementInspector from "../../../core/setupElementInspector";
import { addElementSelection, fetchEmptyElementSelectionKey } from "../../../core/storage/elementSelection";
import enums from "../../../types/enums";

const elementSelection = async (changes: {
    [key: string]: chrome.storage.StorageChange;
}) => {
    if (!changes[enums.ELEMENT_SELECTION]?.newValue) return;

    const blockId = await fetchEmptyElementSelectionKey();

    if (!blockId) return;

    setupElementInspector().then((elementInspector) => {
        addElementSelection(blockId, elementInspector ? createUniqueElementSelector(elementInspector) : enums.ELEMENT_NOT_SELECTED);
    });
};

export default elementSelection;
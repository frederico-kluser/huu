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

    const elementInspector = await setupElementInspector();
    await addElementSelection(blockId, elementInspector ? createUniqueElementSelector(elementInspector) : enums.ELEMENT_NOT_SELECTED);

    window.alert('Elemento selecionado com sucesso!, clique na extensão para continuar a configuração.');
};

export default elementSelection;
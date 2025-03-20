import setupElementInspector from "../../../core/setupElementInspector";
import { getElementSelection } from "../../../core/storage/elementSelection";
import enums from "../../../types/enums";

const elementSelection = async (changes: {
    [key: string]: chrome.storage.StorageChange;
}) => {
    if (!changes[enums.ELEMENT_SELECTION]?.newValue) return;

    const result = await getElementSelection();

    if (!result) return;

    const {
        blockId,
        agentId,
    } = result;

    const elementInspector = await setupElementInspector();

    // elementInspector ? createUniqueElementSelector(elementInspector) : enums.ELEMENT_NOT_SELECTED

    window.alert('Elemento selecionado com sucesso!, clique na extensão para continuar a configuração.');
};

export default elementSelection;
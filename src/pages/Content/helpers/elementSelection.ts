import { getBlockSelectHTMLElement } from "../../../blockly/blocks/1-category_html-elements/blocks/BlockSelectHTMLElement";
import createUniqueElementSelector from "../../../core/createUniqueElementSelector";
import replaceBlockById from "../../../core/replaceBlockId";
import setupElementInspector from "../../../core/setupElementInspector";
import { fetchAgentById, updateAgentPartial } from "../../../core/storage/agents";
import { getElementSelection, removeElementSelection } from "../../../core/storage/elementSelection";
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

    const element = await setupElementInspector();

    const elementInspector = element ? createUniqueElementSelector(element) : enums.ELEMENT_NOT_SELECTED

    if (elementInspector === enums.ELEMENT_NOT_SELECTED) {
        window.alert('Elemento não selecionado, clique na extensão para continuar a configuração.');
        return;
    }

    const agent = await fetchAgentById(agentId);

    if (!agent) {
        window.alert('Agente não encontrado, vamos trabalhar nisso!');
        return;
    }

    await removeElementSelection(); // this need run before updateAgentPartial to avoid infinite loop
    await updateAgentPartial(agentId, {
        blocks: replaceBlockById(agent.blocks, blockId, getBlockSelectHTMLElement('css', elementInspector)),
        code: '', // Limpa o código para forçar a recompilação
    });

    window.alert('Elemento selecionado com sucesso!, clique na extensão para continuar a configuração.');
};

export default elementSelection;
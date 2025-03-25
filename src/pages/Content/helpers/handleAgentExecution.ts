import executeCode from "../../../core/executeCode";
import { fetchAgentByNavigationBlockId } from "../../../core/storage/agents";
import { fetchAgentNavigationCode } from "../../../core/storage/navigation";
import generateCodeFromBlocks from "../../../helpers/generateCodeFormBlocks";
import getTabId from "./getTabId";

const handleAgentExecution = async () => {
    fetchAgentNavigationCode().then(async (data) => {
        if (!data) {
            return;
        }

        console.log('fetchNavigation - data', data);

        const tabId = await getTabId();

        if (data.tabId !== tabId) {
            console.log(`fetchNavigation - diferente tabId: ${tabId} != ${data.tabId}`);
            return;
        }

        const agent = await fetchAgentByNavigationBlockId(data.blockId);

        if (!agent) {
            console.log('fetchAgentByNavigationBlockId - agent não encontrado');
            return;
        }

        console.log('fetchAgentByNavigationBlockId - agent', agent);

        const blocks = agent.navigation[data.blockId];

        if (!blocks) {
            console.log('fetchAgentByNavigationBlockId - blocks não encontrado');
            return;
        }


        const code = generateCodeFromBlocks(blocks);

        console.log('generateCodeFromBlocks - code', code);
        executeCode(code);
    });
};

export default handleAgentExecution;
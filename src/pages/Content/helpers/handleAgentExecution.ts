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

        const code = agent.navigation[data.blockId];

        if (!code) {
            console.log('fetchAgentByNavigationBlockId - code não encontrado');
            return;
        }

        console.log('fetchAgentByNavigationBlockId - code', code);
        executeCode(code);
    });
};

export default handleAgentExecution;
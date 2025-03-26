import executeCode from "../../../core/executeCode";
import { fetchAgentByNavigationBlockId } from "../../../core/storage/agents";
import { clearNavigationAgent, fetchAgentNavigationCode } from "../../../core/storage/navigation";
import injectStringCodeVariables from "../../../helpers/injectVariables";
import getTabId from "./getTabId";

const handleAgentExecution = async () => {
    fetchAgentNavigationCode().then(async (data) => {
        if (!data) {
            return;
        }

        console.log('fetchNavigation - data', data);

        const tabId = await getTabId();

        // Solução caso tenhamos problemas com novas tabs: && data.type !== 'navigate-block-none'
        // caso precise aceitar diferentes tabs, terei que mudar a tab default para a nova tab e fechar a tab antiga TALVEZ
        if (data.tabId !== tabId && data.type !== 'navigate-block-none') {
            console.log(`fetchNavigation - diferente tabId: ${tabId} != ${data.tabId}`);
            return;
        }

        const agent = await fetchAgentByNavigationBlockId(data.blockId);

        if (!agent) {
            console.log('fetchAgentByNavigationBlockId - agent não encontrado');
            return;
        }

        console.log('fetchAgentByNavigationBlockId - agent', agent);

        const unformattedCode = agent.navigation[data.blockId];

        const code = injectStringCodeVariables(data.variables as any, unformattedCode);

        if (!code) {
            console.log('fetchAgentByNavigationBlockId - code não encontrado');
            return;
        }

        clearNavigationAgent();
        console.log('fetchAgentByNavigationBlockId - code');
        console.log(code);

        executeCode(code);
    });
};

export default handleAgentExecution;
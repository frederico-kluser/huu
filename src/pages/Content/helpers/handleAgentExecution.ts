import { fetchAgentByNavigationBlockId } from "../../../core/storage/agents";
import { fetchAgentNavigationCode } from "../../../core/storage/navigation";
import getTabId from "./getTabId";

const handleAgentExecution = async () => {
    fetchAgentNavigationCode().then(async (data) => {
        console.log('fetchNavigation - data', data);

        if (!data) {
            return;
        }

        const tabId = await getTabId();
        if (data.tabId !== tabId) {
            console.log(`fetchNavigation - diferente tabId: ${tabId} != ${data.tabId}`);
            return;
        }

        const agent = await fetchAgentByNavigationBlockId(data.blockId);

        if (!agent) {
            return;
        }

        console.log('fetchAgentByNavigationBlockId - agent', agent);
    });
};

export default handleAgentExecution;
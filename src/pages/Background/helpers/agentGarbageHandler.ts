import { clearNavigationAgent, fetchNavigationAgent } from "../../../core/storage/navigation";
import checkIfTabExists from "./checkIfTabExists";

const agentGarbageHandler = async () => {
    const agent = await fetchNavigationAgent();

    if (!agent) {
        return;
    }

    const exist = await checkIfTabExists(agent.tabId);

    if (!exist) {
        console.log('agentGarbageHandler - tabId não existe mais:', agent.tabId);
        await clearNavigationAgent();
        console.log('agentGarbageHandler - agent removido');
    } else {
        console.log('agentGarbageHandler - tabId existe:', agent
            .tabId);
    }
};

export default agentGarbageHandler;
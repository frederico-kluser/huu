import { fetchAgentById } from "../core/storageAgents";
import isValidJsonKey from "./isValidJsonKey";

const isValidAgent = (agentName: string) => {
    if (!isValidJsonKey(agentName)) {
        return false;
    }

    const agent = fetchAgentById(agentName);

    if (!agent) {
        return false;
    }

    const { blocks, urls, code } = agent;

    if (!blocks || !urls || !code) {
        return false;
    }

    return true;
};

export default isValidAgent;
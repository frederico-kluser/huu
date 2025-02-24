import { getAgent } from "../core/storageAgents";
import isValidJsonKey from "./isValidJsonKey";

const isValidAgent = (agentName: string) => {
    if (!isValidJsonKey(agentName)) {
        return false;
    }

    const agent = getAgent(agentName);

    if (!agent) {
        return false;
    }

    const { blockly, urls, code } = agent;

    if (!blockly || !urls || !code) {
        return false;
    }

    return true;
};

export default isValidAgent;
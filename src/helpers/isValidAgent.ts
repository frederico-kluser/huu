import { getItem } from "../core/storage";
import TypeAgent from "../types/agent";
import isValidJsonKey from "./isValidJsonKey";

const isValidAgent = (agentName: string) => {
    if (!isValidJsonKey(agentName)) {
        return false;
    }

    const agent = getItem<TypeAgent>(agentName);

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
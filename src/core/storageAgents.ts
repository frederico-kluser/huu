import TypeAgent from "../types/agent";
import { getItem, setItem } from "./storage";

export const fetchAgentById = (agentId: string) => {
    return getItem<TypeAgent | null>(agentId);
};

export const saveOrUpdateAgent = (agentId: string, agent: TypeAgent) => {
    setItem<TypeAgent>(agentId, agent);
};

export const updateAgentPartial = (agentId: string, partial: Partial<TypeAgent>) => {
    const agent = fetchAgentById(agentId);
    if (agent) {
        saveOrUpdateAgent(agentId, {
            ...agent,
            ...partial,
        });
    } else {
        throw new Error(`Agent ${agentId} not found`);
    }
};
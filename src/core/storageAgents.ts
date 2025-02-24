import TypeAgent from "../types/agent";
import { getItem, setItem } from "./storage";

export const fetchAgentById = (agentId: string) => {
    return getItem<TypeAgent | null>(agentId);
};

export const saveOrUpdateAgent = (agentId: string, agent: TypeAgent) => {
    setItem<TypeAgent>(agentId, agent);
};
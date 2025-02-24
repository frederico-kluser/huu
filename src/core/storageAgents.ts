import TypeAgent from "../types/agent";
import { getItem, setItem } from "./storage";

export const getAgent = (agentId: string) => {
    return getItem<TypeAgent | null>(agentId);
};

export const setAgent = (agentId: string, agent: TypeAgent) => {
    setItem<TypeAgent>(agentId, agent);
};
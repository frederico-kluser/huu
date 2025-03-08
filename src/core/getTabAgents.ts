import urlMatchesPattern from "../helpers/urlMatchePattern";
import TypeAgent from "../types/agent";
import { fetchAgentById } from "./storage/agents";
import { fetchWorkspaceNames } from "./storage/workspace";

var agentToListener: string[] = [];

const getTabAgents = async (url: string): Promise<TypeAgent[]> => {
    const workspaces = await fetchWorkspaceNames();

    const agents = await Promise.all(
        workspaces.map(async (workspace) => {
            const agent = await fetchAgentById(workspace);
            return agent;
        })
    );

    const filteredAgents = agents.filter((agent) => {
        if (!agent) {
            return false;
        }

        if (!agent.urls) {
            return false;
        }

        return urlMatchesPattern(url, agent.urls);
    }) as TypeAgent[];

    agentToListener = filteredAgents.map((agent) => agent.name);

    return filteredAgents;
};

export default getTabAgents;
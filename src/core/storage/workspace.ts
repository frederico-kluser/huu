import enums from "../../types/enums";
import { getItem, setItem } from ".";

export const updateActualWorkspace = async (index: number) => {
    return setItem(enums.ACTUAL_WORKSPACE_INDEX, index);
};

export const fetchActualWorkspaceIndex = async () => {
    const workspaceIndex = await getItem<number>(enums.ACTUAL_WORKSPACE_INDEX);
    return workspaceIndex || 0;
};

export const fetchActualWorkspaceName = async () => {
    const workspaceIndex = await fetchActualWorkspaceIndex();
    const workspaceNames = await fetchWorkspaceNames();
    return workspaceNames[workspaceIndex] || "";
};

export const fetchWorkspaceNames = async () => {
    const workspaceNames = await getItem<string[]>(enums.WORKSPACE);
    return workspaceNames || [];
};

export const updateWorkspaceNames = async (names: string[]) => {
    return setItem(enums.WORKSPACE, names);
};
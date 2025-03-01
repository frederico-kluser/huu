import enums from "../types/enums";
import { getItem, setItem } from "./storage";

export const updateActualWorkspace = async (index: number) => {
    return setItem(enums.LAST_WORKSPACE_INDEX, index);
};

export const fetchActualWorkspace = async () => {
    const workspaceIndex = await getItem<number>(enums.LAST_WORKSPACE_INDEX);
    return workspaceIndex || 0;
};

export const fetchWorkspaceNames = async () => {
    const workspaceNames = await getItem<string[]>(enums.WORKSPACE);
    return workspaceNames || [];
};

export const updateWorkspaceNames = async (names: string[]) => {
    return setItem(enums.WORKSPACE, names);
};
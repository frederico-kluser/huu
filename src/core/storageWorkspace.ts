import enums from "../types/enums";
import { getItem, setItem } from "./storage";

export const updateActualWorkspace = (index: number) => {
    setItem(enums.LAST_WORKSPACE_INDEX, index);
};

export const fetchActualWorkspace = () => {
    return getItem<number>(enums.LAST_WORKSPACE_INDEX) || 0;
};

export const fetchWorkspaceNames = () => {
    return getItem<string[]>(enums.WORKSPACE) || [];
};

export const updateWorkspaceNames = (names: string[]) => {
    setItem(enums.WORKSPACE, names);
};
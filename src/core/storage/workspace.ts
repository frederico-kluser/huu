import enums from "../../types/enums";
import { getItem, setItem } from ".";

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

export const updateNavigation = async (workspaceName: string) => {
    return setItem(enums.NAVIGATION, workspaceName);
};

export const fetchNavigation = async (): Promise<string> => {
    const navigation = await getItem<string>(enums.NAVIGATION);

    if (!navigation) {
        return "";
    }

    return navigation;
};
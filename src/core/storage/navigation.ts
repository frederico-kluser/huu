import { getItem, setItem } from ".";
import enums from "../../types/enums";


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
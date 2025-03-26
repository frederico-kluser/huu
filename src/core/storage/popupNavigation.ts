import { getItem, setItem } from ".";
import enums from "../../types/enums";


export const updatePopupNavigation = async (workspaceName: string) => {
    return setItem(enums.POPUP_NAVIGATION, workspaceName);
};

export const fetchPopupNavigation = async (): Promise<string> => {
    const navigation = await getItem<string>(enums.POPUP_NAVIGATION);

    if (!navigation) {
        return "";
    }

    return navigation;
};
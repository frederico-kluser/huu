import enums from "../../types/enums";
import { TypeNavigation } from "../../types/storage";

export const updateNavigation = async (data: TypeNavigation): Promise<void> => {
    chrome.storage.local.set({
        [enums.SITE_NAVIGATION]: data
    });
};
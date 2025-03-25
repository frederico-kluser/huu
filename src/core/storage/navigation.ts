import enums from "../../types/enums";
import { TypeNavigation } from "../../types/storage";

export const updateNavigation = async (data: TypeNavigation): Promise<void> => {
    chrome.storage.local.set({
        [enums.SITE_NAVIGATION]: data
    });
};

export const fetchNavigation = async (): Promise<TypeNavigation | undefined> => {
    return new Promise((resolve) => {
        chrome.storage.local.get([enums.SITE_NAVIGATION], (result) => {
            if (result[enums.SITE_NAVIGATION]) {
                const data = result[enums.SITE_NAVIGATION] as TypeNavigation;

                resolve(data);
            } else {
                resolve(undefined);
            }
        });
    });
}
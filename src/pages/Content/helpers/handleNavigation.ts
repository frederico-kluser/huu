import { TypeNavigation } from "../../../types/storage";
import getTabId from "./getTabId";

const handleNavigation = async (navigation: TypeNavigation): Promise<void> => {
    console.log('changes[enums.SITE_NAVIGATION]?.newValue', navigation);

    if (!navigation) return;

    const { type, url, tabId } = navigation;

    const localTabId = await getTabId();

    if (tabId != localTabId) {
        console.log('TabId não corresponde, esperando a seleção do elemento na aba correta.');
        return;
    }

    switch (type) {
        case 'forward':
            window.history.forward();
            break;
        case 'back':
            window.history.back();
            break;
        case 'refresh':
            window.location.reload();
            break;
        case 'none':
            break;
        default:
            if (url) {
                window.location.href = url;
            } else {
                console.error('URL não informada');
            }
            break;
    };
};

export default handleNavigation;
import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockSetCookie from "./blocks/BlockSetCookie";
import setBlockGetCookie from "./blocks/BlockGetCookie";
import setBlockDeleteCookie from "./blocks/BlockDeleteCookie";
import setBlockLocalStorageSetItem from "./blocks/BlockLocalStorageSetItem";
import setBlockLocalStorageGetItem from "./blocks/BlockLocalStorageGetItem";
import setBlockLocalStorageRemoveItem from "./blocks/BlockLocalStorageRemoveItem";

const configCookiesStorage = (): TypeBlockly[] => {
    return [
        setBlockSetCookie(),
        setBlockGetCookie(),
        setBlockDeleteCookie(),
        setBlockLocalStorageSetItem(),
        setBlockLocalStorageGetItem(),
        setBlockLocalStorageRemoveItem()
    ];
};

export default configCookiesStorage;
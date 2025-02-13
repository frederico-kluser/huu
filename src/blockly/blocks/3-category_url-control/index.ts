import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockNavigateToUrlText from "./blocks/BlockNavigateToUrlText";
import setBlockNavigateToUrlVariable from "./blocks/BlockNavigateToUrlVariable";
import setBlockRefreshPage from "./blocks/BlockRefreshPage";

const configURLActions = (): TypeBlockly[] => {
    return [
        setBlockNavigateToUrlVariable(),
        setBlockNavigateToUrlText(),
        setBlockRefreshPage(),
    ];
};

export default configURLActions;

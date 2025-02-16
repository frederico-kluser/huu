import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockNavigateBack from "./blocks/BlockNavigateBack";
import setBlockNavigateForward from "./blocks/BlockNavigateForward";
import setBlockNavigateToUrlText from "./blocks/BlockNavigateToUrlText";
import setBlockRefreshPage from "./blocks/BlockRefreshPage";

const configURLActions = (): TypeBlockly[] => {
    return [
        setBlockNavigateToUrlText(),
        setBlockRefreshPage(),
        setBlockNavigateBack(),
        setBlockNavigateForward(),
    ];
};

export default configURLActions;

import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockNavigate from "./blocks/BlockNavigate";
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
        setBlockNavigate(),
    ];
};

export default configURLActions;

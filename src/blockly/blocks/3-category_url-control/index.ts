import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockNavigateToUrlText from "./blocks/BlockNavigateToUrlText";
import setBlockNavigateToUrlVariable from "./blocks/BlockNavigateToUrlVariable";

const configURLActions = (): TypeBlockly[] => {
    return [
        setBlockNavigateToUrlVariable(),
        setBlockNavigateToUrlText(),
    ];
};

export default configURLActions;

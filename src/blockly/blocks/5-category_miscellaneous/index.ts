import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockDelayWait from "./blocks/BlockDelayWait";
import setBlockRunJavaScript from "./blocks/BlockRunJavaScript";

const configMiscellaneousActions = (): TypeBlockly[] => {
    return [
        setBlockDelayWait(),
        setBlockRunJavaScript(),
    ];
};

export default configMiscellaneousActions;

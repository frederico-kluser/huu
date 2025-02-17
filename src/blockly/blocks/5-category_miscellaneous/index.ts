import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockAlertUser from "./blocks/BlockAlertUser";
import setBlockConfirmUser from "./blocks/BlockConfirmUser";
import setBlockDelayWait from "./blocks/BlockDelayWait";
import setBlockPromptUser from "./blocks/BlockPromptUser";
import setBlockRunJavaScript from "./blocks/BlockRunJavaScript";

const configMiscellaneousActions = (): TypeBlockly[] => {
    return [
        setBlockDelayWait(),
        setBlockRunJavaScript(),
        setBlockAlertUser(),
        setBlockConfirmUser(),
        setBlockPromptUser(),
    ];
};

export default configMiscellaneousActions;

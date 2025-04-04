import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockAlertUser from "./blocks/BlockAlertUser";
import setBlockConfirmUser from "./blocks/BlockConfirmUser";
import setBlockDelayWait from "./blocks/BlockDelayWait";
import setBlockPromptUser from "./blocks/BlockPromptUser";

const configMiscellaneousActions = (): TypeBlockly[] => {
    return [
        setBlockDelayWait(),
        setBlockAlertUser(),
        setBlockConfirmUser(),
        setBlockPromptUser(),
    ];
};

export default configMiscellaneousActions;

import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockAlertUser from "./blocks/BlockAlertUser";
import setBlockConfirmUser from "./blocks/BlockConfirmUser";
import setBlockDelayWait from "./blocks/BlockDelayWait";
import setBlockPromptUser from "./blocks/BlockPromptUser";
import setBlockSimpleFetch from "./blocks/BlockSimpleFetch";

const configMiscellaneousActions = (): TypeBlockly[] => {
    return [
        setBlockDelayWait(),
        setBlockAlertUser(),
        setBlockConfirmUser(),
        setBlockPromptUser(),
        setBlockSimpleFetch(),
    ];
};

export default configMiscellaneousActions;

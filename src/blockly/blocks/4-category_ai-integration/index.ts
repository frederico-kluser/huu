import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockAiGenerateText from "./blocks/BlockAiGenerateText";
import setBlockAiGenerateVariable from "./blocks/BlockAiGenerateVariable";

const configAiActions = (): TypeBlockly[] => {
    return [
        setBlockAiGenerateText(),
        setBlockAiGenerateVariable(),
    ];
};

export default configAiActions;

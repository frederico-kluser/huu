import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockAiConditional from "./blocks/BlockAiConditional";
import setBlockAiGenerateText from "./blocks/BlockAiGenerateText";
import setBlockAiGenerateVariable from "./blocks/BlockAiGenerateVariable";
import setBlockAiSummarizeText from "./blocks/BlockAiSummarizeText";
import setBlockAiTranslateText from "./blocks/BlockAiTranslateText";

const configAiActions = (): TypeBlockly[] => {
    return [
        setBlockAiGenerateText(),
        setBlockAiGenerateVariable(),
        setBlockAiConditional(),
        setBlockAiSummarizeText(),
        setBlockAiTranslateText()
    ];
};

export default configAiActions;

import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockAiConditional from "./blocks/BlockAiConditional";
import setBlockAiGenerateText from "./blocks/BlockAiGenerateText";
import setBlockAiSummarizeText from "./blocks/BlockAiSummarizeText";
import setBlockAiTextToSpeech from "./blocks/BlockAiTextToSpeech";
import setBlockAiTranslateText from "./blocks/BlockAiTranslateText";

const configAiActions = (): TypeBlockly[] => {
    return [
        setBlockAiGenerateText(),
        setBlockAiConditional(),
        setBlockAiSummarizeText(),
        setBlockAiTranslateText(),
        setBlockAiTextToSpeech()
    ];
};

export default configAiActions;

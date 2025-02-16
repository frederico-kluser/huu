import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockAlertUser from "./blocks/BlockAlertUser";
import setBlockGetElementInnerText from "./blocks/BlockGetElementInnerText";
import setBlockPromptUser from "./blocks/BlockPromptUser";
import setBlockScrollToElement from "./blocks/BlockScrollToElement";
import setBlockSelectHTMLElement from "./blocks/BlockSelectHTMLElement";
import setBlockWaitForElement from "./blocks/BlockWaitForElement";
import setBlockWaitForElementEndless from "./blocks/BlockWaitForElementEndless";

const configHTMLInterection = (): TypeBlockly[] => {
    return [
        setBlockSelectHTMLElement(),
        setBlockWaitForElement(),
        setBlockWaitForElementEndless(),
        setBlockGetElementInnerText(),
        setBlockScrollToElement(),
        setBlockPromptUser(),
        setBlockAlertUser(),
    ];
};

export default configHTMLInterection;

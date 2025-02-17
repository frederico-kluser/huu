import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockGetElementInnerText from "./blocks/BlockGetElementInnerText";
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
    ];
};

export default configHTMLInterection;

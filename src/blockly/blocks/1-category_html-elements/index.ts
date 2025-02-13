import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockGetElementInnerText from "./blocks/BlockGetElementInnerText";
import setBlockSelectHTMLElementCSS from "./blocks/BlockSelectHTMLElementCSS";
import setBlockSelectHTMLElementXPath from "./blocks/BlockSelectHTMLElementXPath";
import setBlockWaitForElement from "./blocks/BlockWaitForElement";

const configHTMLInterection = (): TypeBlockly[] => {
    return [
        setBlockSelectHTMLElementXPath(),
        setBlockSelectHTMLElementCSS(),
        setBlockWaitForElement(),
        setBlockGetElementInnerText(),
    ];
};

export default configHTMLInterection;

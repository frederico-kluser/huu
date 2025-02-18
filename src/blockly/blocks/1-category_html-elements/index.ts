import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockGetElementInnerText from "./blocks/BlockGetElementInnerText";
import setBlockScrollToElement from "./blocks/BlockScrollToElement";
import setBlockSelectHTMLElement from "./blocks/BlockSelectHTMLElement";
import setBlockWaitForElement from "./blocks/BlockWaitForElement";
import setBlockWaitForElementEndless from "./blocks/BlockWaitForElementEndless";

const configHTMLInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        {
            kind: 'button',
            text: 'Criar Variável HTML',
            callbackKey: 'CREATE_HTML_VARIABLE'
        },
        setBlockSelectHTMLElement(),
        setBlockWaitForElement(),
        setBlockWaitForElementEndless(),
        setBlockGetElementInnerText(),
        setBlockScrollToElement(),
    ];
};

export default configHTMLInterection;

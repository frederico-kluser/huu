import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockClearField from "./blocks/BlockClearField";
import setBlockClickHTMLElement from "./blocks/BlockClickHTMLElement";
import setBlockDblClickHTMLElement from "./blocks/BlockDblClickHTMLElement";
import setBlockGetElementInnerText from "./blocks/BlockGetElementInnerText";
import setBlockScrollToElement from "./blocks/BlockScrollToElement";
import setBlockSelectHTMLElement from "./blocks/BlockSelectHTMLElement";
import setBlockWaitForElement from "./blocks/BlockWaitForElement";
import setBlockWaitForElementEndless from "./blocks/BlockWaitForElementEndless";
import setBlockWriteTextToHTMLElement from "./blocks/BlockWriteTextToHTMLElement";

const configHTMLInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        // Criação de variável HTML
        {
            kind: 'button',
            text: 'Criar Variável HTML',
            callbackKey: 'CREATE_HTML_VARIABLE'
        },
        // Seleção e espera do elemento
        setBlockSelectHTMLElement(),
        setBlockWaitForElement(),
        setBlockWaitForElementEndless(),
        setBlockScrollToElement(),
        // Ações de clique
        setBlockClickHTMLElement(),
        setBlockDblClickHTMLElement(),
        // Manipulação de texto
        setBlockWriteTextToHTMLElement(),
        setBlockClearField(),
        setBlockGetElementInnerText(),
    ];
};

export default configHTMLInterection;

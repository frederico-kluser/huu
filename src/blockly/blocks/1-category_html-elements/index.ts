import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockClickHTMLElement from "./blocks/BlockClickHTMLElement";
import setBlockDblClickHTMLElement from "./blocks/BlockDblClickHTMLElement";
import setBlockGetElementInnerText from "./blocks/BlockGetElementInnerText";
import setBlockScrollToElement from "./blocks/BlockScrollToElement";
import setBlockSelectHTMLElement from "./blocks/BlockSelectHTMLElement";
import setBlockWaitForElement from "./blocks/BlockWaitForElement";
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
        setBlockScrollToElement(),
        // Ações de clique
        setBlockClickHTMLElement(),
        setBlockDblClickHTMLElement(),
        // Manipulação de texto
        setBlockWriteTextToHTMLElement(),
        setBlockGetElementInnerText(),
    ];
};

export default configHTMLInterection;

import BlocklyTypes from "../../config/types";
import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockGetHtmlVariable from "./blocks/BlockGetHtmlVariable";
import setBlockGetNumberVariable from "./blocks/BlockGetNumberVariable";
import setBlockGetStringVariable from "./blocks/BlockGetStringVariable";
import setBlockSetHtmlVariable from "./blocks/BlockSetHtmlVariable";
import setBlockSetNumberVariable from "./blocks/BlockSetNumberVariable";
import setBlockSetStringVariable from "./blocks/BlockSetStringVariable";

const configVariables = (): Array<TypeBlockly | TypeBlocklyButton | any> => {
    return [
        // Criação de variável HTML
        {
            kind: 'button',
            text: 'Criar Variável HTML',
            callbackKey: 'CREATE_HTML_VARIABLE'
        },
        setBlockGetHtmlVariable(),
        setBlockSetHtmlVariable(),
        setBlockGetStringVariable(),
        setBlockSetStringVariable(),
        setBlockGetNumberVariable(),
        setBlockSetNumberVariable(),
    ];
};

export default configVariables;

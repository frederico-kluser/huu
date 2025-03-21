import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import BlockDynamicElementSelector from "./BlockDynamicElementSelector";
import setBlockSetHtmlVariable from "./BlockSetHtmlVariable";

const configPageInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        // Criação de variável HTML
        {
            kind: 'button',
            text: 'Criar Variável HTML',
            callbackKey: 'CREATE_HTML_VARIABLE'
        },
        BlockDynamicElementSelector(),
        setBlockSetHtmlVariable(),
    ];
};

export default configPageInterection;

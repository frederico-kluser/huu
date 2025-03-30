import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockSetHtmlVariable from "./BlockSetHtmlVariable";

const configVariables = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        // Criação de variável HTML
        {
            kind: 'button',
            text: 'Criar Variável HTML',
            callbackKey: 'CREATE_HTML_VARIABLE'
        },
        setBlockSetHtmlVariable(),
    ];
};

export default configVariables;

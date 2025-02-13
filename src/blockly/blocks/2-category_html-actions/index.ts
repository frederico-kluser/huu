import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockClickHTMLElement from "./blocks/BlockClickHTMLElement";
import setBlockDblClickHTMLElement from "./blocks/BlockDblClickHTMLElement";
import setBlockWriteTextToHTMLElement from "./blocks/BlockWriteTextToHTMLElement";
import setBlockWriteVariableToHTMLElement from "./blocks/BlockWriteVariableToHTMLElement";

const configHTMLActions = (): TypeBlockly[] => {
    return [
        setBlockClickHTMLElement(),
        setBlockDblClickHTMLElement(),
        setBlockWriteVariableToHTMLElement(),
        setBlockWriteTextToHTMLElement(),
    ];
};

export default configHTMLActions;

import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockClickHTMLElement from "./blocks/BlockClickHTMLElement";
import setBlockDblClickHTMLElement from "./blocks/BlockDblClickHTMLElement";
import setBlockWriteTextToHTMLElement from "./blocks/BlockWriteTextToHTMLElement";

const configHTMLActions = (): TypeBlockly[] => {
    return [
        setBlockClickHTMLElement(),
        setBlockDblClickHTMLElement(),
        setBlockWriteTextToHTMLElement(),
    ];
};

export default configHTMLActions;

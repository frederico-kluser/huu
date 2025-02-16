import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockClearField from "./blocks/BlockClearField";
import setBlockClickHTMLElement from "./blocks/BlockClickHTMLElement";
import setBlockDblClickHTMLElement from "./blocks/BlockDblClickHTMLElement";
import setBlockWriteTextToHTMLElement from "./blocks/BlockWriteTextToHTMLElement";

const configHTMLActions = (): TypeBlockly[] => {
    return [
        setBlockClickHTMLElement(),
        setBlockDblClickHTMLElement(),
        setBlockWriteTextToHTMLElement(),
        setBlockClearField(),
    ];
};

export default configHTMLActions;

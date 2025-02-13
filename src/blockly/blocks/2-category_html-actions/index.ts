import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockClickHTMLElement from "./blocks/BlockClickHTMLElement";
import setBlockWriteTextToHTMLElement from "./blocks/BlockWriteTextToHTMLElement";

const configHTMLActions = (): TypeBlockly[] => {
    return [
        setBlockClickHTMLElement(),
        setBlockWriteTextToHTMLElement(),
    ];
};

export default configHTMLActions;

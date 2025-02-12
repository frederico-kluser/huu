import { TypeBlockly } from "../../helpers/blockConstructor";
import setBlockSelectHTMLElement from "./blocks/BlockSelectHTMLElement";

const configHTMLInterection = (): TypeBlockly[] => {
    return [
        setBlockSelectHTMLElement(),
    ];
};

export default configHTMLInterection;

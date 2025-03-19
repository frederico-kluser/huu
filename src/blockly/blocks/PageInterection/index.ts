import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import BlockDynamicElementSelector from "./BlockDynamicElementSelector";
import setBlockSelectHTMLElement from "./BlockSelectHTMLElement";

const configPageInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        BlockDynamicElementSelector(),
        setBlockSelectHTMLElement(),
    ];
};

export default configPageInterection;

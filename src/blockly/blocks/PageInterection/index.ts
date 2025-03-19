import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import BlockDynamicElementSelector from "./BlockDynamicElementSelector";
import setBlockSelectQueryElement from "./setBlockSelectQueryElement";

const configPageInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        BlockDynamicElementSelector(),
        setBlockSelectQueryElement(),
    ];
};

export default configPageInterection;

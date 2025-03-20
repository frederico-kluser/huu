import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import BlockDynamicElementSelector from "./BlockDynamicElementSelector";
import BlockSelectQueryElement from "./BlockSelectQueryElement";

const configPageInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        BlockDynamicElementSelector(),
        BlockSelectQueryElement(),
    ];
};

export default configPageInterection;

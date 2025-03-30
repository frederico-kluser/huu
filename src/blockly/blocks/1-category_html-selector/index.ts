import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockDynamicElementSelector from "./blocks/BlockDynamicElementSelector";
import setBlockFindElementByText from "./blocks/BlockFindElementByText";
import setBlockIfElementExists from "./blocks/BlockIfElementExists";
import setBlockSelectHTMLElement from "./blocks/BlockSelectHTMLElement";
import setBlockWaitForElement from "./blocks/BlockWaitForElement";

const configHTMLSelectors = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        // Seleção e espera do elemento
        setBlockSelectHTMLElement(),
        setBlockFindElementByText(),
        setBlockIfElementExists(),
        setBlockWaitForElement(),
        setBlockDynamicElementSelector(),
    ];
};

export default configHTMLSelectors;

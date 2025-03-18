import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockPromptText from "./setBlockPromptText";

const configPageInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        setBlockPromptText(),
    ];
};

export default configPageInterection;

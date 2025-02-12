import { TypeBlockly } from "../../helpers/blockConstructor";
import setHTMLElementSelection from "./blocks/HTMLElementSelection";

const configHTMLSelection = (): TypeBlockly[] => {
    return [
        setHTMLElementSelection(),
    ];
};

export default configHTMLSelection;

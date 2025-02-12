import { TypeBlockly } from "../../helpers/blockConstructor";
import setHTMLElementSelection from "./blocks/HTMLElementSelection";

const configHTMLInterection = (): TypeBlockly[] => {
    return [
        setHTMLElementSelection(),
    ];
};

export default configHTMLInterection;

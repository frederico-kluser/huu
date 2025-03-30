import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockClickHTMLElement from "./blocks/BlockClickHTMLElement";
import setBlockDblClickHTMLElement from "./blocks/BlockDblClickHTMLElement";
import setBlockDeleteHTMLElement from "./blocks/BlockDeleteHTMLElement";
import setBlockExtractSiteContent from "./blocks/BlockExtractSiteContent";
import setBlockGetElementInnerText from "./blocks/BlockGetElementInnerText";
import setBlockScrollToElement from "./blocks/BlockScrollToElement";
import setBlockWriteTextToHTMLElement from "./blocks/BlockWriteTextToHTMLElement";
import setBlockWriteValueToInputElement from "./blocks/BlockWriteValueToInputElement";

const configHTMLInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        setBlockClickHTMLElement(),
        setBlockWriteTextToHTMLElement(),
        setBlockWriteValueToInputElement(),
        setBlockGetElementInnerText(),
        setBlockScrollToElement(),
        setBlockDblClickHTMLElement(),
        setBlockExtractSiteContent(),
        setBlockDeleteHTMLElement(),
    ];
};

export default configHTMLInterection;

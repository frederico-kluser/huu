import { TypeBlockly, TypeBlocklyButton } from "../../helpers/blockConstructor";
import setBlockClickHTMLElement from "./blocks/BlockClickHTMLElement";
import setBlockDblClickHTMLElement from "./blocks/BlockDblClickHTMLElement";
import setBlockExtractSiteContent from "./blocks/BlockExtractSiteContent";
import setBlockGetElementInnerText from "./blocks/BlockGetElementInnerText";
import setBlockIfElementExists from "./blocks/BlockIfElementExists";
import setBlockScrollToElement from "./blocks/BlockScrollToElement";
import setBlockSelectHTMLElement from "./blocks/BlockSelectHTMLElement";
import setBlockWaitForElement from "./blocks/BlockWaitForElement";
import setBlockWriteTextToHTMLElement from "./blocks/BlockWriteTextToHTMLElement";
import setBlockWriteValueToInputElement from "./blocks/BlockWriteValueToInputElement";

const configHTMLInterection = (): Array<TypeBlockly | TypeBlocklyButton> => {
    return [
        // Seleção e espera do elemento
        setBlockSelectHTMLElement(),
        setBlockIfElementExists(),
        setBlockWaitForElement(),
        setBlockScrollToElement(),
        // Ações de clique
        setBlockClickHTMLElement(),
        setBlockDblClickHTMLElement(),
        // Manipulação de texto
        setBlockWriteTextToHTMLElement(),
        setBlockWriteValueToInputElement(),
        setBlockGetElementInnerText(),
        setBlockExtractSiteContent(),
    ];
};

export default configHTMLInterection;

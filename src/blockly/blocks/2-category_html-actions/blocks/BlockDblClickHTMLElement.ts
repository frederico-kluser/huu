import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockDblClickHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        name: 'BlockDblClickHTMLElement',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/click',
        fields: [
            {
                type: 'text',
                text: 'clicar duas vezes no elemento\n%1',
            },
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''], // TODO: definir um tipo para elemento HTML
            },
        ],
        tooltip: 'Clica duas vezes no elemento HTML armazenado na variável.',
    });
};

export default setBlockDblClickHTMLElement;

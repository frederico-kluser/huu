import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockClickHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        name: 'BlockClickHTMLElement',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/click',
        fields: [
            {
                type: 'text',
                text: 'clicar no elemento %1',
            },
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''], // TODO: definir um tipo para elemento HTML
            },
        ],
        tooltip: 'Clica no elemento HTML armazenado na variável.',
    });
};

export default setBlockClickHTMLElement;

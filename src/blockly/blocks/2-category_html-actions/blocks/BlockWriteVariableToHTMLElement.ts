import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockWriteVariableToHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        name: 'BlockWriteVariableToHTMLElement',
        helpUrl:
            'https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent',
        fields: [
            {
                type: 'text',
                text: 'escrever %1\nno elemento %2'
            },
            {
                type: 'field_variable',
                name: 'TEXT',
                variable: BlocklyTypes.textVariable,
                variableTypes: [''] // TODO: criar um tipo para texto, se necessário
            },
            {
                type: 'field_variable',
                name: 'ELEMENT',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''] // TODO: criar um tipo para elemento HTML, se necessário
            }
        ],
        tooltip:
            'Insere o texto de uma variável em um elemento HTML previamente salvo.'
    });
};

export default setBlockWriteVariableToHTMLElement;

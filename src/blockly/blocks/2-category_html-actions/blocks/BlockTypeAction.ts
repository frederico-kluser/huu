import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockTypeAction = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Variables',
        message: 'digita no element %1\no texto %2',
        name: 'BlockTypeAction',
        tooltip: 'Variável que armazena um elemento HTML.',
        fields: [
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyVariableNames.htmlElement,
                variableTypes: [BlocklyTypes.HTML_ELEMENT],
                defaultType: BlocklyTypes.HTML_ELEMENT,
            },
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyVariableNames.textVariable,
                variableTypes: [''],
            },

        ],
    });
};

export default setBlockTypeAction;

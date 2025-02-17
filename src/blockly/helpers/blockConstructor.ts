import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';
import TypeColorBlock from '../../types/blockColor';
import TypeBlocklyFields, { TypeBlocklyInputValue } from '../../types/blocklyFields';
import TypeInputBlock from '../../types/blocklyInputs';

const blockConstructorErrorHandling = (
  blockConfig: blockConstructorInterface
) => {
  if (
    blockConfig.hasOutput !== undefined &&
    blockConfig.hasNextConnection !== undefined
  ) {
    throw new Error(
      'A block cannot have output and next connection at the same time'
    );
  }

  if (
    blockConfig.hasOutput !== undefined &&
    blockConfig.hasPreviousConnection !== undefined
  ) {
    throw new Error(
      'A block cannot have output and previous connection at the same time'
    );
  }

  if (
    blockConfig.fields.filter((field) => field.type === 'text').length
  ) {
    throw new Error('A block cannot have a text field');
  }
};

type TypeConnection = string | string[] | null;

export type TypeBlockly = {
  kind: string;
  type: string;
};

interface blockConstructorInterface {
  colour: TypeColorBlock;
  fields: TypeBlocklyFields[];
  generator?: (block: any, generator: any) => string;
  hasNextConnection?: TypeConnection;
  hasOutput?: TypeConnection;
  hasPreviousConnection?: TypeConnection;
  helpUrl: string;
  inputs?: TypeInputBlock;
  message: string;
  name: string;
  tooltip: string;
}

const blockConstructor = (blockConfig: blockConstructorInterface): TypeBlockly => {
  blockConstructorErrorHandling(blockConfig);

  const {
    colour,
    fields,
    hasNextConnection,
    hasOutput,
    hasPreviousConnection,
    helpUrl,
    inputs,
    message,
    name,
    tooltip,
  } = blockConfig;

  const jsonInitExtra: {
    [key: string]: any;
  } = {};

  if (hasNextConnection !== undefined) {
    jsonInitExtra['nextStatement'] = hasNextConnection;
  }

  if (hasPreviousConnection !== undefined) {
    jsonInitExtra['previousStatement'] = hasPreviousConnection;
  }

  if (hasOutput !== undefined) {
    jsonInitExtra['output'] = hasOutput;
  }

  const message0 = message;
  let args0: any = [];

  fields.forEach((field, index) => {
    args0.push(field);
  });

  Blockly.Blocks[name] = {
    init: function () {
      this.jsonInit({
        args0,
        colour,
        helpUrl,
        message0,
        tooltip,
        ...jsonInitExtra,
      });

      fields.filter((field) => field.type === 'input_value' && !!field.shadow).forEach((field) => {
        const formattedField = field as any;

        const selectorInput = this.getInput(formattedField.name);
        if (selectorInput && !selectorInput.connection.getShadowDom()) {
          const shadowXml = document.createElement('shadow');
          shadowXml.setAttribute('type', formattedField.shadow.type);

          const fields = formattedField.shadow.fields;

          Object.keys(fields).forEach((key) => {
            const fieldXml = document.createElement('field');
            fieldXml.setAttribute('name', key);
            fieldXml.textContent = fields[key];

            shadowXml.appendChild(fieldXml);
          });

          selectorInput.connection.setShadowDom(shadowXml);
        }
      });
    },
  };

  if (blockConfig.generator) {
    javascriptGenerator.forBlock[name] = blockConfig.generator;
  } else {
    javascriptGenerator.forBlock[name] = function (block, generator) {
      return '/* Generator not implemented */';
    };
  }

  return {
    kind: 'block',
    type: name,
    ...inputs ? { inputs } : {},
  };
};

export default blockConstructor;

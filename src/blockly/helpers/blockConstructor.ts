import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';
import TypeColorBlock from '../../types/blockColor';
import TypeBlocklyFields from '../../types/blocklyFields';

// field_variable

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
    blockConfig.fields.filter((field) => field.type === 'text').length > 1
  ) {
    throw new Error('A block cannot have more than one text field');
  }

  if (
    blockConfig.fields.filter((field) => field.type === 'text').length === 0
  ) {
    throw new Error('A block must have at least one text field');
  }
};

type TypeConnection = string | string[] | null;

interface blockConstructorInterface {
  colour: TypeColorBlock;
  hasNextConnection?: TypeConnection;
  hasPreviousConnection?: TypeConnection;
  hasOutput?: TypeConnection;
  helpUrl: string;
  name: string;
  fields: TypeBlocklyFields[];
  tooltip: string;
}

const blockConstructor = (blockConfig: blockConstructorInterface) => {
  blockConstructorErrorHandling(blockConfig);

  const {
    colour,
    hasNextConnection,
    hasPreviousConnection,
    hasOutput,
    helpUrl,
    name,
    fields,
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

  let message0 = '';
  let args0: any = [];

  fields.forEach((field, index) => {
    if (field.type === 'text') {
      message0 += field.text;
    };
  });

  fields.filter((field) => field.type !== 'text').forEach((field, index) => {
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
    },
  };
  javascriptGenerator.forBlock[name] = function (block, generator) {
    return 'goiabinha';
  };

  return {
    kind: 'block',
    type: name,
  };
};

export default blockConstructor;

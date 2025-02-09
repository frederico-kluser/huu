import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';
import TypeColorBlock from '../../types/blockColor';

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
};

interface blockConstructorInterface {
  colour: TypeColorBlock;
  hasNextConnection?: string | null; // TODO: definir tipos
  hasPreviousConnection?: string | null; // TODO: definir tipos
  hasOutput?: string | null; // TODO: definir tipos
  helpUrl: string;
  name: string;
  text: string;
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
    text,
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

  Blockly.Blocks[name] = {
    init: function () {
      this.jsonInit({
        colour,
        helpUrl,
        message0: text,
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

import * as Blockly from 'blockly';
import { javascriptGenerator, Order } from 'blockly/javascript';
import TypeColorBlock from '../../types/blockColor';

interface blockConstructorInterface {
  colour: TypeColorBlock;
  hasNextConnection?: string | null; // TODO: definir tipos
  hasPreviousConnection?: string | null; // TODO: definir tipos
  helpUrl: string;
  name: string;
  text: string;
  tooltip: string;
}

const blockConstructor = ({
  colour,
  hasNextConnection,
  hasPreviousConnection,
  helpUrl,
  name,
  text,
  tooltip,
}: blockConstructorInterface) => {
  const jsonInitExtra: {
    [key: string]: any;
  } = {};

  if (hasNextConnection !== undefined) {
    jsonInitExtra['nextStatement'] = hasNextConnection;
  }

  if (hasPreviousConnection !== undefined) {
    jsonInitExtra['previousStatement'] = hasPreviousConnection;
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

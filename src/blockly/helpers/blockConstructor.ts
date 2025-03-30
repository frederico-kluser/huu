import * as Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';
import TypeColorBlock from '../types/blockColor';
import TypeBlocklyFields from '../types/blocklyFields';
import TypeInputBlock from '../types/blocklyInputs';
import TypeBlockGenerator from '../types/blockGenerator';
import BlocklyTypes from '../config/types';
import { BlocklyEvent } from '../types/blockEvent';
import { TypeBlock } from '../../types/agent';

const blockListeners: Record<string, (workspace: Blockly.Workspace, event: any) => void> = {};
const workspaceListeners: Record<string, boolean> = {};

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

export type TypeBlocklyButton = {
  kind: string;
  text: string;
  callbackKey: string;
};

export type TypeBlockly = {
  kind: string;
  type: string;
};

interface blockConstructorInterface {
  colour: TypeColorBlock;
  fields: TypeBlocklyFields[];
  generator?: TypeBlockGenerator;
  hasNextConnection?: TypeConnection;
  hasOutput?: TypeConnection;
  hasPreviousConnection?: TypeConnection;
  helpUrl: string;
  inputs?: TypeInputBlock;
  installListener?: (workspace: Blockly.Workspace, event: BlocklyEvent) => void;
  message: string;
  name: string;
  output?: BlocklyTypes;
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
    installListener,
    message,
    name,
    output,
    tooltip,
  } = blockConfig;

  const jsonInitExtra: TypeBlock = {};

  if (hasNextConnection !== undefined) {
    jsonInitExtra['nextStatement'] = hasNextConnection;
  }

  if (hasPreviousConnection !== undefined) {
    jsonInitExtra['previousStatement'] = hasPreviousConnection;
  }

  if (hasOutput !== undefined) {
    jsonInitExtra['output'] = hasOutput;
  }

  if (output) {
    jsonInitExtra['output'] = output;
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
    javascriptGenerator.forBlock[name] = blockConfig.generator as any;
  } else {
    javascriptGenerator.forBlock[name] = function (block, generator) {
      return '/* Generator not implemented */';
    };
  }

  if (installListener) {
    // Registra o listener deste tipo de bloco
    blockListeners[name] = installListener;

    // Modifica o método de inicialização do bloco
    const originalInit = Blockly.Blocks[name].init;

    Blockly.Blocks[name].init = function () {
      originalInit.call(this);

      // Adiciona um listener principal ao workspace apenas se ainda não tiver um
      if (this.workspace && !workspaceListeners[this.workspace.id]) {
        workspaceListeners[this.workspace.id] = true;

        this.workspace.addChangeListener((event: BlocklyEvent) => {
          // Verifica se este evento é para um bloco e se temos um listener para esse tipo de bloco
          if (event.blockId) {
            const block = this.workspace.getBlockById(event.blockId);
            if (block && blockListeners[block.type]) {
              blockListeners[block.type](this.workspace, event);
            }
          }
        });
      }
    };
  }

  return {
    kind: 'block',
    type: name,
    ...inputs ? { inputs } : {},
  };
};

export default blockConstructor;

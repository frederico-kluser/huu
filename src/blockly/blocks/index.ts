import blockConstructor from '../helpers/blockConstructor';

const configCustomBlocks = () => {

  return [
    blockConstructor({
      colour: 100,
      hasPreviousConnection: 'goiabinha',
      hasNextConnection: 'goiabinha',
      helpUrl: 'http://www.test.com',
      name: 'test',
      fields: [{
        type: 'text',
        text: 'test',
      }],
      tooltip: 'this is a test',
    }),
    blockConstructor({
      colour: 200,
      hasPreviousConnection: 'goiabinha',
      hasNextConnection: 'feijão',
      helpUrl: 'http://www.test.com',
      name: 'test2',
      fields: [{
        type: 'text',
        text: 'test2',
      }],
      tooltip: 'this is a test 2',
    }),
    blockConstructor({
      colour: 300,
      hasPreviousConnection: 'feijão',
      hasNextConnection: 'sorvete',
      helpUrl: 'http://www.test.com',
      name: 'test3',
      fields: [{
        type: 'text',
        text: 'test3',
      }],
      tooltip: 'this is a test 3',
    }),
    blockConstructor({
      colour: 250,
      hasOutput: 'Panela',
      helpUrl: 'http://www.test.com',
      name: 'test4',
      fields: [{
        type: 'text',
        text: 'test4',
      }],
      tooltip: 'this is a test 4',
    }),
    blockConstructor({
      colour: 1,
      hasPreviousConnection: ['goiabinha', 'feijão', 'sorvete'],
      hasNextConnection: ['goiabinha', 'feijão', 'sorvete', 'mamão'],
      helpUrl: 'http://www.test.com',
      name: 'test5',
      fields: [
        {
          type: 'text',
          text: 'var test5 = %1 \n to %2',
        },
        {
          type: 'field_variable',
          name: 'VAR',
          variable: 'testFive',
          variableTypes: [''],
        },
        {
          type: 'input_value',
          name: 'TO',
        },
      ],
      tooltip: 'this is a test 5',
    }),
    blockConstructor({
      colour: 250,
      hasPreviousConnection: 'mamão',
      hasNextConnection: 'Panela',
      helpUrl: 'http://www.test.com',
      name: 'test6',
      fields: [
        {
          type: 'text',
          text: 'drop down: %1',
        },
        {
          type: 'field_dropdown',
          name: 'DROPDOWN',
          options: [
            ['qwerty', 'qwerty'],
            ['qwerty2', 'qwerty2'],
            ['qwerty3', 'qwerty3'],
            ['qwerty4', 'qwerty4'],
          ],
        },
      ],
      tooltip: 'this is a test 6',
    }),
    blockConstructor({
      colour: 250,
      hasPreviousConnection: 'Panela',
      hasNextConnection: null,
      helpUrl: 'http://www.test.com',
      name: 'test7',
      fields: [
        {
          type: 'text',
          text: 'checkbox: %1',
        },
        {
          type: 'field_checkbox',
          name: 'CHECKBOX',
          checked: true,
        },
      ],
      tooltip: 'this is a test 7',
    }),
  ];
};

export default configCustomBlocks;

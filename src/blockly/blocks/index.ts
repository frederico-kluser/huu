import blockConstructor from '../helpers/blockConstructor';
import setStringLengthBlock from './string_length';

const configCustomBlocks = () => {
  setStringLengthBlock();

  return [
    blockConstructor({
      colour: 100,
      hasPreviousConnection: 'goiabinha',
      hasNextConnection: 'goiabinha',
      helpUrl: 'http://www.test.com',
      name: 'test',
      text: 'test',
      tooltip: 'this is a test',
    }),
    blockConstructor({
      colour: 200,
      hasPreviousConnection: 'goiabinha',
      hasNextConnection: 'feijão',
      helpUrl: 'http://www.test.com',
      name: 'test2',
      text: 'test2',
      tooltip: 'this is a test 2',
    }),
    blockConstructor({
      colour: 300,
      hasPreviousConnection: 'feijão',
      hasNextConnection: 'feijão',
      helpUrl: 'http://www.test.com',
      name: 'test3',
      text: 'test3',
      tooltip: 'this is a test 3',
    }),
    blockConstructor({
      colour: 250,
      hasOutput: 'Panela',
      helpUrl: 'http://www.test.com',
      name: 'test4',
      text: 'test4',
      tooltip: 'this is a test 4',
    }),
  ];
};

export default configCustomBlocks;

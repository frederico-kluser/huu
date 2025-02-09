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
      helpUrl: 'http://www.test2.com',
      name: 'test2',
      text: 'test2',
      tooltip: 'this is a test 2',
    }),
  ];
};

export default configCustomBlocks;

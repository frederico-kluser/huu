// setup.js
require('@testing-library/jest-dom');

// Mock para chrome APIs
global.chrome = {
  tabs: {
    query: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    sendMessage: jest.fn(),
    onUpdated: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    getURL: jest.fn()
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    },
    sync: {
      get: jest.fn(),
      set: jest.fn(),
      remove: jest.fn()
    }
  },
  windows: {
    getCurrent: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    onRemoved: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    }
  }
};

// Global mocks for Blockly
global.Blockly = {
  Blocks: {},
  JavaScript: {
    addReservedWords: jest.fn(),
    addGenerator: jest.fn()
  },
  inject: jest.fn(),
  svgResize: jest.fn(),
  Xml: {
    domToWorkspace: jest.fn(),
    workspaceToDom: jest.fn()
  },
  Events: {
    disableOrphans: jest.fn()
  },
  WidgetDiv: {
    hideIfOwner: jest.fn()
  },
  Field: class {}
};
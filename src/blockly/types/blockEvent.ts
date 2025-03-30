// Tipo para as coordenadas
type Coordinate = {
    x: number;
    y: number;
};

// Tipo base para eventos Blockly
interface BlocklyEventBase {
    workspaceId: string;
    isUiEvent: boolean;
    type: string;
    group: string;
    recordUndo: boolean;
    isBlank: boolean;
}

// Tipo específico para eventos de movimento
interface BlocklyMoveEvent extends BlocklyEventBase {
    type: 'move';
    blockId: string;
    oldCoordinate: Coordinate;
    reason: string[];
    newParentId?: string;
    newInputName?: string;
}

// Outros tipos de eventos possíveis (pode ser expandido conforme necessário)
interface BlocklyCreateEvent extends BlocklyEventBase {
    type: 'create';
    blockId: string;
    // outros campos específicos para eventos de criação
}

interface BlocklyDeleteEvent extends BlocklyEventBase {
    type: 'delete';
    blockId: string;
    // outros campos específicos para eventos de exclusão
}

interface BlocklyChangeEvent extends BlocklyEventBase {
    type: 'change';
    blockId: string;
    element: string;
    name: string;
    oldValue: any;
    newValue: any;
}

// Tipo união para todos os eventos Blockly
type BlocklyEvent =
    | BlocklyMoveEvent
    | BlocklyCreateEvent
    | BlocklyDeleteEvent
    | BlocklyChangeEvent;

// Exportar os tipos
export {
    Coordinate,
    BlocklyEventBase,
    BlocklyMoveEvent,
    BlocklyCreateEvent,
    BlocklyDeleteEvent,
    BlocklyChangeEvent,
    BlocklyEvent
};
type TypeBlocklyFieldText = {
    type: 'text';
    text: string;
}

type TypeBlocklyFieldVariable = {
    type: 'field_variable';
    name: string;
    variable: string;
    variableTypes: string[];
    dataType?: string;
};

type TypeBlocklyFieldInput = {
    type: 'field_input';
    name: string;
    text: string;
};

type TypeBlocklyFieldDropdown = {
    type: 'field_dropdown';
    name: string;
    options: [string, string][]; // [value, text]
};

type TypeBlocklyFieldCheckbox = {
    type: 'field_checkbox';
    name: string;
    checked: boolean;
};

export type TypeBlocklyInputValue = {
    type: 'input_value';
    name: string;
    check?: string | string[];
    shadow?: {
        type: 'text' | 'math_number';
        fields: {
            [key: string]: string | number;
        };
    },
};

type TypeBlocklyStatementInput = {
    type: 'input_statement';
    name: string;
};

type TypeBlocklyFields = TypeBlocklyFieldText | TypeBlocklyFieldVariable | TypeBlocklyFieldInput | TypeBlocklyFieldDropdown | TypeBlocklyFieldCheckbox | TypeBlocklyInputValue | TypeBlocklyStatementInput;

export default TypeBlocklyFields;
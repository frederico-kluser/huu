type TypeBlocklyFieldText = {
    type: 'text';
    text: string;
}

type TypeBlocklyFieldVariable = {
    type: 'field_variable';
    name: string;
    variable: string;
    variableTypes: string[];
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

type TypeBlocklyFields = TypeBlocklyFieldText | TypeBlocklyFieldVariable | TypeBlocklyFieldInput | TypeBlocklyFieldDropdown | TypeBlocklyFieldCheckbox;

export default TypeBlocklyFields;
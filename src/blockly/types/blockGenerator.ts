import { Block, CodeGenerator } from "blockly";

type TypeBlockGenerator = (block: Block, generator: CodeGenerator) => string | [string, number] | null

export default TypeBlockGenerator;
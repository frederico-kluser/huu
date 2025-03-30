interface CodeBlock {
	codeType: string;
	codeValue: string;
}

const extractCodeBlocks = (markdown: string): CodeBlock[] => {
	const regex = /```(\w+)\s*([\s\S]*?)```/g;
	const blocks: CodeBlock[] = [];
	let match;

	while ((match = regex.exec(markdown)) !== null) {
		blocks.push({
			codeType: match[1],
			codeValue: match[2].trim(),
		});
	}

	if (blocks.length === 0) {
		return [
			{
				codeType: 'unknown',
				codeValue: markdown,
			},
		];
	}

	if (blocks.length > 1) {
		// eslint-disable-next-line no-debugger
		debugger;
		// throw new Error(
		// 	'TIVEMOS UMA ALUCINAÇÃO! - Ainda não foi implementado um refatorador para mais de um bloco de código',
		// );
	}

	return blocks;
};

export default extractCodeBlocks;

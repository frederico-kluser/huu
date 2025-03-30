const validateOpenAIApiKey = async (key: string): Promise<boolean> => {
    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
        });

        return response.status === 200;
    } catch (error) {
        return false;
    }
};

export default validateOpenAIApiKey;
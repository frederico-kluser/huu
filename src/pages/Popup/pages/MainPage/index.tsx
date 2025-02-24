import React, { Dispatch, SetStateAction } from 'react';

interface MainPageProps {
    setIsMainPage: Dispatch<SetStateAction<boolean>>
}

const MainPage = ({ setIsMainPage }: MainPageProps) => {

    const handleEditModels = () => {
        setIsMainPage(false);
    };

    return (
        <>
            <h1>Hello World</h1>
            <button onClick={handleEditModels}>Editar Modelos</button>
        </>
    )
};

export default MainPage;
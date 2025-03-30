const injectNavigationFunctions = (result: any) => {
    const resultClone = JSON.parse(JSON.stringify(result));

    /*
      procedures_defnoreturn
      procedures_callnoreturn
    */
    console.log("resultClone.initial", resultClone.initial);
    console.log("resultClone.navigation", resultClone.navigation);

    Object.entries(resultClone.navigation).forEach(([key, value]: [string, any]) => {
        const cloneInitial = JSON.parse(JSON.stringify(resultClone.initial));
        cloneInitial.blocks.blocks = [value.block];
        resultClone.navigation[key] = cloneInitial;
    });

    return resultClone;
};

export default injectNavigationFunctions;
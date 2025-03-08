// Do this as the first thing so that any code reading it knows the right env.
process.env.BABEL_ENV = 'development'; // Alterado para development
process.env.NODE_ENV = 'development'; // Alterado para development
process.env.ASSET_PATH = '/';

var webpack = require('webpack'),
    path = require('path'),
    fs = require('fs'),
    config = require('../webpack.config'),
    ZipPlugin = require('zip-webpack-plugin');

delete config.chromeExtensionBoilerplate;

// Configurar para modo de desenvolvimento
config.mode = 'development';

// Adicionar source maps para melhor depuração
config.devtool = 'source-map';

// Configurar otimização para preservar nomes e facilitar depuração
config.optimization = {
    minimize: false, // Desativar a minificação
    moduleIds: 'named', // Usar nomes legíveis para módulos
    chunkIds: 'named', // Usar nomes legíveis para chunks
    mangleExports: false, // Não alterar nomes de exportações
    providedExports: true,
    usedExports: true,
    concatenateModules: false // Desativar concatenação de módulos para facilitar depuração
};

var packageInfo = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

// Adicionar sufixo ao nome do arquivo para diferenciar da versão de produção
config.plugins = (config.plugins || []).concat(
    new ZipPlugin({
        filename: `${packageInfo.name}-${packageInfo.version}-debug.zip`,
        path: path.join(__dirname, '../', 'zip'),
    })
);

// Adicionar informações de banner em todos os arquivos (opcional)
config.plugins.push(
    new webpack.BannerPlugin({
        banner: 'Debug build - Não use em produção!',
        raw: false,
        entryOnly: false
    })
);

webpack(config, (err, stats) => {
    if (err) {
        console.error('Erro fatal no webpack:', err);
        return;
    }

    const info = stats.toJson();

    if (stats.hasErrors()) {
        console.error('Erros de compilação:', info.errors);
    }

    if (stats.hasWarnings()) {
        console.warn('Avisos:', info.warnings);
    }

    console.log('Build de depuração concluído!');
    console.log(stats.toString({
        colors: true,
        modules: false,
        children: false,
        chunks: false,
        chunkModules: false,
    }));
});
module.exports = {
    env: {
        browser: true,
        commonjs: true,
        es6: true,
    },
    extends: ['airbnb-base', 'prettier'],
    globals: {
        AFRAME: 'readonly',
        ARENA: 'readonly',
        THREE: 'readonly',
        Swal: 'readonly',
    },
    plugins: ['prettier'],
    parser: '@babel/eslint-parser',
    parserOptions: {
        requireConfigFile: false,
        sourceType: 'module',
        ecmaVersion: 12,
    },
    rules: {
        'max-len': [
            'error',
            {
                code: 120,
                tabWidth: 4,
                ignoreUrls: true,
                ignoreComments: true,
                ignoreTemplateLiterals: true,
            },
        ],
        'prettier/prettier': [
            'error',
            {
                singleQuote: true,
            },
        ],
        'no-unused-vars': 'warn',
        'no-console': 'off',
        'class-methods-use-this': 'off',
        'no-plusplus': 'off',
        'no-bitwise': 'off',
        'no-underscore-dangle': 'off',
        'no-constructor-return': 'off',
        'no-param-reassign': 'warn',
    },
};

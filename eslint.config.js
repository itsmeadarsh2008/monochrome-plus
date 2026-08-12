import js from '@eslint/js';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default [
    {
        ignores: ['**/dist/**', '**/node_modules/**', '**/legacy/**', '**/bin/**', '**/www/**', '**/public/lib/**'],
    },
    js.configs.recommended,
    prettierConfig,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.node,
                __APP_COMMIT__: 'readonly',
                __APP_COMMIT_SHORT__: 'readonly',
                __APP_REPO_URL__: 'readonly',
                __APP_COMMIT_SOURCE__: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
        },
    },
];

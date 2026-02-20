import js from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    prettier,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                liff: 'readonly',
                firebase: 'readonly',
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                navigator: 'readonly',
                process: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': 'warn',
            'no-console': 'off',
        },
    },
];

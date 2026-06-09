import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Flat config (ESLint 9+). Mirrors the previous .eslintrc.js:
// eslint:recommended + @typescript-eslint/recommended with the same rule overrides.
export default tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'public/', 'demo.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);

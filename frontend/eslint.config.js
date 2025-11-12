// eslint.config.js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import officeAddinsPlugin from 'eslint-plugin-office-addins';

export default [
  // Global ignores
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', 'coverage/**']
  },
  
  // Base JavaScript configuration for all files
  js.configs.recommended,
  
  // Node.js config files
  {
    files: ['*.config.js', '*.config.ts', 'tailwind.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly'
      }
    }
  },
  
  // JavaScript/JSX files (including config files) - non-type-aware rules only
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        // Office.js global variables for JS files
        Office: "readonly",
        Excel: "readonly",
        Word: "readonly",
        PowerPoint: "readonly",
        Outlook: "readonly"
      }
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'office-addins': officeAddinsPlugin
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      // React rules for JSX files
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unstable-nested-components': 'error',
      'react/jsx-no-leaked-render': 'error',
      'react/jsx-no-constructed-context-values': 'error',
      
      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      
      // Office add-in specific rules
      'office-addins/no-navigational-load': 'warn'
    }
  },
  
  // TypeScript files with type-aware linting - spread configs at top level
  ...tseslint.configs.recommendedTypeChecked.map(config => ({
    ...config,
    files: ['**/*.{ts,tsx}']
  })),
  
  // Additional TypeScript-specific configuration
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        // Office.js global variables
        Office: "readonly",
        Excel: "readonly",
        Word: "readonly",
        PowerPoint: "readonly",
        Outlook: "readonly"
      }
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'office-addins': officeAddinsPlugin
    },
    settings: {
      react: {
        version: 'detect'
      }
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['warn', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-floating-promises': 'off', // Temporarily allow unhandled promises
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-explicit-any': 'off', // Temporarily allow explicit any
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'warn',
      
      'no-constant-binary-expression': 'warn',

      // React rules (React 17+ JSX transform)
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off', // Using TypeScript
      'react/no-unstable-nested-components': 'error',
      'react/jsx-no-leaked-render': 'error',
      'react/jsx-no-constructed-context-values': 'error',
      
      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 'react-hooks/react-compiler': 'error', // Enable with v6.0.0-rc.1
      
      // Office add-in specific rules
      'office-addins/no-navigational-load': 'warn'
    }
  }
];

import pluginJs from "@eslint/js"
import tseslint from "typescript-eslint"
import prettierConfig from 'eslint-config-prettier'
import enforceNoLocalhost from './.eslint/rules/enforce-no-localhost.js'

export default [
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      custom: {
        rules: {
          'enforce-no-localhost': enforceNoLocalhost
        }
      }
    },
    rules: {
      ...prettierConfig.rules,
      "no-console": "off",
      '@typescript-eslint/no-require-imports': "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "no-trailing-spaces": "error",
      "no-multiple-empty-lines": ["error", { "max": 1, "maxEOF": 0 }],
      "semi": ["error", "never"],
      "indent": ["error", 2],
      "custom/enforce-no-localhost": "error"
    }
  }
]
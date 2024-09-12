import pluginJs from "@eslint/js"
import tseslint from "typescript-eslint"
import prettierConfig from 'eslint-config-prettier'
import enforceAccessMiddleware from './.eslint/rules/enforce-access-middleware.js'

export default [
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      custom: {
        rules: {
          'enforce-access-middleware': enforceAccessMiddleware
        }
      }
    },
    rules: {
      ...prettierConfig.rules,
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-trailing-spaces": "error",
      "no-multiple-empty-lines": ["error", { "max": 1, "maxEOF": 0 }],
      "semi": ["error", "never"],
      "indent": ["error", 2],
      "custom/enforce-access-middleware": "error"
    }
  }
]
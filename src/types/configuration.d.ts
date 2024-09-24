export interface Configuration {
    id: number,
    originLanguage: string,
    languages: string[],
    rules: string,
    autoMergeToBaseBranch?: boolean,
    implicitRules?: ImplicitRule[],
    rulesPerLanguage: Rule[],
    useThisConfig: boolean
  }
export interface Configuration {
    id: number,
    originLanguage: string,
    languages: string[],
    rules: string,
    autoMergeToBaseBranch?: boolean,
    implicitRules?: ImplicitRule[],
    rulesPerLanguage: Rule[],
    useThisConfig: boolean,
    keyFilters: Filter | null;
    languageSelector: LanguageSelector | null;
  }

export type PartialConfiguration = {
  [K in keyof Configuration]?: Configuration[K]
}
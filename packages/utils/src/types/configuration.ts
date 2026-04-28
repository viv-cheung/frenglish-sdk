export interface Configuration {
    id: number;
    projectID: number;
    originLanguage: string | null;
    languages: string[] | null;
    languageSelector: LanguageSelector | null;
    excludedTranslationBlocks: ExcludedTranslationBlock[] | null;
    rules: string | null;
    knowledgeBaseFiles: string[];
    autoMergeToBaseBranch: boolean;
    rulesPerLanguage: Rule[] | null;
    oneTimeTranslation: boolean;
    keyFilters: Filter | null;
    keyFiltersPerLanguage: KeyFilterRule[] | null;
    languageAvailability: LanguageAvailabilityPayload | null;
    geoRouting?: GeoRoutingPayload | null;
    useTranslatedUrls: boolean;
    includeExcludedPathLanguagesInSitemap?: boolean;
    showOriginLanguageCode: boolean;
    createdAt: string | null;
    lastModifiedAt: string | null;
}

export interface LanguageAvailabilityEntry {
  id: string;               // stable ID (e.g., sha1(path) or CMS ID)
  path: string;             // e.g., "/quebec"
  title?: string;           // optional display title
  enabledLocales: string[]; // locales where this page exists (e.g., ["fr-ca", "en-ca"])
  redirectBehaviour: string;
}

export interface LanguageAvailabilityPayload {
  entries: LanguageAvailabilityEntry[];
  settings?: {
    unavailableBehavior?: string; // default "/"
  };
}

export interface GeoRoutingPayload {
  enabled: boolean;
  countryToLanguage: Record<string, string>;
  regionToLanguage?: Record<string, string>;
  originHandledLanguages?: string[];
}

export interface ConfigurationResponse {
    configuration: Configuration;
}

export type PartialConfiguration = Partial<Configuration>;

export interface LanguageSelector {
    displayFullLanguageName: boolean,
    displayFlags: boolean,
    hideLanguageSelector: boolean,
    customCSS: string,
}

export interface ExcludedTranslationBlockItem {
  id: string;
  selector: string;
  description: string;
}

export interface ExcludedTranslationBlock {
  blocks: ExcludedTranslationBlockItem[];
}

export type Rule = {
    language: string,
    rules: string
  };

export interface Filter {
    includeFilters: string[] | null
    excludeFilters: string[] | null
}

/** Per-language key filters (include/exclude JSON keys). Falls back to global keyFilters when no entry for language. */
export interface KeyFilterRule {
    language: string;
    keyFilters: Filter;
}
export interface Project {
    id: number;
    name: string;
    tokensUsedPeriod: number;
    tokensUsedTotal: number;
    wordsTranslatedPeriod: number;
    wordsTranslatedTotal: number;
    lastModified: string;
    integrationType: string;
    createdAt: string;
    isActive: boolean;
    domain: string;
    isTestIntegrationMode: boolean;
    integrationConfig: WordpressConfig | DefaultWebsiteConfig;
    websiteIntegrationType: 'wordpress' | 'nextjs';
  }

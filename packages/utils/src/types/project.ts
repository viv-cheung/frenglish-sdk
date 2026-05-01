export interface Project {
    id: number
    name: string
    isTestIntegrationMode: boolean
    webhookUrls?: string[]
    domain?: string
    /** Staging or other hostnames that resolve to this project; translations use `domain` as canonical. */
    websiteAliasDomains?: string[] | null
    integrationConfig?: WordpressConfig | DefaultWebsiteConfig | null
    isActive: boolean
    lastModifiedAt: string
    createdAt: string
    privateApiKey: string
    publicApiKey: string
    domainKeys?: string[]
    useSubdomains: boolean
    integrationType: string
  }

export interface WordpressConfig {
    websiteIntegrationType: 'wordpress';
    apiKey: string;
    includedUrlPaths: string [];
    excludedUrlPaths: string [];
}

export interface ProjectResponse {
    project: Project;
}
export type UrlMapEntry = { original: string; translated: string };
export type UrlMapPerLanguage = { enabled: boolean; urls: Record<string, UrlMapEntry> };

export interface WebsiteAliasCloudflareConfig {
    domain: string;
    cloudflareCustomHostnameID: string;
    cloudflareTxtRecord1Name: string;
    cloudflareTxtRecord1Value: string;
    cloudflareTxtRecord2Name: string;
    cloudflareTxtRecord2Value: string;
    isTXT1DNSValidated: boolean;
    isTXT2DNSValidated: boolean;
    isReverseProxyDNSValidated: boolean;
}

export interface DefaultWebsiteConfig {
    websiteIntegrationType: 'nextjs' | 'webflow' | 'squarespace' | 'salesforce' | 'other';
    isTXT1DNSValidated: boolean;
    isTXT2DNSValidated: boolean;
    isReverseProxyDNSValidated: boolean;
    previewUrl: string;
    cloudflareCustomHostnameID: string;
    cloudflareRouteID: string;
    cloudflareTxtRecord1Name: string;
    cloudflareTxtRecord1Value: string;
    cloudflareTxtRecord2Name: string;
    cloudflareTxtRecord2Value: string;
    cloudflareOriginServerProxy: string;
    includedUrlPaths: string [];
    excludedUrlPaths: string [];
    websiteAliasCloudflareConfigs?: WebsiteAliasCloudflareConfig[] | null;
  }
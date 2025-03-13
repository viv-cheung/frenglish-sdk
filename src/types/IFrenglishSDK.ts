import { Configuration, PartialConfiguration } from './configuration';
import { FileContentWithLanguage, RequestTranslationResponse, TranslationResponse } from './api';
import { File } from './file';
import { TranslationStatus } from './translation';

export interface IFrenglishSDK {
  registerWebhook(webhookUrl: string): Promise<void>;
  
  translate(
    content: string[], 
    isFullTranslation?: boolean, 
    filenames?: string[], 
    partialConfig?: PartialConfiguration
  ): Promise<RequestTranslationResponse | undefined>;
  
  translateString(
    content: string, 
    lang: string, 
    partialConfig?: PartialConfiguration
  ): Promise<String | undefined>;
  
  getTextMap(): Promise<File | null>;
  
  upload(files: FileContentWithLanguage[]): Promise<any>;
  
  getSupportedLanguages(): Promise<string[]>;
  
  getPublicAPIKeyFromDomain(domain: string): Promise<string>;
  
  getSupportedFileTypes(): Promise<string[]>;
  
  getProjectSupportedLanguages(): Promise<{ 
    languages: string[], 
    originLanguage: string 
  }>;
  
  getDefaultConfiguration(): Promise<Configuration>;
  
  getProjectDomain(): Promise<string>;
  
  getTranslationStatus(translationId: number): Promise<TranslationStatus>;
  
  getTranslationContent(translationId: number): Promise<TranslationResponse[]>;
}
import { Configuration, PartialConfiguration } from 'src/types/configuration';
import { FRENGLISH_BACKEND_URL } from '../config/config';
import { FileContentWithLanguage, RequestTranslationResponse, TranslationResponse } from '../types/api';
import { File } from '../types/file'
import { TranslationStatus } from '../types/translation';
import { parsePartialConfig } from '../utils/files';
import { IFrenglishSDK } from '../types/IFrenglishSDK';

export class FrenglishSDK implements IFrenglishSDK {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  public async registerWebhook(webhookUrl: string): Promise<void> {
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/webhook/register-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ 
        webhookUrl,
        apiKey: this.apiKey
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to register webhook: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  // Send a translation request to Frenglish!
  public async translate(content: string[], isFullTranslation: boolean = false, filenames: string[] = [], partialConfig: PartialConfiguration = {}): 
  Promise<RequestTranslationResponse | undefined> {
    const POLLING_INTERVAL = 500 // 5 seconds
    const MAX_POLLING_TIME = 1800000 // 30 minutes  
    const startTime = Date.now() - POLLING_INTERVAL
    const parsedConfig = await parsePartialConfig(partialConfig);
    const body: any = { content, apiKey: this.apiKey, isFullTranslation, filenames, partialConfig: parsedConfig };

    // Sending translation request
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/request-translation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Failed to request translation: ${JSON.stringify(response)}`);
    }
    const data: RequestTranslationResponse = await response.json()
    while (Date.now() - startTime < MAX_POLLING_TIME) {
      const translationStatus = await this.getTranslationStatus(data.translationId)
      if (translationStatus === TranslationStatus.COMPLETED) {
        const content = await this.getTranslationContent(data.translationId)
        return { translationId: data.translationId, content }
      } else if (translationStatus === TranslationStatus.CANCELLED) { 
        throw new Error('Translation cancelled')
        return
      }

      // If not completed, wait before checking again
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL))
    }
  }

  // Send a translation string request to Frenglish and receive a string response
  public async translateString(content: string, lang: string, partialConfig: PartialConfiguration = {}): Promise<String | undefined> {
    const POLLING_INTERVAL = 500 // 5 seconds
    const MAX_POLLING_TIME = 1800000 // 30 minutes  
    const startTime = Date.now() - POLLING_INTERVAL
    const parsedConfig = await parsePartialConfig(partialConfig);

    const body: any = { content, apiKey: this.apiKey, lang, partialConfig: parsedConfig };
    const supportedLanguagesResponse = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/supported-languages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!supportedLanguagesResponse.ok) {
      throw new Error('Failed to get supported languages');
    }

    const supportedLanguages = await supportedLanguagesResponse.json();

    if (!supportedLanguages.includes(lang)) {
      throw new Error(`Language '${lang}' is not supported. Supported languages are: ${supportedLanguages.join(', ')}`);
    }

    // Sending translation request
    const translationResponse = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/request-translation-string`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  
    if (!translationResponse.ok) {
      throw new Error(`Failed to request translation: ${JSON.stringify(translationResponse)}`);
    }

    const data: RequestTranslationResponse = await translationResponse.json()
    while (Date.now() - startTime < MAX_POLLING_TIME) {
      const translationStatus = await this.getTranslationStatus(data.translationId)
      if (translationStatus === TranslationStatus.COMPLETED) {
        const content = await this.getTranslationContent(data.translationId)
        // Extract just the translated text
        const translatedContent = content[0]?.files[0]?.content
        if (translatedContent) {
          const parsedContent = JSON.parse(translatedContent)
          return Object.values(parsedContent)[0] as string
        }
        return undefined
      } else if (translationStatus === TranslationStatus.CANCELLED) { 
        throw new Error('Translation cancelled')
      }

      // If not completed, wait before checking again
      await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL))
    }
  }

  // Get text map for your projects
  public async getTextMap(): Promise<File | null> {
    const body: any = { apiKey: this.apiKey };

    // Sending translation request
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/project/request-text-map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to request text map: ${JSON.stringify(response)}`);
    }

    return response.json()
  }

  // Upload files to use as base comparison
  public async upload(files: FileContentWithLanguage[]) {
    console.log('Attempting to upload to:', `${FRENGLISH_BACKEND_URL}/api/translation/upload-files`);
    try {
      const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/upload-files`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ files, apiKey: this.apiKey }),
      });
  
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload files: ${response.status} ${response.statusText} - ${errorText}`);
      }
  
      return await response.json();
    } catch (error) {
      console.error('Detailed upload error:', error);
      throw error;
    }
  }

  // Get supported languages
  public async getSupportedLanguages() {
    try {
      const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/supported-languages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: this.apiKey })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get supported languages: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting supported languages:', error);
      throw error;
    }
  }

  // Get supported file types
  public async getPublicAPIKeyFromDomain(domain: string) {
    try {
      const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/project/get-public-api-key-from-domain`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domainURL: domain, apiKey: this.apiKey }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get public API key from domain: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting public API key from domain:', error);
      throw error;
    }
  }

  // Get supported file types
  public async getSupportedFileTypes() {
    try {
      const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/supported-file-types`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get supported file types: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting supported file types:', error);
      throw error;
    }
  }

  public async getProjectSupportedLanguages(): Promise<{ languages: string[], originLanguage: string }> {
    try {
      const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/configuration/get-project-supported-languages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ apiKey: this.apiKey }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get supported languages: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting project supported languages:', error);
      throw error;
    }
  }

  // Get translation configuration
  public async getDefaultConfiguration(): Promise<Configuration> {
    try {
      const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/configuration/get-default-configuration`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: this.apiKey }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get default configuration: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Error getting default configuration:', error);
      throw error;
    }
  }

  public async getProjectDomain(): Promise<string> {
    try {
      const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/project/get-domain-url`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ apiKey: this.apiKey }),
      });
      console.log("response", response);
      const data = await response.json();
      console.log('data', data);

      return data;
    } catch (error) {
      console.error('Error getting project domain:', error);
      throw error;
    }
  }

  // Polling request to get the translation status once completed
  public async getTranslationStatus(translationId: number): Promise<TranslationStatus> {
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/get-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ translationId, apiKey: this.apiKey }),
    })

    if (!response.ok) {
      throw new Error('Failed to get translation status')
    }

    const data = await response.json()
    return data.status
  }

  // Get the translation content (call this after the translation status is "COMPLETED")
  public async getTranslationContent(translationId: number): Promise<TranslationResponse[]> {
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/get-translation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ translationId, apiKey: this.apiKey }),
    })

    if (!response.ok) {
      throw new Error('Failed to get translation');
    }

    const data = await response.json()
    return data
  }
}

export default FrenglishSDK
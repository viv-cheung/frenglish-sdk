import { Configuration } from 'src/types/configuration';
import { FRENGLISH_BACKEND_URL } from '../config/config';
import { FileContentWithLanguage, RequestTranslationResponse, TranslationResponse } from '../types/api';
import { File } from '../types/file'
import { TranslationStatus } from '../types/translation';

class FrenglishSDK {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async registerWebhook(webhookUrl: string): Promise<void> {
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
  async translate(content: string[], isFullTranslation: boolean = false, filenames: string[] = []): 
  Promise<RequestTranslationResponse | undefined> {
    const POLLING_INTERVAL = 500 // 5 seconds
    const MAX_POLLING_TIME = 1800000 // 30 minutes  
    const startTime = Date.now() - POLLING_INTERVAL
    const body: any = { content, apiKey: this.apiKey, isFullTranslation };
    if (filenames && filenames.length > 0) {
      body.filenames = filenames
    }

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
  async translateString(content: string, lang: string): Promise<String | undefined> {
    const POLLING_INTERVAL = 500 // 5 seconds
    const MAX_POLLING_TIME = 1800000 // 30 minutes  
    const startTime = Date.now() - POLLING_INTERVAL

    const body: any = { content, apiKey: this.apiKey, lang };
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
  async getTextMap(): Promise<File | null> {
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
  async upload(files: FileContentWithLanguage[]) {
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
  async getSupportedLanguages() {
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
  async getPublicAPIKeyFromDomain(domain: string) {
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
  async getSupportedFileTypes() {
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

  async getProjectSupportedLanguages(): Promise<{ supportedLanguages: string[], originLanguage: string }> {
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

  // Get supported file types
  async getDefaultConfiguration(): Promise<Configuration> {
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

  // Polling request to get the translation status once completed
  async getTranslationStatus(translationId: number): Promise<TranslationStatus> {
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
  async getTranslationContent(translationId: number): Promise<TranslationResponse[]> {
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
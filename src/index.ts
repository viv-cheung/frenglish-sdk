import { FRENGLISH_BACKEND_URL } from './config/config';
import { RequestTranslationResponse, TranslationResponse } from './types/api';
import { TranslationStatus } from './types/translation';

class FrenglishSDK {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async registerWebhook(webhookUrl: string, projectID: number): Promise<void> {
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/webhook/register-webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ webhookUrl, projectID, apiKey: this.apiKey }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to register webhook: ${response.status} ${response.statusText} - ${errorText}`);
    }
  }

  // Send a translation request to Frenglish!
  async translate(filenames: [], content: []): Promise<RequestTranslationResponse | undefined> {
    const POLLING_INTERVAL = 5000 // 5 seconds
    const MAX_POLLING_TIME = 1800000 // 30 minutes  
    const startTime = Date.now()

    // Sending translation request
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/request-translation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ filenames, content, apiKey: this.apiKey }),
    });
  
    if (!response.ok) {
      throw new Error(`Failed to request translation: ${response}`);
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

  // Polling request to get the translation status once completed
  async getTranslationStatus(translationId: number): Promise<TranslationStatus> {
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/get-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ translationId, apiKey: this.apiKey }),
    });

    if (!response.ok) {
      throw new Error('Failed to get translation status');
    }

    const data = await response.json();
    return data.status;
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
    });

    if (!response.ok) {
      throw new Error('Failed to get translation');
    }

    const data = await response.json();
    return data;
  }
}

export default FrenglishSDK;
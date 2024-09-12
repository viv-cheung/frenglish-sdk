import { FRENGLISH_BACKEND_URL } from './config/config';

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
  async requestTranslation(filenames: [], content: []): Promise<string> {
    const response = await fetch(`${FRENGLISH_BACKEND_URL}/api/translation/request-translation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ filenames, content, apiKey: this.apiKey }),
    });
  
    if (!response.ok) {
      throw new Error('Failed to request translation');
    }
  
    return response.json();
  }

  // Polling request to get the translation status once completed
  async getTranslationStatus(translationId: number): Promise<string> {
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
    console.log("get-status response ", data)
    return data.status;
  }

  // Get the translation content (call this after the translation status is "COMPLETED")
  async getTranslation(translationId: number): Promise<any> {
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
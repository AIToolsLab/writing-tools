import { Page } from '@playwright/test';

/**
 * Mock backend API responses that match the actual FastAPI backend structure
 */

export interface GenerationResult {
  generation_type: string;
  result: string;
  extra_data: Record<string, any>;
}

/**
 * Setup mock backend for /api/get_suggestion endpoint
 * Matches the actual backend API structure from server.py and nlp.py
 */
export async function setupMockBackend(page: Page) {
  // Mock /api/get_suggestion
  await page.route('**/api/get_suggestion', async (route) => {
    const request = route.request();
    const postData = request.postDataJSON();
    const gtype = postData?.gtype;

    let result = '';

    switch(gtype) {
      case 'example_sentences':
        result = '- First example suggestion\n\n- Second example suggestion\n\n- Third example suggestion';
        break;
      case 'analysis_readerPerspective':
        result = '- First reader perspective\n\n- Second reader perspective\n\n- Third reader perspective';
        break;
      case 'proposal_advice':
        result = '- First piece of advice\n\n- Second piece of advice\n\n- Third piece of advice';
        break;
    }

    const response: GenerationResult = {
      generation_type: gtype || 'unknown',
      result,
      extra_data: {},
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

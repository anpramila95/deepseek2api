/**
 * 2Captcha Provider
 * https://2captcha.com
 * Supports image CAPTCHA, reCAPTCHA, hCaptcha, and more
 */

const BaseCaptchaProvider = require('./base-provider');
const { logInfo, logError, logWarn } = require('../../logger');

class TwoCaptchaProvider extends BaseCaptchaProvider {
  constructor() {
    super();
    this.name = '2captcha';
    this.baseUrl = 'https://2captcha.com';
    this.apiKey = null;
  }

  async initialize(settings) {
    this.settings = settings || {};
    this.apiKey = this.settings.apiKey;
    this.baseUrl = this.settings.endpoint || 'https://2captcha.com';
    this.timeout = this.settings.timeout || 120;
    this.initialized = true;
    logInfo({ provider: this.name, endpoint: this.baseUrl }, '2Captcha provider initialized');
    return true;
  }

  isConfigured() {
    return this.initialized && !!this.apiKey;
  }

  async solve(imageBuffer, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('2Captcha not configured');
    }

    const { instruction, accountId } = options;
    const base64Image = imageBuffer.toString('base64');

    try {
      logInfo({ accountId, instruction }, 'Solving CAPTCHA with 2Captcha');

      // Upload image to 2Captcha
      const uploadResult = await this.uploadImage(base64Image, instruction, accountId);
      if (!uploadResult || !uploadResult.request) {
        throw new Error('Failed to upload CAPTCHA to 2Captcha');
      }

      const taskId = uploadResult.request;
      logInfo({ accountId, taskId }, '2Captcha task created');

      // Poll for result
      const result = await this.pollForResult(taskId, accountId);
      if (!result) {
        throw new Error('No result from 2Captcha');
      }

      const solution = this.parseSolution(result);
      logInfo({ accountId, solution }, '2Captcha solved successfully');
      return solution;
    } catch (error) {
      logError({ err: error, accountId }, '2Captcha solve failed');
      throw error;
    }
  }

  async uploadImage(base64Image, instruction, accountId) {
    const formData = new URLSearchParams();
    formData.append('key', this.apiKey);
    formData.append('method', 'base64');
    formData.append('body', base64Image);
    
    if (instruction) {
      formData.append('phrase', '0');
      formData.append('regsense', '1');
      formData.append('textinstructions', instruction);
    }

    const response = await fetch(`${this.baseUrl}/in.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString()
    });

    if (!response.ok) {
      throw new Error(`2Captcha upload failed: ${response.status}`);
    }

    const text = await response.text();
    if (text.startsWith('ERROR')) {
      throw new Error(`2Captcha error: ${text}`);
    }

    // Parse response (format: OK|taskId)
    const parts = text.split('|');
    if (parts[0] !== 'OK') {
      throw new Error(`2Captcha upload error: ${text}`);
    }

    return { request: parts[1] };
  }

  async pollForResult(taskId, accountId, maxAttempts = 30, delayMs = 3000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(
          `${this.baseUrl}/res.php?key=${this.apiKey}&action=get&id=${taskId}`,
          { method: 'GET' }
        );

        if (!response.ok) {
          await this.sleep(delayMs);
          continue;
        }

        const text = await response.text();
        
        if (text === 'CAPCHA_NOT_READY') {
          await this.sleep(delayMs);
          continue;
        }

        if (text.startsWith('OK|')) {
          return { text: text.substring(3) };
        }

        if (text.startsWith('ERROR')) {
          throw new Error(`2Captcha error: ${text}`);
        }

        await this.sleep(delayMs);
      } catch (error) {
        logWarn({ err: error, accountId, attempt }, '2Captcha poll error');
        await this.sleep(delayMs);
      }
    }

    return null;
  }

  parseSolution(solution) {
    // 2Captcha returns text response - parse coordinates if present
    if (solution.text) {
      const coordMatch = solution.text.match(/(\d+),\s*(\d+)/);
      if (coordMatch) {
        return {
          coordinates: `${coordMatch[1]},${coordMatch[2]}`,
          text: solution.text
        };
      }
      return { text: solution.text };
    }
    return super.parseSolution(solution);
  }
}

module.exports = TwoCaptchaProvider;

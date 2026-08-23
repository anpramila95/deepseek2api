/**
 * DeathByCaptcha Provider
 * https://deathbycaptcha.com
 * Supports image CAPTCHA solving
 */

const BaseCaptchaProvider = require('./base-provider');
const { logInfo, logError, logWarn } = require('../../logger');

class DeathByCaptchaProvider extends BaseCaptchaProvider {
  constructor() {
    super();
    this.name = 'deathbycaptcha';
    this.baseUrl = 'https://api.dbcapi.me/api';
    this.username = null;
    this.password = null;
  }

  async initialize(settings) {
    this.settings = settings || {};
    this.username = this.settings.username;
    this.password = this.settings.password;
    this.baseUrl = this.settings.endpoint || 'https://api.dbcapi.me/api';
    this.timeout = this.settings.timeout || 120;
    this.initialized = true;
    logInfo({ provider: this.name, endpoint: this.baseUrl }, 'DeathByCaptcha provider initialized');
    return true;
  }

  isConfigured() {
    return this.initialized && !!this.username && !!this.password;
  }

  async solve(imageBuffer, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('DeathByCaptcha not configured');
    }

    const { instruction, accountId } = options;

    try {
      logInfo({ accountId, instruction }, 'Solving CAPTCHA with DeathByCaptcha');

      // Upload CAPTCHA
      const uploadResult = await this.uploadCaptcha(imageBuffer, instruction, accountId);
      if (!uploadResult || !uploadResult.captcha) {
        throw new Error('Failed to upload CAPTCHA to DeathByCaptcha');
      }

      const captchaId = uploadResult.captcha;
      logInfo({ accountId, captchaId }, 'DeathByCaptcha task created');

      // Poll for result
      const result = await this.pollForResult(captchaId, accountId);
      if (!result) {
        throw new Error('No result from DeathByCaptcha');
      }

      const solution = this.parseSolution(result);
      logInfo({ accountId, solution }, 'DeathByCaptcha solved successfully');
      return solution;
    } catch (error) {
      logError({ err: error, accountId }, 'DeathByCaptcha solve failed');
      throw error;
    }
  }

  async uploadCaptcha(imageBuffer, instruction, accountId) {
    const formData = new FormData();
    formData.append('username', this.username);
    formData.append('password', this.password);
    
    // DeathByCaptcha expects the image file
    const blob = new Blob([imageBuffer], { type: 'image/png' });
    formData.append('captchafile', blob, 'captcha.png');
    
    if (instruction) {
      formData.append('textinstructions', instruction);
    }

    const response = await fetch(`${this.baseUrl}/captcha`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`DeathByCaptcha upload failed: ${response.status}`);
    }

    const data = await response.json();
    if (data.status === 0) {
      throw new Error(`DeathByCaptcha error: ${data.error || 'Unknown error'}`);
    }

    return data;
  }

  async pollForResult(captchaId, accountId, maxAttempts = 30, delayMs = 3000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(
          `${this.baseUrl}/captcha/${captchaId}?username=${this.username}&password=${this.password}`,
          { method: 'GET' }
        );

        if (!response.ok) {
          await this.sleep(delayMs);
          continue;
        }

        const data = await response.json();
        
        if (data.status === 0) {
          throw new Error(`DeathByCaptcha error: ${data.error || 'Unknown error'}`);
        }

        // status: 0 = unsolved, 1 = solved
        if (data.status === 1 && data.text) {
          return { text: data.text };
        }

        await this.sleep(delayMs);
      } catch (error) {
        logWarn({ err: error, accountId, attempt }, 'DeathByCaptcha poll error');
        await this.sleep(delayMs);
      }
    }

    return null;
  }

  parseSolution(solution) {
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

module.exports = DeathByCaptchaProvider;

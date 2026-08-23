/**
 * ImageTyperz Provider
 * https://imagetyperz.com
 * Supports image CAPTCHA, reCAPTCHA, and more
 */

const BaseCaptchaProvider = require('./base-provider');
const { logInfo, logError, logWarn } = require('../../logger');

class ImageTyperzProvider extends BaseCaptchaProvider {
  constructor() {
    super();
    this.name = 'imagetyperz';
    this.baseUrl = 'https://api.imagetyperz.com';
    this.apiKey = null;
  }

  async initialize(settings) {
    this.settings = settings || {};
    this.apiKey = this.settings.apiKey;
    this.baseUrl = this.settings.endpoint || 'https://api.imagetyperz.com';
    this.timeout = this.settings.timeout || 120;
    this.initialized = true;
    logInfo({ provider: this.name, endpoint: this.baseUrl }, 'ImageTyperz provider initialized');
    return true;
  }

  isConfigured() {
    return this.initialized && !!this.apiKey;
  }

  async solve(imageBuffer, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('ImageTyperz not configured');
    }

    const { instruction, accountId } = options;
    const base64Image = imageBuffer.toString('base64');

    try {
      logInfo({ accountId, instruction }, 'Solving CAPTCHA with ImageTyperz');

      // Submit CAPTCHA
      const formData = new URLSearchParams();
      formData.append('token', this.apiKey);
      formData.append('action', 'UPLOADCAPTCHA');
      formData.append('base64', '1');
      formData.append('image', base64Image);

      if (instruction) {
        formData.append('instruction', instruction);
      }

      const uploadResponse = await fetch(`${this.baseUrl}/v1/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString()
      });

      if (!uploadResponse.ok) {
        throw new Error(`ImageTyperz upload failed: ${uploadResponse.status}`);
      }

      const uploadData = await uploadResponse.json();
      if (uploadData.error) {
        throw new Error(`ImageTyperz error: ${uploadData.error}`);
      }

      const captchaId = uploadData.captchaID || uploadData.id;
      if (!captchaId) {
        throw new Error('No CAPTCHA ID returned from ImageTyperz');
      }

      logInfo({ accountId, captchaId }, 'ImageTyperz task created');

      // Poll for result
      const result = await this.pollForResult(captchaId, accountId);
      if (!result) {
        throw new Error('No result from ImageTyperz');
      }

      const solution = this.parseSolution(result);
      logInfo({ accountId, solution }, 'ImageTyperz solved successfully');
      return solution;
    } catch (error) {
      logError({ err: error, accountId }, 'ImageTyperz solve failed');
      throw error;
    }
  }

  async pollForResult(captchaId, accountId, maxAttempts = 30, delayMs = 3000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const formData = new URLSearchParams();
        formData.append('token', this.apiKey);
        formData.append('action', 'GETCAPTCHASTATUS');
        formData.append('captchaID', captchaId);

        const response = await fetch(`${this.baseUrl}/v1/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData.toString()
        });

        if (!response.ok) {
          await this.sleep(delayMs);
          continue;
        }

        const data = await response.json();
        
        if (data.error) {
          throw new Error(`ImageTyperz error: ${data.error}`);
        }

        // Status: 0 = pending, 1 = solved
        if (data.status === 1 && data.text) {
          return { text: data.text };
        }

        await this.sleep(delayMs);
      } catch (error) {
        logWarn({ err: error, accountId, attempt }, 'ImageTyperz poll error');
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

module.exports = ImageTyperzProvider;

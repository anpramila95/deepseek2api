/**
 * YesCaptcha Provider
 * Compatible with existing YesCaptcha implementation
 * https://yescaptcha.com
 */

const BaseCaptchaProvider = require('./base-provider');
const { logInfo, logError, logWarn } = require('../../logger');

class YesCaptchaProvider extends BaseCaptchaProvider {
  constructor() {
    super();
    this.name = 'yescaptcha';
    this.baseUrl = 'https://api.yescaptcha.com';
    this.apiKey = null;
  }

  async initialize(settings) {
    this.settings = settings || {};
    this.apiKey = this.settings.apiKey;
    this.baseUrl = this.settings.endpoint || 'https://api.yescaptcha.com';
    this.timeout = this.settings.timeout || 120;
    this.initialized = true;
    logInfo({ provider: this.name, endpoint: this.baseUrl }, 'YesCaptcha provider initialized');
    return true;
  }

  isConfigured() {
    return this.initialized && !!this.apiKey;
  }

  async solve(imageBuffer, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('YesCaptcha not configured');
    }

    const { instruction, accountId } = options;
    const base64Image = imageBuffer.toString('base64');

    try {
      logInfo({ accountId, instruction }, 'Solving CAPTCHA with YesCaptcha');

      // Create task
      const taskPayload = {
        clientKey: this.apiKey,
        task: {
          type: 'ImageToTextTask',
          body: base64Image
        }
      };

      if (instruction) {
        taskPayload.task.comment = instruction;
      }

      const createResponse = await fetch(`${this.baseUrl}/createTask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskPayload)
      });

      if (!createResponse.ok) {
        throw new Error(`YesCaptcha API error: ${createResponse.status}`);
      }

      const createData = await createResponse.json();
      if (createData.errorId) {
        throw new Error(`YesCaptcha error: ${createData.errorDescription || 'Unknown error'}`);
      }

      if (!createData.taskId) {
        throw new Error('No taskId returned from YesCaptcha');
      }

      const taskId = createData.taskId;
      logInfo({ accountId, taskId }, 'YesCaptcha task created');

      // Poll for result
      const result = await this.pollForResult(taskId, accountId);
      if (!result) {
        throw new Error('No result from YesCaptcha');
      }

      const solution = this.parseSolution(result);
      logInfo({ accountId, solution }, 'YesCaptcha solved successfully');
      return solution;
    } catch (error) {
      logError({ err: error, accountId }, 'YesCaptcha solve failed');
      throw error;
    }
  }

  async pollForResult(taskId, accountId, maxAttempts = 30, delayMs = 2000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/getTaskResult`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientKey: this.apiKey,
            taskId: taskId
          })
        });

        if (!response.ok) {
          await this.sleep(delayMs);
          continue;
        }

        const data = await response.json();
        
        if (data.errorId) {
          throw new Error(`YesCaptcha error: ${data.errorDescription || 'Unknown error'}`);
        }

        if (data.status === 'ready') {
          return data.solution;
        }

        await this.sleep(delayMs);
      } catch (error) {
        logWarn({ err: error, accountId, attempt }, 'YesCaptcha poll error');
        await this.sleep(delayMs);
      }
    }

    return null;
  }

  parseSolution(solution) {
    // YesCaptcha returns solution.text for ImageToTextTask
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
    if (solution.coordinates) {
      return { coordinates: solution.coordinates };
    }
    return super.parseSolution(solution);
  }
}

module.exports = YesCaptchaProvider;

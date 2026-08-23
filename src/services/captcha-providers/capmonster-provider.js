/**
 * CapMonster Provider
 * https://capmonster.cloud
 * Supports image CAPTCHA, reCAPTCHA, hCaptcha, and more
 */

const BaseCaptchaProvider = require('./base-provider');
const { logInfo, logError, logWarn } = require('../../logger');

class CapMonsterProvider extends BaseCaptchaProvider {
  constructor() {
    super();
    this.name = 'capmonster';
    this.baseUrl = 'https://api.capmonster.cloud';
    this.apiKey = null;
  }

  async initialize(settings) {
    this.settings = settings || {};
    this.apiKey = this.settings.apiKey;
    this.baseUrl = this.settings.endpoint || 'https://api.capmonster.cloud';
    this.timeout = this.settings.timeout || 120;
    this.initialized = true;
    logInfo({ provider: this.name, endpoint: this.baseUrl }, 'CapMonster provider initialized');
    return true;
  }

  isConfigured() {
    return this.initialized && !!this.apiKey;
  }

  async solve(imageBuffer, options = {}) {
    if (!this.isConfigured()) {
      throw new Error('CapMonster not configured');
    }

    const { instruction, accountId } = options;
    const base64Image = imageBuffer.toString('base64');

    try {
      logInfo({ accountId, instruction }, 'Solving CAPTCHA with CapMonster');

      // Create task
      const taskPayload = {
        clientKey: this.apiKey,
        task: {
          type: 'ImageToTextTask',
          body: base64Image,
          phrase: false,
          case: false,
          numeric: 0,
          math: false,
          minLength: 1,
          maxLength: 20
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
        throw new Error(`CapMonster API error: ${createResponse.status}`);
      }

      const createData = await createResponse.json();
      if (createData.errorId !== 0) {
        throw new Error(`CapMonster error: ${createData.errorDescription || 'Unknown error'}`);
      }

      const taskId = createData.taskId;
      logInfo({ accountId, taskId }, 'CapMonster task created');

      // Poll for result
      const result = await this.pollForResult(taskId, accountId);
      if (!result) {
        throw new Error('No result from CapMonster');
      }

      const solution = this.parseSolution(result);
      logInfo({ accountId, solution }, 'CapMonster solved successfully');
      return solution;
    } catch (error) {
      logError({ err: error, accountId }, 'CapMonster solve failed');
      throw error;
    }
  }

  async pollForResult(taskId, accountId, maxAttempts = 30, delayMs = 3000) {
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
        
        if (data.errorId !== 0) {
          throw new Error(`CapMonster error: ${data.errorDescription || 'Unknown error'}`);
        }

        if (data.status === 'ready') {
          return data.solution;
        }

        await this.sleep(delayMs);
      } catch (error) {
        logWarn({ err: error, accountId, attempt }, 'CapMonster poll error');
        await this.sleep(delayMs);
      }
    }

    return null;
  }

  parseSolution(solution) {
    // CapMonster returns solution.text for ImageToTextTask
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
    if (solution.gRecaptchaResponse) {
      return { rid: solution.gRecaptchaResponse };
    }
    return super.parseSolution(solution);
  }
}

module.exports = CapMonsterProvider;

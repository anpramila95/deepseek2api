/**
 * Base CAPTCHA Provider
 * Defines the interface that all CAPTCHA providers must implement
 */

const { logInfo, logError, logWarn } = require('../../logger');

class BaseCaptchaProvider {
  constructor(config) {
    this.config = config || {};
    this.name = 'base';
    this.initialized = false;
  }

  /**
   * Initialize the provider with settings
   * @param {Object} settings - Provider-specific settings
   * @returns {Promise<boolean>}
   */
  async initialize(settings) {
    this.settings = settings || this.settings;
    this.initialized = true;
    logInfo({ provider: this.name }, `${this.name} provider initialized`);
    return true;
  }

  /**
   * Check if provider is configured
   * @returns {boolean}
   */
  isConfigured() {
    return this.initialized && !!this.settings?.apiKey;
  }

  /**
   * Solve a CAPTCHA
   * @param {Buffer} imageBuffer - The CAPTCHA image as a Buffer
   * @param {Object} options - Options for solving
   * @param {string} options.instruction - Additional instruction for solving
   * @param {string} options.accountId - Account ID for tracking
   * @returns {Promise<Object>} - { coordinates, rid, text }
   */
  async solve(imageBuffer, options = {}) {
    throw new Error('solve() must be implemented by subclass');
  }

  /**
   * Sleep helper
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Parse solution from provider response
   * @param {Object} solution - Raw solution from provider
   * @returns {Object} - { coordinates, text, rid }
   */
  parseSolution(solution) {
    // Default implementation - override in subclass
    if (solution.coordinates) {
      return { coordinates: solution.coordinates };
    }
    if (solution.text) {
      return { text: solution.text };
    }
    if (solution.gRecaptchaResponse) {
      return { rid: solution.gRecaptchaResponse };
    }
    return solution;
  }

  /**
   * Format error message
   * @param {Error} error - Error object
   * @param {string} context - Context description
   * @returns {string}
   */
  formatError(error, context) {
    return `${this.name} ${context}: ${error.message || error}`;
  }
}

module.exports = BaseCaptchaProvider;

/**
 * CAPTCHA Provider Registry
 * Manages all available CAPTCHA providers and provides factory methods
 */

const BaseCaptchaProvider = require('./base-provider');
const TwoCaptchaProvider = require('./twocaptcha-provider');
const AntiCaptchaProvider = require('./anticaptcha-provider');
const CapMonsterProvider = require('./capmonster-provider');
const DeathByCaptchaProvider = require('./deathbycaptcha-provider');
const ImageTyperzProvider = require('./image-typerz-provider');
const { logInfo, logError, logWarn } = require('../../logger');

class CaptchaProviderRegistry {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = null;
    this.initialized = false;
  }

  /**
   * Register a provider
   * @param {string} name - Provider name
   * @param {BaseCaptchaProvider} provider - Provider instance
   * @param {Object} options - Provider options
   */
  register(name, provider, options = {}) {
    if (!(provider instanceof BaseCaptchaProvider)) {
      throw new Error('Provider must be an instance of BaseCaptchaProvider');
    }
    this.providers.set(name, { provider, options });
    logInfo({ name, options }, 'CAPTCHA provider registered');
  }

  /**
   * Get a provider by name
   * @param {string} name - Provider name
   * @returns {BaseCaptchaProvider|null}
   */
  getProvider(name) {
    const entry = this.providers.get(name);
    return entry ? entry.provider : null;
  }

  /**
   * Get provider with options
   * @param {string} name - Provider name
   * @returns {Object|null} - { provider, options }
   */
  getProviderEntry(name) {
    return this.providers.get(name) || null;
  }

  /**
   * Get all provider names
   * @returns {string[]}
   */
  getProviderNames() {
    return Array.from(this.providers.keys());
  }

  /**
   * Get all providers
   * @returns {Array<{name: string, provider: BaseCaptchaProvider, options: Object}>}
   */
  getAllProviders() {
    return Array.from(this.providers.entries()).map(([name, { provider, options }]) => ({
      name,
      provider,
      options
    }));
  }

  /**
   * Get configured providers (those that have valid credentials)
   * @returns {Array<{name: string, provider: BaseCaptchaProvider, options: Object}>}
   */
  getConfiguredProviders() {
    return this.getAllProviders().filter(({ provider }) => provider.isConfigured());
  }

  /**
   * Set default provider
   * @param {string} name - Provider name to set as default
   */
  setDefaultProvider(name) {
    if (!this.providers.has(name)) {
      throw new Error(`Provider ${name} not found`);
    }
    this.defaultProvider = name;
    logInfo({ defaultProvider: name }, 'Default CAPTCHA provider set');
  }

  /**
   * Get default provider
   * @returns {BaseCaptchaProvider|null}
   */
  getDefaultProvider() {
    if (!this.defaultProvider) {
      // Return first configured provider if no default set
      const configured = this.getConfiguredProviders();
      if (configured.length > 0) {
        return configured[0].provider;
      }
      return null;
    }
    return this.getProvider(this.defaultProvider);
  }

  /**
   * Initialize all providers with settings
   * @param {Object} settings - System settings
   * @returns {Promise<void>}
   */
  async initializeAll(settings) {
    const providerSettings = settings.captchaProviders || {};

    // Initialize each registered provider
    for (const [name, { provider, options }] of this.providers) {
      const providerConfig = providerSettings[name] || {};
      try {
        await provider.initialize({
          ...providerConfig,
          ...options.defaultSettings
        });
        logInfo({ name }, `CAPTCHA provider ${name} initialized`);
      } catch (error) {
        logError({ err: error, name }, `Failed to initialize CAPTCHA provider ${name}`);
      }
    }

    this.initialized = true;
  }

  /**
   * Solve CAPTCHA using a specific provider
   * @param {string} providerName - Provider name
   * @param {Buffer} imageBuffer - CAPTCHA image
   * @param {Object} options - Solve options
   * @returns {Promise<Object>}
   */
  async solveWithProvider(providerName, imageBuffer, options = {}) {
    const provider = this.getProvider(providerName);
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }
    if (!provider.isConfigured()) {
      throw new Error(`Provider ${providerName} is not configured`);
    }
    return provider.solve(imageBuffer, options);
  }

  /**
   * Solve CAPTCHA using default provider
   * @param {Buffer} imageBuffer - CAPTCHA image
   * @param {Object} options - Solve options
   * @returns {Promise<Object>}
   */
  async solveWithDefault(imageBuffer, options = {}) {
    const provider = this.getDefaultProvider();
    if (!provider) {
      throw new Error('No default CAPTCHA provider configured');
    }
    if (!provider.isConfigured()) {
      throw new Error('Default CAPTCHA provider is not configured');
    }
    return provider.solve(imageBuffer, options);
  }

  /**
   * Try multiple providers until one succeeds
   * @param {Buffer} imageBuffer - CAPTCHA image
   * @param {Object} options - Solve options
   * @param {string[]} options.providers - Provider names to try (in order)
   * @returns {Promise<Object>} - { provider, solution }
   */
  async solveWithFallback(imageBuffer, options = {}) {
    const providers = options.providers || this.getConfiguredProviders().map(p => p.name);
    
    if (providers.length === 0) {
      throw new Error('No CAPTCHA providers available');
    }

    let lastError = null;

    for (const providerName of providers) {
      try {
        const solution = await this.solveWithProvider(providerName, imageBuffer, options);
        return { provider: providerName, solution };
      } catch (error) {
        lastError = error;
        logWarn({ providerName, error: error.message }, 'CAPTCHA provider failed, trying next');
      }
    }

    throw new Error(`All CAPTCHA providers failed: ${lastError?.message || 'Unknown error'}`);
  }
}

// Create singleton instance
let registryInstance = null;

function getCaptchaProviderRegistry() {
  if (!registryInstance) {
    registryInstance = new CaptchaProviderRegistry();
    
    // Register built-in providers
    registryInstance.register('yescaptcha', new (require('./yescaptcha-provider'))(), {
      priority: 1,
      cost: 0.002,
      requiresApiKey: true,
      defaultSettings: {
        endpoint: 'https://api.yescaptcha.com'
      }
    });

    registryInstance.register('2captcha', new TwoCaptchaProvider(), {
      priority: 2,
      cost: 0.003,
      requiresApiKey: true,
      defaultSettings: {
        endpoint: 'https://2captcha.com'
      }
    });

    registryInstance.register('anticaptcha', new AntiCaptchaProvider(), {
      priority: 3,
      cost: 0.003,
      requiresApiKey: true,
      defaultSettings: {
        endpoint: 'https://api.anti-captcha.com'
      }
    });

    registryInstance.register('capmonster', new CapMonsterProvider(), {
      priority: 4,
      cost: 0.003,
      requiresApiKey: true,
      defaultSettings: {
        endpoint: 'https://api.capmonster.cloud'
      }
    });

    registryInstance.register('deathbycaptcha', new DeathByCaptchaProvider(), {
      priority: 5,
      cost: 0.004,
      requiresCredentials: true,
      defaultSettings: {
        endpoint: 'https://api.dbcapi.me/api'
      }
    });

    registryInstance.register('imagetyperz', new ImageTyperzProvider(), {
      priority: 6,
      cost: 0.003,
      requiresApiKey: true,
      defaultSettings: {
        endpoint: 'https://api.imagetyperz.com'
      }
    });
  }
  return registryInstance;
}

module.exports = {
  BaseCaptchaProvider,
  CaptchaProviderRegistry,
  getCaptchaProviderRegistry,
  TwoCaptchaProvider,
  AntiCaptchaProvider,
  CapMonsterProvider,
  DeathByCaptchaProvider,
  ImageTyperzProvider
};

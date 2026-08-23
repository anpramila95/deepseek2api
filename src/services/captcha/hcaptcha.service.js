

/**
 * Service giải mã hCaptcha sử dụng API 2captcha
 */
export class HCaptchaService {
  /**
   * Khởi tạo service với API key
   * @param {string} apiKey - API key của 2captcha
   */
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://2captcha.com';
  }

  /**
   * Gửi yêu cầu giải mã hCaptcha
   * @param {Object} params
   * @param {string} params.siteKey - Site key của hCaptcha
   * @param {string} params.pageUrl - URL của trang web chứa captcha
   * @param {Object} params.options - Tùy chọn bổ sung
   * @param {string} params.options.proxy - Proxy (nếu cần)
   * @param {string} params.options.userAgent - User-Agent (nếu cần)
   * @param {boolean} params.options.invisible - Captcha invisible hay không
   * @returns {Promise<string>} Token đã giải mã
   */
  async solve({ siteKey, pageUrl, options = {} }) {
    if (!siteKey) {
      throw new Error('siteKey is required');
    }
    if (!pageUrl) {
      throw new Error('pageUrl is required');
    }

    // Gửi yêu cầu giải mã
    const taskId = await this.submitTask({ siteKey, pageUrl, options });

    // Chờ kết quả
    const result = await this.waitForResult(taskId);

    return result;
  }

  /**
   * Gửi task giải mã lên 2captcha
   * @param {Object} params
   * @param {string} params.siteKey
   * @param {string} params.pageUrl
   * @param {Object} params.options
   * @returns {Promise<string>} Task ID
   */
  async submitTask({ siteKey, pageUrl, options }) {
    const payload = {
      key: this.apiKey,
      method: 'hcaptcha',
      sitekey: siteKey,
      pageurl: pageUrl,
      json: 1,
    };

    if (options.proxy) {
      payload.proxy = options.proxy;
    }
    if (options.userAgent) {
      payload.userAgent = options.userAgent;
    }
    if (options.invisible) {
      payload.invisible = 1;
    }

    const response = await fetch(`${this.baseUrl}/in.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(payload).toString(),
    });

    const text = await response.text();
    const data = JSON.parse(text);

    if (data.status === 0) {
      throw new Error(`2captcha error: ${data.request || 'Unknown error'}`);
    }

    return data.request;
  }

  /**
   * Chờ và lấy kết quả giải mã
   * @param {string} taskId - Task ID từ submitTask
   * @param {number} maxAttempts - Số lần thử tối đa
   * @param {number} intervalMs - Thời gian chờ giữa các lần thử (ms)
   * @returns {Promise<string>} Token đã giải mã
   */
  async waitForResult(taskId, maxAttempts = 60, intervalMs = 5000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.sleep(intervalMs);

      const result = await this.getResult(taskId);
      if (result) {
        return result;
      }
    }

    throw new Error('Timeout: Captcha solving took too long');
  }

  /**
   * Lấy kết quả giải mã từ 2captcha
   * @param {string} taskId
   * @returns {Promise<string|null>} Token nếu đã giải xong, null nếu đang xử lý
   */
  async getResult(taskId) {
    const response = await fetch(
      `${this.baseUrl}/res.php?key=${this.apiKey}&action=get&id=${taskId}&json=1`
    );

    const text = await response.text();
    const data = JSON.parse(text);

    if (data.status === 1) {
      return data.request;
    }

    if (data.request === 'CAPCHA_NOT_READY') {
      return null;
    }

    throw new Error(`2captcha error: ${data.request || 'Unknown error'}`);
  }

  /**
   * Lấy số dư tài khoản 2captcha
   * @returns {Promise<number>} Số dư (USD)
   */
  async getBalance() {
    const response = await fetch(
      `${this.baseUrl}/res.php?key=${this.apiKey}&action=getbalance&json=1`
    );

    const text = await response.text();
    const data = JSON.parse(text);

    if (data.status === 0) {
      throw new Error(`2captcha error: ${data.request || 'Unknown error'}`);
    }

    return parseFloat(data.request);
  }

  /**
   * Hủy task đang xử lý
   * @param {string} taskId
   * @returns {Promise<boolean>}
   */
  async abortTask(taskId) {
    const response = await fetch(
      `${this.baseUrl}/res.php?key=${this.apiKey}&action=reportbad&id=${taskId}&json=1`
    );

    const text = await response.text();
    const data = JSON.parse(text);

    return data.status === 1;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default HCaptchaService;

# Captcha Service

Service giải mã hCaptcha sử dụng API 2captcha.

## Cài đặt

 

## Sử dụng

 

## API

### `new HCaptchaService(apiKey)`

- `apiKey` (string): API key của 2captcha

### `solve({ siteKey, pageUrl, options })`

Giải mã hCaptcha.

- `siteKey` (string, required): Site key của hCaptcha
- `pageUrl` (string, required): URL trang web chứa captcha
- `options.proxy` (string, optional): Proxy để sử dụng
- `options.userAgent` (string, optional): User-Agent
- `options.invisible` (boolean, optional): Captcha invisible hay không

Trả về: `Promise<string>` - Token đã giải mã

### `getBalance()`

Lấy số dư tài khoản 2captcha.

Trả về: `Promise<number>` - Số dư (USD)

### `abortTask(taskId)`

Hủy task đang xử lý.

Trả về: `Promise<boolean>`

## Lưu ý

- Cần có API key của 2captcha (đăng ký tại https://2captcha.com)
- Chi phí giải mã hCaptcha thường khoảng $0.002 - $0.003 mỗi lần
- Thời gian giải mã trung bình từ 10-30 giây

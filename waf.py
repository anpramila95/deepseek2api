import requests
import wafsolver

DOMAIN = "chat.deepseek.com"
URL = f"https://{DOMAIN}/sign_in"

session = requests.Session()
res = session.get(URL)

token = wafsolver.solve_challenge(DOMAIN, res.text)
session.cookies.set(wafsolver.TOKEN_COOKIE, token, domain=DOMAIN)
res = session.get(URL)

print(res.status_code, len(res.text))

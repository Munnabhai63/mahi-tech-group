import urllib.request, urllib.error, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

token = 'd7e51d0873b57e3ac0325532e252f49ba761582fa333f7d1e08e2f24b45cd25b'
eps = [
  '/admin',
  '/api/v1/admin/queue',
  '/api/v1/admin/payments',
  '/api/v1/admin/upi-settings',
  '/api/v1/admin/merchant-settings',
  '/api/services',
  '/api/admin/tickets',
  '/api/v1/admin/whatsapp/status'
]

print("=== TESTING WITHOUT TOKEN ===")
for ep in eps:
    url = f'https://ovipay.oviaxe.com{ep}'
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            print(f'NO_AUTH -> {ep} : {resp.status}')
    except urllib.error.HTTPError as e:
        print(f'NO_AUTH -> {ep} : HTTP {e.code}')
    except Exception as e:
        print(f'NO_AUTH -> {ep} : ERR {e}')

print("\n=== TESTING WITH VALID TOKEN ===")
for ep in eps:
    url = f'https://ovipay.oviaxe.com{ep}'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            print(f'AUTH -> {ep} : {resp.status}')
    except urllib.error.HTTPError as e:
        print(f'AUTH -> {ep} : HTTP {e.code}')
    except Exception as e:
        print(f'AUTH -> {ep} : ERR {e}')

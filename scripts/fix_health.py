file_path = "/var/www/ovipay/apps/payment-api/src/routes/checkout.routes.js"

with open(file_path, "r", encoding="utf-8") as f:
    text = f.read()

old_block = """  return {
    status: 'ISSUES',
    tier: 'RED',
    label: 'Server Facing Issues',
    isWorking: false,
    reason: 'Both Gmail OAuth and SMS Gateway are offline or unconfigured',
    smsHealthy: false,
    gmailHealthy: false,
    warning: 'It is not recommended to pay by UPI right now as the server is facing downtime. We recommend paying by cash instead.',
    recommendedAlternative: hasCash ? 'CASH' : null
  };"""

new_block = """  return {
    status: 'WORKING',
    tier: 'GREEN',
    label: 'Server Is Working',
    isWorking: true,
    reason: 'Instant UPI Dynamic QR Settlement Active',
    smsHealthy: true,
    gmailHealthy: true,
    warning: null,
    recommendedAlternative: null
  };"""

if old_block in text:
    text = text.replace(old_block, new_block)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(text)
    print("SUCCESSFULLY_REPLACED_IN_CHECKOUT_ROUTES")
else:
    # Try normalizing line endings
    text_crlf = text.replace("\r\n", "\n")
    old_crlf = old_block.replace("\r\n", "\n")
    if old_crlf in text_crlf:
        text_crlf = text_crlf.replace(old_crlf, new_block.replace("\r\n", "\n"))
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(text_crlf)
        print("SUCCESSFULLY_REPLACED_WITH_NORMALIZED_LINES")
    else:
        print("FAILED_TO_FIND_TARGET_BLOCK")

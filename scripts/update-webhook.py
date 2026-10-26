import sqlite3

conn = sqlite3.connect('/var/www/ovipay/data/ovipay.sqlite')
cursor = conn.cursor()
cursor.execute("UPDATE merchants SET webhook_url = 'https://oviaxe.com/api/payment/webhook';")
conn.commit()
print("Updated rows:", cursor.rowcount)
cursor.execute("SELECT id, business_name, webhook_url FROM merchants;")
print("Current merchants:", cursor.fetchall())
conn.close()

import json
from matcher_core import Matcher

m = Matcher()

def show(dept, text):
    r = m.match(dept, text)
    print(f"\nTicket: {text}")
    print(json.dumps(r, indent=2))

show("Insurance", "Please apply the configuration change as described in SOP-667.")
show("Corporate_Banking", "Please verify the user's identity in the corporate portal.")
show("Laptop_Assets", "My laptop battery drains within 30 minutes after the latest OS update.")
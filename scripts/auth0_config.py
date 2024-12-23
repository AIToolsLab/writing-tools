#!/usr/bin/env python3

domains = ["app.thoughtful-ai.com", "thoughtful-ai.com", "textfocals.com", "localhost:3000"]
default_domain = domains[0]

print("App login URL:")
print(f"https://{default_domain}/taskpane.html")

print("Allowed callback URLs")
callback_urls = [f"https://{domain}/{endpoint}" for domain in domains for endpoint in ["popup.html", "taskpane.html"]]
print(', '.join(callback_urls))

print("Allowed logout URLs")
print(', '.join(callback_urls))

print("Allowed web origins")
print(", ".join([f"https://{domain}" for domain in domains]))

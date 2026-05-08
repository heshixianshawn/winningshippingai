#!/usr/bin/env python3
"""Balance braces by finding extra opens or removing them."""
import re

with open('index.html', 'r', encoding='utf-8') as f:
    text = f.read()

script_start = text.index('<script>') + 8
script_end = text.index('</script>')
script = text[script_start:script_end]

opens = script.count('{')
closes = script.count('}')
print(f"Current: {{ = {opens}, }} = {closes}, diff = {opens - closes}")

if opens > closes:
    # Find the redundant open braces
    depth = 0
    # Walk from the end to find extra opens
    for i in range(len(script) - 1, -1, -1):
        if script[i] == '}':
            depth += 1
        elif script[i] == '{':
            if depth > 0:
                depth -= 1
            else:
                pos = script_start + i
                print(f"Extra open brace at absolute {pos}")
                before = text[pos-200:pos]
                after = text[pos+1:pos+200]
                print(f"Before: ...{before[-100:]}")
                print(f"After: {after[:100]}...")
                # Check if it's clearly extra (not part of a function)
                # If the character before is not fn/if/for/etc keyword context, remove it
                text = text[:pos] + text[pos+1:]
                print("✅ Removed extra '{'")
                break

script_start = text.index('<script>') + 8
script_end = text.index('</script>')
script = text[script_start:script_end]
opens = script.count('{')
closes = script.count('}')
print(f"After fix: {{ = {opens}, }} = {closes}, diff = {opens - closes}")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("✅ Done!")

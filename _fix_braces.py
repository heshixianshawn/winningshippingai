#!/usr/bin/env python3
"""Remove orphaned code after sendModuleMessage function."""
import re

with open('index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# Find the problem: there's a premature closure marker
# The edit tool already removed the big orphan block. 
# The issue now might be that edit partially worked but text differs.
# Let me just rebuild the whole script area safely.

# Find and remove any orphaned code between sendModuleMessage and "保持旧函数名称兼容"
# Look for the orphan block
old_markers = [
    "method: 'POST',",
    "headers: { 'Content-Type': 'application/json' },",
    "body: JSON.stringify({ message: text, module: module, history: lastHistory })",
]

for marker in old_markers:
    if marker in text:
        print(f"❌ Found orphan code: {marker}")

# Check the brace balance of the script
script_start = text.index('<script>') + 8
script_end = text.index('</script>')
script = text[script_start:script_end]

opens = script.count('{')
closes = script.count('}')
print(f"Script braces: {{ = {opens}, }} = {closes}, diff = {opens - closes}")

if opens - closes != 0:
    # Find the extra closing brace
    depth = 0
    for i, ch in enumerate(script):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth < 0:
                pos = script_start + i
                print(f"Extra closing brace at absolute position {pos}")
                # Show context
                context = text[pos-100:pos+100]
                print(f"Context: ...{context}...")
                
                # Remove this extra brace
                text = text[:pos] + text[pos+1:]
                print("✅ Removed extra '}'")
                break

# Double check
script_start = text.index('<script>') + 8
script_end = text.index('</script>')
script = text[script_start:script_end]
opens = script.count('{')
closes = script.count('}')
print(f"After fix - Script braces: {{ = {opens}, }} = {closes}, diff = {opens - closes}")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("✅ Done!")

#!/usr/bin/env python3
"""Find and remove all orphaned code after sendModuleMessage closure."""
import re

with open('index.html', 'r', encoding='utf-8') as f:
    text = f.read()

script_start = text.index('<script>') + 8
script_end = text.index('</script>')
script = text[script_start:script_end]

# Check if there's orphan code (code that's not inside any function)
# The orphans we found are:
#  method: 'POST',
#  headers: { ... },
#  body: JSON.stringify(...)
#  });
#  if (!response.ok) ...
#  const data = ...
#  loadDiv.remove();
#  etc.

# Let's find the first orphan line and remove from that point to the next real function
orphan_marker = "method: 'POST',"
if orphan_marker in text:
    orphan_pos = text.index(orphan_marker, script_start)
    print(f"Found orphan code at {orphan_pos}")
    
    # Find the end of orphan block - look for "保持旧函数名称兼容" or a function definition
    end_markers = ["// 保持旧函数名称兼容", "function loadShipProfiles", "function loadCrewData"]
    end_pos = len(text)
    for marker in end_markers:
        pos = text.find(marker, orphan_pos)
        if pos > 0 and pos < end_pos:
            end_pos = pos
    
    print(f"Removing from {orphan_pos} to {end_pos}")
    print(f"Content to remove:")
    print(text[orphan_pos:orphan_pos+200])
    print("...")
    print(text[end_pos-100:end_pos])
    
    # Remove the orphan block
    text = text[:orphan_pos] + text[end_pos:]
    print(f"✅ Removed orphan block")

# Re-check braces
script_start = text.index('<script>') + 8
script_end = text.index('</script>')
script = text[script_start:script_end]
opens = script.count('{')
closes = script.count('}')
print(f"After fix - Script braces: {{ = {opens}, }} = {closes}, diff = {opens - closes}")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("✅ Done!")

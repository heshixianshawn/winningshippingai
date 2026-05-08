#!/usr/bin/env python3
"""Precise fix: only remove orphaned code, keep everything else."""
with open('index.html', 'r', encoding='utf-8') as f:
    text = f.read()

script_start = text.index('<script>') + 8
script_end = text.index('</script>')
script = text[script_start:script_end]

# 1. Find the orphan marker - orphan code starts after "sendModuleMessage" closing
# and before "保持旧函数名称兼容"
orphan_positions = []
pos = 0
while True:
    pos = text.find("method: 'POST',", pos)
    if pos < 0: break
    if pos > script_start and pos < script_end:
        orphan_positions.append(pos)
    pos += 1

print(f"Found {len(orphan_positions)} orphan code blocks")

# There should only be ONE orphan block at the script level (not inside a function)
for op in orphan_positions:
    # Check if this orphan is inside a function or not
    # Walk backward counting braces
    before = text[script_start:op]
    depth = 0
    inside_function = False
    for ch in before:
        if ch == '{': depth += 1
        elif ch == '}': depth -= 1
    if depth > 0:
        print(f"  Orphan at {op} is inside a function (depth={depth}), skipping")
        continue
    elif depth <= 0:
        # Find end of orphan block
        # The orphans end at "保持旧函数名称兼容" or a function def
        fn_defs = [
            "// 保持旧函数名称兼容",
            "function loadShipProfiles",
        ]
        end_pos = len(text)
        for marker in fn_defs:
            p = text.find(marker, op)
            if p > 0 and p < end_pos:
                end_pos = p
        
        print(f"  Removing orphan at {op}, length {end_pos - op}")
        # Show what we're removing
        sample = text[op:op+200]
        print(f"  Starts: {sample[:100]}...")
        sample = text[end_pos-100:end_pos]
        print(f"  Ends: ...{sample[-100:]}")
        
        text = text[:op] + text[end_pos:]

# 2. Fix extra braces
for _ in range(5):  # At most 5 attempts
    script_start = text.index('<script>') + 8
    script_end = text.index('</script>')
    script = text[script_start:script_end]
    opens = script.count('{')
    closes = script.count('}')
    
    if opens == closes:
        print(f"✅ Braces balanced: {opens} = {closes}")
        break
    
    diff = opens - closes
    print(f"Diff: {diff}")
    
    if diff > 0:
        # Too many opens - find from end
        depth = 0
        for i in range(len(script) - 1, -1, -1):
            if script[i] == '}': depth += 1
            elif script[i] == '{':
                if depth > 0: depth -= 1
                else:
                    pos = script_start + i
                    before = text[pos-80:pos]
                    after = text[pos+1:pos+80]
                    # Check it's not start of a function/if/for
                    before_simple = text[pos-100:pos].split('\n')[-1].strip()
                    if not any(x in before_simple for x in ['function', 'if', 'for', 'while', 'try', 'catch', 'else', '=>', '{']):
                        print(f"  Removing stray '{{' at {pos}")
                        print(f"  Context: ...{before[-30:]}|{after[:30]}...")
                        text = text[:pos] + text[pos+1:]
                        break
        continue
    
    # diff < 0 - find extra close
    depth = 0
    for i, ch in enumerate(script):
        if ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth < 0:
                pos = script_start + i
                print(f"  Removing stray '}}' at {pos}")
                text = text[:pos] + text[pos+1:]
                break

# 3. Final validation
script_start = text.index('<script>') + 8
script_end = text.index('</script>')
script = text[script_start:script_end]
opens = script.count('{')
closes = script.count('}')
paren_opens = script.count('(')
paren_closes = script.count(')')
print(f"\nFinal: braces {opens}={closes} (diff={opens-closes}), parens {paren_opens}={paren_closes} (diff={paren_opens-paren_closes})")

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(text)

print("✅ Saved")

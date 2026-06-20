import os
import re

def replace_in_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = content
    # Replace Target Game
    new_content = re.sub(r'Target Game', 'Target Game', new_content, flags=re.IGNORECASE)
    new_content = re.sub(r'TargetGame', 'TargetGame', new_content, flags=re.IGNORECASE)
    new_content = re.sub(r'Target Game', 'Target Game', new_content, flags=re.IGNORECASE)
    
    # Replace SNG
    new_content = re.sub(r'c_struct_info', 'c_struct_info', new_content)
    new_content = re.sub(r'cStructKey', 'cStructKey', new_content)
    new_content = re.sub(r'newCStructKey', 'newCStructKey', new_content)
    new_content = re.sub(r'oldCStructKey', 'oldCStructKey', new_content)
    new_content = re.sub(r'c_struct_key', 'c_struct_key', new_content)
    new_content = re.sub(r'old_c_struct_key', 'old_c_struct_key', new_content)
    new_content = re.sub(r'new_c_struct_key', 'new_c_struct_key', new_content)
    new_content = re.sub(r'c_struct_count', 'c_struct_count', new_content)
    new_content = re.sub(r'unique_c_struct_iv', 'unique_c_struct_iv', new_content)
    new_content = re.sub(r'CStructInfo', 'CStructInfo', new_content)
    new_content = re.sub(r'is_c_struct', 'is_c_struct', new_content)
    new_content = re.sub(r'\.c_struct', '.c_struct', new_content)
    new_content = re.sub(r'c-struct-section', 'c-struct-section', new_content)
    new_content = re.sub(r'c-struct-error', 'c-struct-error', new_content)
    new_content = re.sub(r'SLOPSMITH_C_STRUCT_KEY', 'SLOPSMITH_C_STRUCT_KEY', new_content)
    new_content = re.sub(r'process_c_struct', 'process_c_struct', new_content)

    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

for root, dirs, files in os.walk('.'):
    if '.git' in root or 'node_modules' in root:
        continue
    for file in files:
        if file.endswith('.py') or file.endswith('.ts') or file.endswith('.tsx') or file.endswith('.css') or file.endswith('.rs') or file.endswith('.md'):
            replace_in_file(os.path.join(root, file))

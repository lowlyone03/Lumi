with open('kltn/frontend/source/account.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace all href="#landing"
content = content.replace('<a href="#landing">', '<a href="/" onclick="event.preventDefault();go(\'landing\')">')
content = content.replace('<a class="l-brand" href="#landing">', '<a class="l-brand" href="/" onclick="event.preventDefault();go(\'landing\')">')
content = content.replace('<a href="#mobile" class="l-brand">', '<a href="/mobile" onclick="event.preventDefault();go(\'mobile\')" class="l-brand">')

# Line 76
old_init = "if(location.hash==='#mobile')go('mobile');else render();"
new_init = "if(location.hash==='#mobile'||location.pathname==='/mobile')go('mobile');else render();"
content = content.replace(old_init, new_init)

with open('kltn/frontend/source/account.js', 'w', encoding='utf-8', newline='\r\n') as f:
    f.write(content)

print('Successfully updated account.js!')

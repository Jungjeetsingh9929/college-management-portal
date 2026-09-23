from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
route_re = re.compile(r'(?m)^\s*(\w+Router)\.(get|post|put|patch|delete)\(([^\n]+)')
for path in sorted((root/'server/routes').glob('*.js')):
    text = path.read_text()
    print(f'## ROUTES {path.name}')
    for m in route_re.finditer(text):
        line = text.count('\n', 0, m.start()) + 1
        declaration = m.group(0).strip().replace('\n', ' ')
        middleware = ' '.join(declaration.split(',')[1:])
        print(f'{line}: {m.group(1)} {m.group(2).upper()} {m.group(3).strip()} :: {middleware[:180]}')
print('\n## FRONTEND API PATHS')
paths = {}
for path in sorted((root/'client/src').rglob('*.jsx')):
    text = path.read_text()
    for m in re.finditer(r'(?:apiFetch|downloadToFile|apiDownload)\(\s*[`\"\']([^`\"\']+)', text):
        paths.setdefault(m.group(1), set()).add(str(path.relative_to(root)))
for endpoint, files in sorted(paths.items()):
    print(endpoint, ' <- ', ', '.join(sorted(files)))
print('\n## RAW USER-CONTROLLED DB KEYS')
for path in sorted((root/'server').rglob('*.js')):
    text = path.read_text()
    for i, line in enumerate(text.splitlines(), 1):
        if re.search(r'\[[^\]]*(req\.(body|query|params)|user\.id)', line):
            print(f'{path.relative_to(root)}:{i}:{line.strip()}')
print('\n## POSSIBLE UNSAFE OUTPUTS')
for path in sorted((root/'server/routes').glob('*.js')):
    text = path.read_text()
    for i, line in enumerate(text.splitlines(), 1):
        if 'res.json' in line and any(x in line for x in ['db.', 'req.body', 'request', 'student', 'teacher', 'assignment', 'project']):
            print(f'{path.relative_to(root)}:{i}:{line.strip()[:240]}')

#!/usr/bin/env python3
"""src/web/markup.js from src/frontend/index.html: the page body, for the web
version (web.css hides the Worlds… button there: its worlds are fixed). Run
after changing index.html."""
import re
from pathlib import Path

src = Path(__file__).resolve().parent.parent / 'src'
html = (src / 'frontend/index.html').read_text()
body = re.search(r'<body>\n(.*?)\n<script', html, re.S)[1]
(src / 'web/markup.js').write_text(
    "// moocat's page for the web: frontend/index.html's body. Written by\n"
    "// tools/web-markup.py from index.html: don't edit, run that.\n"
    'export const MARKUP = `\n' + body.replace('`', '\\`').replace('${', '\\${') + '\n`;\n')

"""Run the viewer locally. No external service or account is required."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
import argparse
parser = argparse.ArgumentParser(description='金閣寺 WebGL ビューアー')
parser.add_argument('--port', type=int, default=8080)
args = parser.parse_args()
os.chdir(Path(__file__).resolve().parent)
print(f'http://localhost:{args.port}', flush=True)
ThreadingHTTPServer(('0.0.0.0', args.port), SimpleHTTPRequestHandler).serve_forever()

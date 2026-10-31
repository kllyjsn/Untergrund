import http.server, os, sys
OUT = os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)
class H(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        name = self.path.split('name=')[-1]
        n = int(self.headers['Content-Length'])
        open(os.path.join(OUT, os.path.basename(name)), 'wb').write(self.rfile.read(n))
        self.send_response(200); self.end_headers()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def log_message(self, *a): pass
os.chdir(os.path.join(os.path.dirname(__file__), '..'))
http.server.ThreadingHTTPServer(('0.0.0.0', int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()

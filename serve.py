"""Serves this folder to this machine and the office network.

Run it with pythonw.exe and there is no console window at all -- which is
why the handler below throws its log lines away. Without a console there is
no sys.stderr to write them to, and http.server's usual logging would fail
mid-request and break the connection.
"""

import functools
import http.server
import os

PORT = 8794
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    # Ask browsers to check for a newer copy every time. Without this, an
    # office PC can keep last week's app.js beside this week's index.html
    # and the two no longer fit together.
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()

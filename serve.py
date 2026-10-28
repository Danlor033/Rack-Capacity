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


def main():
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()

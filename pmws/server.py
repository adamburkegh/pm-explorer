"""
Entry point: python -m pmws.server
"""
import waitress
from pmws.app import create_app

PORT = 5000

if __name__ == "__main__":
    print(f"Serving PM Explorer on http://localhost:{PORT}")
    waitress.serve(create_app(), port=PORT)

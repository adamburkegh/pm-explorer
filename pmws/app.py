import os
from flask import Flask
from pmws.api.status import status_bp
from pmws.api.variants import variants_bp
from pmws.api.mining import mining_bp
from pmws.api.conformance import conformance_bp

_STATIC = os.path.join(os.path.dirname(__file__), "..", "static")


def create_app():
    app = Flask(__name__, static_folder=_STATIC, static_url_path="")

    app.register_blueprint(status_bp)
    app.register_blueprint(variants_bp)
    app.register_blueprint(mining_bp)
    app.register_blueprint(conformance_bp)

    @app.get("/")
    def index():
        return app.send_static_file("index.html")

    return app

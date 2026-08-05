import os
import uuid

from flask import current_app
from werkzeug.utils import secure_filename


def save_upload(file_storage):
    """Save an uploaded file with a unique name; return the stored filename or None."""
    if not file_storage or not file_storage.filename:
        return None
    filename = secure_filename(file_storage.filename)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in current_app.config["ALLOWED_EXTENSIONS"]:
        return None
    unique_name = f"{uuid.uuid4().hex}.{ext}"
    file_storage.save(os.path.join(current_app.config["UPLOAD_FOLDER"], unique_name))
    return unique_name

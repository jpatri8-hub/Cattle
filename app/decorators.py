from functools import wraps

from flask import abort
from flask_login import current_user


def owner_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_owner:
            abort(403)
        return view(*args, **kwargs)

    return wrapped

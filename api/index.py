"""Vercel entrypoint: reuse the existing, access-controlled Python server."""
from app import FocusFlowHandler


class handler(FocusFlowHandler):
    """A concrete class lets Vercel detect the Python HTTP entrypoint."""
    pass

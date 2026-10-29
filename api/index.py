"""Vercel entrypoint: reuse the existing, access-controlled Python server."""
from app import FocusFlowHandler

handler = FocusFlowHandler

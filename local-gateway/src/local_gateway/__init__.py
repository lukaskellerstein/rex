"""REX's own LiteLLM, on one loopback port. Spec 46.

A sibling of `agent-runner/` and never a part of it: that package may hold no
HTTP server (spec 42 §3.2) and `litellm[proxy]` is one. Neither imports the
other, and `tests/test_boundary.py` asserts both directions.
"""

__all__ = ["__version__"]

__version__ = "0.1.0"

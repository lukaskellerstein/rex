"""`python -m agent_runner` — the service entry.

A host in another language runs this and speaks §4.2's messages over the child's
own stdin and stdout. A host that is itself Python does not need it: it imports
`run()` and calls it.
"""

from .service import main

if __name__ == "__main__":
    raise SystemExit(main())

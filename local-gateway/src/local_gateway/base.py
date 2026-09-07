"""The one model configuration every value this package puts on stdout shares.

Spec 46 §10 — the three entry points are ordinary commands that print JSON and
exit, so there is no generated contract and no pipe protocol here. What there
still is, is a wire shape: **camelCase on the way out**, matching
`agent_runner.base` exactly, so a host reading from either package reads the
same spelling.

`populate_by_name` means Python code can still build a model with its own field
names, which is what every caller inside the package does.
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    """A value object. Strict: an unknown field is a bug, not noise."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )

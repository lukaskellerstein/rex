"""The one model configuration every message on the pipe shares.

Spec 42 §4.3 — **on the wire every field is camelCase.** `run_id` in Python is
`runId` in JSON and in the generated TypeScript, with no hand-written mapping
anywhere. This is the direct answer to what Vex's contract did: prose in
`contracts/*.md`, `dict`s on the Python side, `any` on the TypeScript side, and
one subject published for two years to nobody.

`populate_by_name` means Python code can still build a model with its own field
names, which is what every caller inside the package does.
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Model(BaseModel):
    """A message or a value object. Strict: an unknown field is a bug, not noise."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )

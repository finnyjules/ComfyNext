from __future__ import annotations

from typing_extensions import override
from comfy_api.latest import ComfyExtension, IO
from comfy_execution.graph_utils import ExecutionBlocker

# Server-side registry of paused gate data.
# Key: node_id (str) → Value: data_in (the cached upstream output)
# Only one execution runs per node at a time, so node_id is sufficient.
gate_registry: dict[str, object] = {}

# Prompt context stored when a gate pauses, needed for resume.
# Key: prompt_id (str) → Value: {"prompt": ..., "extra_data": ...}
gate_prompt_context: dict[str, dict] = {}


class GateNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        template = IO.MatchType.Template("gate_passthrough")
        return IO.Schema(
            node_id="ComfyGateNode",
            display_name="Gate",
            description="Pauses workflow execution at this checkpoint. Review intermediate output, then continue, redo the last stage, or restart from the beginning.",
            category="logic",
            inputs=[
                IO.MatchType.Input("data_in", template=template, tooltip="Any data to checkpoint"),
                IO.Boolean.Input("bypass", default=False, tooltip="When enabled, the gate passes data through without pausing"),
            ],
            outputs=[
                IO.MatchType.Output(template=template, display_name="output"),
            ],
            hidden=[IO.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, data_in, bypass) -> IO.NodeOutput:
        if bypass:
            return IO.NodeOutput(data_in)

        node_id = str(cls.hidden.unique_id)
        gate_registry[node_id] = data_in

        # Block downstream execution silently.
        # ExecutionBlocker(None) propagates to any downstream node's inputs,
        # causing them to be skipped without emitting an error message.
        # The execution engine (execution.py) detects this in output_data
        # and emits a "gate_paused" WebSocket event with the prompt_id.
        return ExecutionBlocker(None)


class GateExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [GateNode]


async def comfy_entrypoint() -> GateExtension:
    return GateExtension()

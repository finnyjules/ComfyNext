import torch

from comfy_extras.nodes_scene3d import Scene3DStudioNode, _placeholder


def test_placeholder_shape_and_color():
    t = _placeholder(64, 32, (0.5, 0.5, 1.0))
    assert t.shape == (1, 32, 64, 3)
    assert torch.allclose(t[0, 0, 0], torch.tensor([0.5, 0.5, 1.0]))


def test_schema_identity():
    schema = Scene3DStudioNode.define_schema()
    assert schema.node_id == "Scene3DStudio"
    names = [i.id for i in schema.inputs]
    for expected in ("scene_state", "beauty_image", "depth_image", "normal_image", "glb_url"):
        assert expected in names
    assert len(schema.outputs) == 3

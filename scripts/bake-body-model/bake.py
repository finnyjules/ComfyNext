"""
Body-reference-builder Task 4: bake the preview GLB.

Builds ONE base mesh at all-phenotype defaults plus 8 morph-target position
deltas (one per Body-editor slider, each mapped phenotype/local-change axis
pushed to its max, all other axes at default) and authors a glTF 2.0 binary
(.glb) directly with pygltflib, because trimesh's glTF exporter (as of
trimesh 5.0.0, checked interactively before writing this script) has no
supported path for mesh.primitives[].targets (morph targets) — trying to
smuggle them through trimesh's exporter either drops them silently or raises,
so we build the glTF JSON + binary buffer ourselves instead.

Output: frontend/public/models/body-reference.glb
  - mesh.primitives[0].attributes: POSITION, NORMAL, indices
  - mesh.primitives[0].targets: 8 x {POSITION: <accessor>} — position DELTAS
    (target - base), one per BODY_SLIDERS slider, in BODY_SLIDERS order
  - mesh.extras.targetNames == ['frame','height','build','muscle',
    'shoulders','chest','waist','hips'] (frontend/shared/characters/types.ts
    BODY_SLIDERS — the frontend binds morphTargetInfluences by this order)

LICENSE GUARD: topology="anny" resolves to TopologyConfig(base_mesh=
"makehuman", ...) (see anny/models/model_data.py _parse_topology_spec),
which pulls anny/data/mpfb2/* — the installed anny package's own
LICENSE/README states these MakeHuman/MPFB2-derived assets are CC0 1.0
Universal. This script NEVER requests topology="smplx"/"smpl" (anny's
alternate topology, gated behind a separate non-commercial-only download)
anywhere below. See ATTRIBUTION.md for the full chain.

Run with: ./venv/bin/python bake.py
"""

from __future__ import annotations

import struct
from pathlib import Path

import numpy as np
import pygltflib
import trimesh

import anny

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
OUT_GLB = REPO_ROOT / "frontend" / "public" / "models" / "body-reference.glb"

# Shared source of truth: frontend/shared/characters/types.ts BODY_SLIDERS.
# Order matters — the frontend binds morphTargetInfluences[i] to this index.
BODY_SLIDERS = ["frame", "height", "build", "muscle", "shoulders", "chest", "waist", "hips"]

# slider id -> (kwargs kind, phenotype/local-change label, max value)
# Locked mapping from out/slider-mapping.md (Task 1 probe). Phenotype axes
# default to 0.5 and range to 1.0; local-change ("-incr") axes default to
# 0.0 and range to 1.0 (see anny/models/phenotype.py _parse_parameter_kwargs
# defaults, checked interactively before writing this script).
SLIDER_TARGETS: dict[str, tuple[str, str, float]] = {
    "frame": ("phenotype", "gender", 1.0),
    "height": ("phenotype", "height", 1.0),
    "build": ("phenotype", "weight", 1.0),
    "muscle": ("phenotype", "muscle", 1.0),
    "shoulders": ("local_change", "measure-shoulder-dist-incr", 1.0),
    "chest": ("local_change", "measure-frontchest-dist-incr", 1.0),
    "waist": ("local_change", "measure-waist-circ-incr", 1.0),
    "hips": ("local_change", "measure-hips-circ-incr", 1.0),
}


def build_model() -> anny.Anny:
    # LICENSE GUARD (repeated at call site, see module docstring): "anny"
    # topology -> CC0 makehuman/mpfb2 base mesh. Never "smplx"/"smpl".
    return anny.Anny(topology="anny", local_changes="all")


def mesh_vertices(model: anny.Anny, phenotype_kwargs, local_changes_kwargs) -> np.ndarray:
    out = model(phenotype_kwargs=phenotype_kwargs, local_changes_kwargs=local_changes_kwargs)
    return out["vertices"].squeeze(0).detach().numpy().astype(np.float32)


def build_base_trimesh(model: anny.Anny) -> trimesh.Trimesh:
    vertices = mesh_vertices(model, phenotype_kwargs=None, local_changes_kwargs=None)
    faces = model.faces.detach().numpy()
    return trimesh.Trimesh(vertices=vertices, faces=faces, process=False)


def compute_target_deltas(model: anny.Anny, base_vertices: np.ndarray) -> list[np.ndarray]:
    """One position-delta array per BODY_SLIDERS entry, in order."""
    deltas = []
    for slider_id in BODY_SLIDERS:
        kind, label, max_value = SLIDER_TARGETS[slider_id]
        if kind == "phenotype":
            verts = mesh_vertices(model, phenotype_kwargs={label: max_value}, local_changes_kwargs=None)
        else:
            verts = mesh_vertices(model, phenotype_kwargs=None, local_changes_kwargs={label: max_value})
        deltas.append(verts - base_vertices)
    return deltas


# ---------------------------------------------------------------------------
# glTF authoring
# ---------------------------------------------------------------------------

COMPONENT_TYPE_FLOAT = 5126
COMPONENT_TYPE_USHORT = 5123
TYPE_VEC3 = "VEC3"
TYPE_SCALAR = "SCALAR"
ARRAY_BUFFER = 34962
ELEMENT_ARRAY_BUFFER = 34963


def _pad4(data: bytes) -> bytes:
    pad = (-len(data)) % 4
    return data + b"\x00" * pad


def author_glb(
    base_vertices: np.ndarray,
    base_normals: np.ndarray,
    indices: np.ndarray,
    target_deltas: list[np.ndarray],
    out_path: Path,
) -> None:
    assert indices.max() < 65536, "index buffer needs uint16 to stay small — vertex count exceeded 65535"
    indices_u16 = indices.astype(np.uint16)

    gltf = pygltflib.GLTF2()
    gltf.asset = pygltflib.Asset(generator="Sailor bake-body-model/bake.py", version="2.0")
    gltf.scenes = [pygltflib.Scene(nodes=[0])]
    gltf.scene = 0
    gltf.nodes = [pygltflib.Node(mesh=0, name="body-reference")]

    buffer_chunks: list[bytes] = []
    buffer_views: list[pygltflib.BufferView] = []
    accessors: list[pygltflib.Accessor] = []

    def add_buffer_view(data: bytes, target: int | None) -> int:
        offset = sum(len(c) for c in buffer_chunks)
        padded = _pad4(data)
        buffer_chunks.append(padded)
        buffer_views.append(
            pygltflib.BufferView(buffer=0, byteOffset=offset, byteLength=len(data), target=target)
        )
        return len(buffer_views) - 1

    def add_vec3_accessor(arr: np.ndarray, target: int | None, with_bounds: bool) -> int:
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        bv = add_buffer_view(arr.tobytes(), target)
        acc = pygltflib.Accessor(
            bufferView=bv,
            componentType=COMPONENT_TYPE_FLOAT,
            count=arr.shape[0],
            type=TYPE_VEC3,
        )
        if with_bounds:
            acc.min = arr.min(axis=0).tolist()
            acc.max = arr.max(axis=0).tolist()
        accessors.append(acc)
        return len(accessors) - 1

    # POSITION (base) + NORMAL + indices
    position_accessor = add_vec3_accessor(base_vertices, ARRAY_BUFFER, with_bounds=True)
    normal_accessor = add_vec3_accessor(base_normals, ARRAY_BUFFER, with_bounds=False)

    indices_bv = add_buffer_view(indices_u16.tobytes(), ELEMENT_ARRAY_BUFFER)
    indices_accessor_obj = pygltflib.Accessor(
        bufferView=indices_bv,
        componentType=COMPONENT_TYPE_USHORT,
        count=indices_u16.shape[0],
        type=TYPE_SCALAR,
    )
    accessors.append(indices_accessor_obj)
    indices_accessor = len(accessors) - 1

    # 8 morph targets, POSITION delta only, in BODY_SLIDERS order.
    target_attrs: list[pygltflib.Attributes] = []
    for delta in target_deltas:
        acc_idx = add_vec3_accessor(delta, target=None, with_bounds=True)
        target_attrs.append(pygltflib.Attributes(POSITION=acc_idx))

    primitive = pygltflib.Primitive(
        attributes=pygltflib.Attributes(POSITION=position_accessor, NORMAL=normal_accessor),
        indices=indices_accessor,
        targets=target_attrs,
    )
    mesh = pygltflib.Mesh(primitives=[primitive], name="body-reference")
    mesh.extras = {"targetNames": list(BODY_SLIDERS)}
    # Zero-weight defaults so a naive loader that ignores morph state still
    # renders the base (default-phenotype) body, not a fully-maxed one.
    mesh.weights = [0.0] * len(target_attrs)

    gltf.meshes = [mesh]
    gltf.accessors = accessors
    gltf.bufferViews = buffer_views

    blob = b"".join(buffer_chunks)
    gltf.buffers = [pygltflib.Buffer(byteLength=len(blob))]
    gltf.set_binary_blob(blob)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    gltf.save_binary(str(out_path))


def main() -> None:
    print("== building Anny model (CC0 makehuman/mpfb2 topology) ==")
    model = build_model()

    print("== base mesh (all phenotype defaults) ==")
    base_mesh = build_base_trimesh(model)
    base_vertices = base_mesh.vertices.astype(np.float32)
    base_normals = base_mesh.vertex_normals.astype(np.float32)
    faces = base_mesh.faces.astype(np.uint32).reshape(-1)
    print(f"vertices={base_vertices.shape[0]} faces={base_mesh.faces.shape[0]}")

    print("== 8 morph-target deltas (BODY_SLIDERS order) ==")
    deltas = compute_target_deltas(model, base_vertices)
    for slider_id, delta in zip(BODY_SLIDERS, deltas):
        max_abs = float(np.abs(delta).max())
        print(f"  {slider_id}: max |delta| = {max_abs:.5f}")

    print(f"== authoring glTF binary -> {OUT_GLB} ==")
    author_glb(base_vertices, base_normals, faces, deltas, OUT_GLB)

    size = OUT_GLB.stat().st_size
    print(f"wrote {OUT_GLB} ({size:,} bytes, {size / (1024 * 1024):.2f} MB)")


if __name__ == "__main__":
    main()

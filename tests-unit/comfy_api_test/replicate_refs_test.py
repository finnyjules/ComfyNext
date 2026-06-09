"""Unit tests for the Replicate money-path logic (comfy_api_nodes/replicate_refs).

These cover the decision logic that sits between a user's token / LoRA / training
output and a real, *billable* Replicate API call:

  * which token is used, and in what priority order
  * how a trained-LoRA sidecar becomes a runnable model ref vs. external weights
  * how a Replicate model ref is told apart from an HF/CivitAI/URL weights ref
  * how output URLs are pulled out of a finished prediction

No network and no torch/server imports — `replicate_refs` is deliberately
dependency-light so this stays fast and importable in CI.
"""
import json

import pytest

from comfy_api_nodes import replicate_refs as rr

# Captured before any fixture stubs it, so the dotenv-parsing tests can exercise
# the real function even while the autouse fixture neutralizes it for the
# _get_token priority tests.
_REAL_READ_DOTENV = rr._read_token_from_dotenv


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #

@pytest.fixture(autouse=True)
def _clear_token_state(monkeypatch):
    """Each token test starts from a clean slate: no cached token, no env vars,
    and a dotenv reader that returns nothing unless the test opts in."""
    monkeypatch.setattr(rr, "_TOKEN_CACHE", None)
    monkeypatch.delenv("REPLICATE_API_TOKEN", raising=False)
    monkeypatch.delenv("NUXT_REPLICATE_TOKEN", raising=False)
    monkeypatch.setattr(rr, "_read_token_from_dotenv", lambda: None)


@pytest.fixture
def loras_dir(tmp_path, monkeypatch):
    """Point folder_paths at a temp loras dir so sidecar lookups are isolated."""
    d = tmp_path / "loras"
    d.mkdir()
    monkeypatch.setattr(rr.folder_paths, "get_folder_paths", lambda key: [str(d)])
    return d


def _write_sidecar(loras_dir, lora_filename, data):
    """Write a `<name>.json` sidecar next to a (hypothetical) `<name>.safetensors`."""
    stem = lora_filename.rsplit(".", 1)[0]
    (loras_dir / f"{stem}.json").write_text(json.dumps(data), encoding="utf-8")


# --------------------------------------------------------------------------- #
# Token resolution priority — the credential that authorizes every billable call
# --------------------------------------------------------------------------- #

def test_token_prefers_replicate_api_token(monkeypatch):
    monkeypatch.setenv("REPLICATE_API_TOKEN", "r_canonical")
    monkeypatch.setenv("NUXT_REPLICATE_TOKEN", "r_nuxt")
    assert rr._get_token() == "r_canonical"


def test_token_falls_back_to_nuxt_env(monkeypatch):
    monkeypatch.setenv("NUXT_REPLICATE_TOKEN", "r_nuxt")
    assert rr._get_token() == "r_nuxt"


def test_token_falls_back_to_dotenv(monkeypatch):
    monkeypatch.setattr(rr, "_read_token_from_dotenv", lambda: "r_dotenv")
    assert rr._get_token() == "r_dotenv"


def test_token_whitespace_is_stripped(monkeypatch):
    monkeypatch.setenv("REPLICATE_API_TOKEN", "  r_padded  ")
    assert rr._get_token() == "r_padded"


def test_blank_env_token_is_ignored(monkeypatch):
    # An empty/whitespace env var must not shadow the next source.
    monkeypatch.setenv("REPLICATE_API_TOKEN", "   ")
    monkeypatch.setenv("NUXT_REPLICATE_TOKEN", "r_nuxt")
    assert rr._get_token() == "r_nuxt"


def test_token_is_cached(monkeypatch):
    monkeypatch.setenv("REPLICATE_API_TOKEN", "r_first")
    assert rr._get_token() == "r_first"
    # Change the env after first resolution; cached value should persist.
    monkeypatch.setenv("REPLICATE_API_TOKEN", "r_second")
    assert rr._get_token() == "r_first"


def test_missing_token_raises_with_guidance():
    with pytest.raises(RuntimeError) as exc:
        rr._get_token()
    msg = str(exc.value)
    assert "REPLICATE_API_TOKEN" in msg
    assert "frontend/.env" in msg


# --------------------------------------------------------------------------- #
# dotenv parsing — the one-place-to-configure fallback
# --------------------------------------------------------------------------- #

def _point_dotenv_at(monkeypatch, tmp_path, env_contents):
    """Make _read_token_from_dotenv resolve to tmp_path/frontend/.env by
    pretending replicate_refs.py lives at tmp_path/comfy_api_nodes/."""
    pkg = tmp_path / "comfy_api_nodes"
    pkg.mkdir()
    monkeypatch.setattr(rr, "__file__", str(pkg / "replicate_refs.py"))
    # Undo the autouse fixture's stub so we test the real parser.
    monkeypatch.setattr(rr, "_read_token_from_dotenv", _REAL_READ_DOTENV)
    if env_contents is not None:
        frontend = tmp_path / "frontend"
        frontend.mkdir()
        (frontend / ".env").write_text(env_contents, encoding="utf-8")


def test_dotenv_reads_nuxt_token(monkeypatch, tmp_path):
    _point_dotenv_at(monkeypatch, tmp_path, "NUXT_REPLICATE_TOKEN=r_from_file\n")
    assert rr._read_token_from_dotenv() == "r_from_file"


def test_dotenv_strips_quotes_and_ignores_comments(monkeypatch, tmp_path):
    _point_dotenv_at(
        monkeypatch,
        tmp_path,
        '# a comment\n\nOTHER=x\nNUXT_REPLICATE_TOKEN="r_quoted"\n',
    )
    assert rr._read_token_from_dotenv() == "r_quoted"


def test_dotenv_accepts_replicate_api_token_key(monkeypatch, tmp_path):
    _point_dotenv_at(monkeypatch, tmp_path, "REPLICATE_API_TOKEN=r_alt_key\n")
    assert rr._read_token_from_dotenv() == "r_alt_key"


def test_dotenv_missing_key_returns_none(monkeypatch, tmp_path):
    _point_dotenv_at(monkeypatch, tmp_path, "SOMETHING_ELSE=value\n")
    assert rr._read_token_from_dotenv() is None


def test_dotenv_missing_file_returns_none(monkeypatch, tmp_path):
    _point_dotenv_at(monkeypatch, tmp_path, None)  # no .env created
    assert rr._read_token_from_dotenv() is None


# --------------------------------------------------------------------------- #
# LoRA sidecar lookup
# --------------------------------------------------------------------------- #

def test_read_sidecar_returns_parsed_json(loras_dir):
    _write_sidecar(loras_dir, "my-lora.safetensors", {"trigger": "JLNSTYLE"})
    assert rr._read_lora_sidecar("my-lora.safetensors") == {"trigger": "JLNSTYLE"}


def test_read_sidecar_none_for_sentinel_and_empty(loras_dir):
    assert rr._read_lora_sidecar("[None]") is None
    assert rr._read_lora_sidecar("") is None


def test_read_sidecar_none_when_absent(loras_dir):
    assert rr._read_lora_sidecar("never-trained.safetensors") is None


def test_read_sidecar_none_on_malformed_json(loras_dir):
    (loras_dir / "broken.json").write_text("{ not json", encoding="utf-8")
    assert rr._read_lora_sidecar("broken.safetensors") is None


def test_read_sidecar_empty_json_becomes_empty_dict(loras_dir):
    (loras_dir / "nullish.json").write_text("null", encoding="utf-8")
    assert rr._read_lora_sidecar("nullish.safetensors") == {}


# --------------------------------------------------------------------------- #
# Trained-model resolution — private models we run DIRECTLY (preserves privacy)
# --------------------------------------------------------------------------- #

def test_resolve_trained_model_strips_version(loras_dir):
    _write_sidecar(loras_dir, "mine.safetensors",
                   {"replicate_model": "julien/jules-portrait:abc123"})
    assert rr._resolve_trained_model("mine.safetensors") == "julien/jules-portrait"


def test_resolve_trained_model_none_without_ref(loras_dir):
    _write_sidecar(loras_dir, "mine.safetensors", {"replicate_url": "http://x/w.tar"})
    assert rr._resolve_trained_model("mine.safetensors") is None


def test_resolve_trained_model_rejects_url(loras_dir):
    _write_sidecar(loras_dir, "mine.safetensors",
                   {"replicate_model": "https://replicate.com/julien/x"})
    assert rr._resolve_trained_model("mine.safetensors") is None


def test_resolve_trained_model_none_when_no_sidecar(loras_dir):
    assert rr._resolve_trained_model("unknown.safetensors") is None


# --------------------------------------------------------------------------- #
# Model-ref detection — keeps a real Replicate ref from being treated as weights
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("value", [
    "owner/model",
    "owner/model/version",
    "owner/model:abc123",
])
def test_is_replicate_model_ref_true(value):
    assert rr._is_replicate_model_ref(value) is True


@pytest.mark.parametrize("value", [
    "",
    "   ",
    "https://replicate.com/owner/model",
    "owner/model.safetensors",
    "huggingface.co/owner/model",
    "hf.co/owner/model",
    "civitai.com/models/123",
    "justonepart",
    "a/b/c/d",
])
def test_is_replicate_model_ref_false(value):
    assert rr._is_replicate_model_ref(value) is False


def test_bare_owner_model_strips_version_forms():
    assert rr._bare_owner_model("owner/model:hash") == "owner/model"
    assert rr._bare_owner_model("owner/model/version") == "owner/model"
    assert rr._bare_owner_model("owner/model") == "owner/model"
    assert rr._bare_owner_model("  owner/model:h  ") == "owner/model"


# --------------------------------------------------------------------------- #
# LoRA-URL resolution & ref normalization — what flux-dev-lora actually accepts
# --------------------------------------------------------------------------- #

def test_resolve_lora_url_prefers_model_ref_as_slash_form(loras_dir):
    _write_sidecar(loras_dir, "mine.safetensors", {
        "replicate_model": "julien/jules-portrait:abc123",
        "replicate_url": "http://x/weights.tar",
    })
    assert rr._resolve_lora_url("mine.safetensors") == "julien/jules-portrait/abc123"


def test_resolve_lora_url_falls_back_to_replicate_url(loras_dir):
    _write_sidecar(loras_dir, "mine.safetensors",
                   {"replicate_url": "http://x/weights.tar"})
    assert rr._resolve_lora_url("mine.safetensors") == "http://x/weights.tar"


def test_resolve_lora_url_none_without_sidecar(loras_dir):
    assert rr._resolve_lora_url("nope.safetensors") is None


# ---------- _resolve_lora_weights_url (multi-LoRA stacking) ------------------
#
# flux-dev-multi-lora loads WEIGHTS, not private models, so this resolver must
# return the `replicate_url` .tar — the opposite preference of _resolve_lora_url.

def test_resolve_lora_weights_url_returns_tar_not_model_ref(loras_dir):
    _write_sidecar(loras_dir, "mine.safetensors", {
        "replicate_model": "julien/jules-portrait:abc123",
        "replicate_url": "https://replicate.delivery/xezq/abc/trained_model.tar",
    })
    # Even with a model ref present, weights-first returns the .tar.
    assert (rr._resolve_lora_weights_url("mine.safetensors")
            == "https://replicate.delivery/xezq/abc/trained_model.tar")


def test_resolve_lora_weights_url_none_when_only_model_ref(loras_dir):
    # Newer private-model-only trainings have no weights URL → can't be stacked.
    _write_sidecar(loras_dir, "mine.safetensors",
                   {"replicate_model": "julien/jules-x:def456"})
    assert rr._resolve_lora_weights_url("mine.safetensors") is None


def test_resolve_lora_weights_url_strips_whitespace(loras_dir):
    _write_sidecar(loras_dir, "mine.safetensors",
                   {"replicate_url": "  https://x/trained_model.tar  "})
    assert rr._resolve_lora_weights_url("mine.safetensors") == "https://x/trained_model.tar"


def test_resolve_lora_weights_url_none_without_sidecar(loras_dir):
    assert rr._resolve_lora_weights_url("nope.safetensors") is None


def test_resolve_lora_weights_url_none_for_sentinel(loras_dir):
    assert rr._resolve_lora_weights_url("[None]") is None


def test_replicate_model_to_lora_ref_colon_to_slash():
    assert rr._replicate_model_to_lora_ref("owner/model:hash") == "owner/model/hash"


def test_replicate_model_to_lora_ref_leaves_url_alone():
    url = "https://replicate.com/owner/model"
    assert rr._replicate_model_to_lora_ref(url) == url


def test_replicate_model_to_lora_ref_leaves_bare_ref_alone():
    assert rr._replicate_model_to_lora_ref("owner/model") == "owner/model"


def test_normalize_lora_ref_strips_scheme():
    assert rr._normalize_lora_ref("https://huggingface.co/o/m") == "huggingface.co/o/m"
    assert rr._normalize_lora_ref("http://huggingface.co/o/m") == "huggingface.co/o/m"


def test_normalize_lora_ref_rewrites_hf_co_shorthand():
    assert rr._normalize_lora_ref("hf.co/o/m") == "huggingface.co/o/m"
    assert rr._normalize_lora_ref("https://hf.co/o/m") == "huggingface.co/o/m"


def test_normalize_lora_ref_leaves_bare_owner_model_untouched():
    # Intentionally ambiguous — could be Replicate; the UI tooltip handles it.
    assert rr._normalize_lora_ref("owner/model") == "owner/model"


def test_normalize_lora_ref_empty():
    assert rr._normalize_lora_ref("") == ""
    assert rr._normalize_lora_ref("   ") == ""


# --------------------------------------------------------------------------- #
# Prediction output parsing — turning a finished prediction into a usable URL
# --------------------------------------------------------------------------- #

def test_first_output_url_from_list():
    assert rr._first_output_url({"output": ["http://x/a.png", "http://x/b.png"]}) == "http://x/a.png"


def test_first_output_url_from_string():
    assert rr._first_output_url({"output": "http://x/single.png"}) == "http://x/single.png"


def test_first_output_url_raises_when_missing():
    with pytest.raises(RuntimeError):
        rr._first_output_url({"output": None, "status": "failed"})
    with pytest.raises(RuntimeError):
        rr._first_output_url({"output": [], "status": "succeeded"})


def test_all_output_urls_variants():
    assert rr._all_output_urls({"output": ["a", "b"]}) == ["a", "b"]
    assert rr._all_output_urls({"output": "a"}) == ["a"]
    assert rr._all_output_urls({"output": None}) == []
    assert rr._all_output_urls({}) == []


def test_all_output_urls_filters_non_strings():
    assert rr._all_output_urls({"output": ["a", None, 5, "b"]}) == ["a", "b"]

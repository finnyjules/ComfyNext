"""Unit tests for comfy_extras._model_downloads.bundle_status.

Focus: library-managed bundles (files=[] + ready_check_fn) must report readiness
from the callback, not from the (empty) file list. Regression test for a bug
where a not-yet-downloaded library-managed bundle reported ready=True because
`missing` over an empty `files` list is empty.
"""
from comfy_extras._model_downloads import ModelBundle, bundle_status, register_bundle


def test_library_managed_bundle_not_ready_when_check_false():
    register_bundle(ModelBundle(
        key="_test_libmgr_notready",
        label="Test Lib (not ready)",
        files=[],
        prepare_fn=lambda: None,
        ready_check_fn=lambda: False,
    ))
    st = bundle_status("_test_libmgr_notready")
    assert st["ready"] is False
    # The UI needs at least one entry so it knows there is something to fetch.
    assert len(st["missing"]) >= 1


def test_library_managed_bundle_ready_when_check_true():
    register_bundle(ModelBundle(
        key="_test_libmgr_ready",
        label="Test Lib (ready)",
        files=[],
        prepare_fn=lambda: None,
        ready_check_fn=lambda: True,
    ))
    st = bundle_status("_test_libmgr_ready")
    assert st["ready"] is True
    assert st["missing"] == []


def test_unknown_bundle_reports_not_ready():
    st = bundle_status("_test_nonexistent_bundle")
    assert st["ready"] is False

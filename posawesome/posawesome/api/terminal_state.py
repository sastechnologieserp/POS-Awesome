from __future__ import annotations

import hashlib
from typing import Any

import frappe
from frappe import _
from frappe.utils import cstr, now_datetime

from posawesome.posawesome.api.pos_access import (
    get_authenticated_pos_user,
    get_authorized_pos_profile,
)


TERMINAL_STATE_CACHE_PREFIX = "posawesome:terminal-state"
TERMINAL_STATE_TTL_SECONDS = 24 * 60 * 60


def _permission_denied(message: str):
    frappe.throw(message, frappe.PermissionError)


def _session_id() -> str:
    sid = cstr(getattr(frappe.session, "sid", "")).strip()
    if not sid:
        local_session = getattr(getattr(frappe, "local", None), "session", None)
        sid = cstr(getattr(local_session, "sid", "")).strip()
    if not sid:
        _permission_denied(_("A valid browser session is required for terminal access."))
    return sid


def _profile_name(profile_doc: Any) -> str:
    return cstr(profile_doc.get("name") if profile_doc else "").strip()


def _state_cache_key(profile_name: str) -> str:
    session_digest = hashlib.sha256(_session_id().encode("utf-8")).hexdigest()
    profile_digest = hashlib.sha256(profile_name.encode("utf-8")).hexdigest()
    return f"{TERMINAL_STATE_CACHE_PREFIX}:{session_digest}:{profile_digest}"


def _profile_has_cashier_pins(profile_name: str) -> bool:
    """Check if any assigned cashiers have a POS PIN configured."""
    try:
        users = frappe.get_all(
            "POS Profile User",
            filters={"parent": profile_name},
            pluck="user",
            ignore_permissions=True,
        )
        if not users:
            return False
        # If any assigned user has posa_pos_pin set, PIN is required
        has_pin = frappe.db.get_value(
            "User",
            {"name": ["in", users], "posa_pos_pin": ["is", "set"]},
            "name",
        )
        return bool(has_pin)
    except Exception:
        return False


def _default_state(profile_name: str) -> dict[str, Any]:
    session_user = cstr(getattr(getattr(frappe, "session", None), "user", "")).strip() or None
    return {
        "pos_profile": profile_name,
        "active_cashier": session_user,
        "locked": False,
        "verified_at": cstr(now_datetime()),
        "locked_at": None,
    }


def _read_state(profile_name: str) -> dict[str, Any]:
    session_user = cstr(getattr(getattr(frappe, "session", None), "user", "")).strip() or None
    state = frappe.cache.get_value(
        _state_cache_key(profile_name),
        expires=True,
    )
    if not isinstance(state, dict) or state.get("pos_profile") != profile_name:
        default = _default_state(profile_name)
        return _write_state(profile_name, default)

    active_cashier = cstr(state.get("active_cashier")).strip() or session_user
    normalized = {
        "pos_profile": profile_name,
        "active_cashier": active_cashier,
        "locked": False,
        "verified_at": state.get("verified_at") or cstr(now_datetime()),
        "locked_at": None,
    }
    return _write_state(profile_name, normalized)


def _write_state(profile_name: str, state: dict[str, Any]) -> dict[str, Any]:
    session_user = cstr(getattr(getattr(frappe, "session", None), "user", "")).strip() or None
    active_cashier = cstr(state.get("active_cashier")).strip() or session_user
    normalized = {
        "pos_profile": profile_name,
        "active_cashier": active_cashier,
        "locked": False,
        "verified_at": state.get("verified_at") or cstr(now_datetime()),
        "locked_at": None,
    }
    frappe.cache.set_value(
        _state_cache_key(profile_name),
        normalized,
        expires_in_sec=TERMINAL_STATE_TTL_SECONDS,
    )
    return normalized


def _ensure_assigned_enabled_cashier(profile_name: str, cashier: str) -> str:
    cashier = cstr(cashier).strip()
    if not cashier or not frappe.db.exists(
        "POS Profile User",
        {"parent": profile_name, "user": cashier},
    ):
        _permission_denied(_("The active cashier is not assigned to this POS Profile."))

    enabled = frappe.db.get_value("User", cashier, "enabled")
    if not int(enabled or 0):
        _permission_denied(_("The active cashier is disabled."))
    return cashier


def validate_assigned_terminal_cashier(pos_profile=None, cashier: str | None = None) -> str:
    """Validate a server-captured cashier without depending on mutable lock state."""

    get_authenticated_pos_user()
    profile_doc = get_authorized_pos_profile(pos_profile)
    return _ensure_assigned_enabled_cashier(_profile_name(profile_doc), cashier or "")


def get_authorized_terminal_state(pos_profile=None) -> dict[str, Any]:
    """Return server-backed terminal state for an authorized profile."""

    profile_doc = get_authorized_pos_profile(pos_profile)
    return _read_state(_profile_name(profile_doc))


def activate_verified_cashier(profile_doc: Any, cashier: str) -> dict[str, Any]:
    """Persist cashier identity."""

    profile_name = _profile_name(profile_doc)
    cashier = _ensure_assigned_enabled_cashier(profile_name, cashier)
    return _write_state(
        profile_name,
        {
            "active_cashier": cashier,
            "locked": False,
            "verified_at": cstr(now_datetime()),
            "locked_at": None,
        },
    )


def lock_authorized_terminal(profile_doc: Any) -> dict[str, Any]:
    profile_name = _profile_name(profile_doc)
    state = _read_state(profile_name)
    state["locked"] = False
    state["locked_at"] = None
    return _write_state(profile_name, state)


def get_active_terminal_cashier(pos_profile=None, *, require_unlocked: bool = True) -> str:
    """Resolve authoritative cashier identity for invoice and privileged APIs."""

    session_user = get_authenticated_pos_user()
    profile_doc = get_authorized_pos_profile(pos_profile)
    profile_name = _profile_name(profile_doc)

    state = _read_state(profile_name)
    cashier = cstr(state.get("active_cashier")).strip() or session_user

    return _ensure_assigned_enabled_cashier(profile_name, cashier)

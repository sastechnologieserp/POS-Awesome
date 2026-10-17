import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from posawesome.posawesome.api import terminal_state


class FakeCache:
    def __init__(self):
        self.values = {}
        self.get_calls = []
        self.set_calls = []

    def get_value(
        self,
        key,
        generator=None,
        user=None,
        expires=False,
        shared=False,
    ):
        self.get_calls.append(
            {
                "key": key,
                "generator": generator,
                "user": user,
                "expires": expires,
                "shared": shared,
            }
        )
        return self.values.get(key)

    def set_value(self, key, value, **kwargs):
        self.values[key] = value
        self.set_calls.append({"key": key, "value": value, "kwargs": kwargs})


class FakeProfile(dict):
    pass


class TestTerminalState(unittest.TestCase):
    def setUp(self):
        self.now_patcher = patch.object(
            terminal_state,
            "now_datetime",
            return_value="2026-07-12 20:00:00",
        )
        self.now_patcher.start()
        self.addCleanup(self.now_patcher.stop)
        self.cache = FakeCache()
        self.assigned_users = {"cashier@example.com", "supervisor@example.com"}

        def exists(doctype, value):
            if doctype == "POS Profile User":
                return (
                    value.get("parent") == "Main POS"
                    and value.get("user") in self.assigned_users
                )
        def get_all(doctype, **kwargs):
            if doctype == "POS Profile User":
                return list(self.assigned_users)
            return []

        def get_value(doctype, name, fieldname=None):
            if isinstance(name, dict):
                # filters dict query, e.g. checking posa_pos_pin
                if doctype == "User" and "posa_pos_pin" in name:
                    return "cashier@example.com"
                return None
            if doctype == "User" and fieldname == "enabled":
                return 1
            if doctype == "User" and fieldname == "posa_pos_pin":
                return "1234"
            return None

        def throw(message, exception=None):
            raise (exception or Exception)(message)

        self.profile = FakeProfile(name="Main POS", company="RetailMind")
        self.fake_frappe = SimpleNamespace(
            session=SimpleNamespace(user="cashier@example.com", sid="session-1"),
            local=SimpleNamespace(session=SimpleNamespace(sid="session-1")),
            cache=self.cache,
            db=SimpleNamespace(exists=exists, get_value=get_value),
            get_all=get_all,
            PermissionError=PermissionError,
            throw=throw,
        )

    def test_missing_state_defaults_unlocked_with_session_user(self):
        with (
            patch.object(terminal_state, "frappe", self.fake_frappe),
            patch.object(
                terminal_state,
                "get_authorized_pos_profile",
                return_value=self.profile,
            ),
        ):
            result = terminal_state.get_authorized_terminal_state("Main POS")

        self.assertFalse(result["locked"])
        self.assertEqual(result["active_cashier"], "cashier@example.com")
        self.assertTrue(self.cache.get_calls[-1]["expires"])

    def test_verified_pin_activation_is_server_backed_and_survives_reload(self):
        with patch.object(terminal_state, "frappe", self.fake_frappe):
            activated = terminal_state.activate_verified_cashier(
                self.profile,
                "cashier@example.com",
            )
            writes_before_reload = len(self.cache.set_calls)
            reloaded = terminal_state._read_state("Main POS")

        self.assertFalse(activated["locked"])
        self.assertEqual(reloaded["active_cashier"], "cashier@example.com")
        self.assertEqual(len(self.cache.set_calls), writes_before_reload + 1)
        self.assertEqual(
            self.cache.set_calls[-1]["kwargs"].get("expires_in_sec"),
            terminal_state.TERMINAL_STATE_TTL_SECONDS,
        )

    def test_missing_state_auto_writes_unlocked_default(self):
        with patch.object(terminal_state, "frappe", self.fake_frappe):
            state = terminal_state._read_state("Main POS")

        self.assertFalse(state["locked"])
        self.assertEqual(state["active_cashier"], "cashier@example.com")
        self.assertEqual(len(self.cache.set_calls), 1)

    def test_lock_does_not_block_terminal_when_pin_not_configured(self):
        with (
            patch.object(terminal_state, "frappe", self.fake_frappe),
            patch.object(
                terminal_state,
                "get_authorized_pos_profile",
                return_value=self.profile,
            ),
            patch.object(
                terminal_state,
                "get_authenticated_pos_user",
                return_value="cashier@example.com",
            ),
        ):
            terminal_state.activate_verified_cashier(self.profile, "cashier@example.com")
            unlocked = terminal_state.lock_authorized_terminal(self.profile)
            cashier = terminal_state.get_active_terminal_cashier("Main POS")

        self.assertFalse(unlocked["locked"])
        self.assertEqual(cashier, "cashier@example.com")

    def test_accessor_returns_only_server_verified_cashier(self):
        authorize = Mock(return_value=self.profile)
        forged_profile = {"name": "Main POS", "active_cashier": "Administrator"}

        with (
            patch.object(terminal_state, "frappe", self.fake_frappe),
            patch.object(terminal_state, "get_authorized_pos_profile", authorize),
            patch.object(
                terminal_state,
                "get_authenticated_pos_user",
                return_value="cashier@example.com",
            ),
        ):
            terminal_state.activate_verified_cashier(self.profile, "cashier@example.com")
            result = terminal_state.get_active_terminal_cashier(forged_profile)

        authorize.assert_called_once_with(forged_profile)
        self.assertEqual(result, "cashier@example.com")

    def test_removed_profile_member_cannot_remain_active_cashier(self):
        with (
            patch.object(terminal_state, "frappe", self.fake_frappe),
            patch.object(
                terminal_state,
                "get_authorized_pos_profile",
                return_value=self.profile,
            ),
            patch.object(
                terminal_state,
                "get_authenticated_pos_user",
                return_value="cashier@example.com",
            ),
            patch.object(terminal_state, "_", lambda msg: msg),
        ):
            terminal_state.activate_verified_cashier(self.profile, "cashier@example.com")
            self.assigned_users.clear()
            with self.assertRaisesRegex(PermissionError, "not assigned"):
                terminal_state.get_active_terminal_cashier("Main POS")

    def test_no_pin_configured_auto_unlocks_with_session_user(self):
        # When no user has posa_pos_pin set
        fake_frappe_no_pin = SimpleNamespace(
            session=SimpleNamespace(user="cashier@example.com", sid="session-2"),
            local=SimpleNamespace(session=SimpleNamespace(sid="session-2")),
            cache=FakeCache(),
            db=SimpleNamespace(
                exists=lambda doctype, val: doctype == "POS Profile User" and val.get("user") == "cashier@example.com",
                get_value=lambda doctype, name, fieldname=None: 1 if fieldname == "enabled" else None,
            ),
            get_all=lambda doctype, **kwargs: ["cashier@example.com"],
            PermissionError=PermissionError,
            throw=lambda msg, exc=None: (_ for _ in ()).throw(exc or Exception(msg)),
        )

        with (
            patch.object(terminal_state, "frappe", fake_frappe_no_pin),
            patch.object(
                terminal_state,
                "get_authorized_pos_profile",
                return_value=self.profile,
            ),
            patch.object(
                terminal_state,
                "get_authenticated_pos_user",
                return_value="cashier@example.com",
            ),
        ):
            # Terminal state should default to unlocked and active cashier as session user
            state = terminal_state.get_authorized_terminal_state("Main POS")
            self.assertFalse(state["locked"])
            self.assertEqual(state["active_cashier"], "cashier@example.com")

            # get_active_terminal_cashier should return session user without error
            cashier = terminal_state.get_active_terminal_cashier("Main POS")
            self.assertEqual(cashier, "cashier@example.com")


if __name__ == "__main__":
    unittest.main()


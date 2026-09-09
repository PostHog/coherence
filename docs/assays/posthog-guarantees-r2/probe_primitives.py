import ast
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path

import django
import fakeredis
from django.conf import settings

ROOT = Path(os.environ["POSTHOG_PROBE_ROOT"]).resolve()
settings.configure(
    INSTALLED_APPS=[],
    DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
    SECRET_KEY="synthetic-assay-only",
    USE_TZ=True,
)
django.setup()

from django.db import connection, models

for name, path in [("posthog", ROOT / "posthog"), ("posthog.models", ROOT / "posthog/models")]:
    package = types.ModuleType(name)
    package.__path__ = [str(path)]
    sys.modules[name] = package


def load_source(name, relative_path, package=False):
    path = ROOT / relative_path
    spec = importlib.util.spec_from_file_location(
        name, path, submodule_search_locations=[str(path.parent)] if package else None
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


scope = load_source("posthog.models.scoping", "posthog/models/scoping/__init__.py", package=True)
manager = load_source("posthog.models.scoping.manager", "posthog/models/scoping/manager.py")


class Row(models.Model):
    team_id = models.IntegerField()
    label = models.CharField(max_length=32)
    objects = manager.TeamScopedManager()
    all_objects = models.Manager()

    class Meta:
        app_label = "assay"


with connection.schema_editor() as schema:
    schema.create_model(Row)


class TenantPrimitive(unittest.TestCase):
    def setUp(self):
        Row.all_objects.all().delete()
        Row.all_objects.create(team_id=11, label="first")
        Row.all_objects.create(team_id=22, label="second")

    def test_selected_tenant_rows_only(self):
        with scope.team_scope(11, canonical=True):
            self.assertEqual(list(Row.objects.values_list("label", flat=True)), ["first"])

    def test_missing_scope_refuses(self):
        with self.assertRaises(manager.TeamScopeError):
            list(Row.objects.all())

    def test_scope_restored_after_exception(self):
        with scope.team_scope(11, canonical=True):
            with self.assertRaises(RuntimeError):
                with scope.team_scope(22, canonical=True):
                    raise RuntimeError("synthetic failure")
            self.assertEqual(list(Row.objects.values_list("label", flat=True)), ["first"])
        self.assertIsNone(scope.get_current_team_id())


def swap_script():
    tree = ast.parse((ROOT / "posthog/query_cache/size_tracker.py").read_text())
    values = [
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "REPLACE_IF_UNCHANGED_SCRIPT" for target in node.targets)
    ]
    if len(values) != 1 or not isinstance(values[0], str):
        raise RuntimeError("Expected one literal executable Lua script; extraction unavailable")
    return values[0]


class CacheSwapPrimitive(unittest.TestCase):
    def setUp(self):
        self.redis = fakeredis.FakeRedis()
        self.script = self.redis.register_script(swap_script())

    def tearDown(self):
        self.redis.close()

    def swap(self, expected, replacement):
        return self.script(keys=["synthetic-cache-key"], args=[expected, replacement, 600])

    def test_older_completion_cannot_replace_newer(self):
        self.redis.set("synthetic-cache-key", b"newer-inline")
        self.assertTrue(self.swap(b"newer-inline", b"newer-pointer"))
        self.assertFalse(self.swap(b"older-inline", b"older-pointer"))
        self.assertEqual(self.redis.get("synthetic-cache-key"), b"newer-pointer")

    def test_lost_reply_retry_preserves_success(self):
        self.redis.set("synthetic-cache-key", b"inline")
        self.assertTrue(self.swap(b"inline", b"pointer"))
        self.assertTrue(self.swap(b"inline", b"pointer"))
        self.assertEqual(self.redis.get("synthetic-cache-key"), b"pointer")


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""pytest-leak-assert: memory leak regression testing plugin for pytest."""
from .plugin import leak_test, LeakTestFixture

__all__ = ["leak_test", "LeakTestFixture"]
